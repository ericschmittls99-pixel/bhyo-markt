/**
 * Gemeinsame Ermittlung der Schreibpfade fuer die CI-Waechter rechte-check
 * (E42) und protokoll-check (AP2.2). EINE Ermittlung, zwei Pruefungen — eine
 * zweite Liste koennte abdriften, und genau der Pfad, der nur in einer Liste
 * steht, waere der ungepruefte.
 *
 * Schreibpfad = jede exportierte async-Funktion in einer "use server"-Datei
 * (im ganzen Baum) und jede POST/PUT/PATCH/DELETE-Route unter app/api.
 * Zu jedem Pfad gibt es den Rumpf in drei Stufen: nur er selbst, mit lokalen
 * Helfern derselben Datei, und zusaetzlich mit den aus `@/lib/...`
 * importierten Funktionen (eine Ebene) — Letzteres fuer Pruefungen, die in
 * der Transaktion eines Bausteins sitzen duerfen (z. B. das Protokoll in
 * lib/bewertung.ts, aufgerufen aus app/api/projekte).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SCHREIB_METHODEN = ["POST", "PUT", "PATCH", "DELETE"] as const;

export interface Lücke {
  datei: string;
  pfad: string;
  grund: string;
}

export interface Schreibpfad {
  datei: string;
  pfad: string;
  /** "Server-Action" oder "schreibende Route" — fuer Meldungen. */
  artText: string;
  rumpf: string;
  mitLokalen: string;
  mitImporten: string;
}

export function dateien(verzeichnis: string, treffer: string[] = []): string[] {
  for (const eintrag of readdirSync(verzeichnis)) {
    if (eintrag === "node_modules" || eintrag === ".next") continue;
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) dateien(voll, treffer);
    else if (/\.tsx?$/.test(eintrag) && !/\.test\.tsx?$/.test(eintrag)) treffer.push(voll);
  }
  return treffer;
}

/**
 * Schneidet den Rumpf einer Funktion heraus — von ihrem Beginn bis zum
 * naechsten `export`/`function`. Grob, aber ausreichend: Wir fragen nur, ob
 * in diesem Abschnitt ein bestimmter Aufruf vorkommt.
 */
export function rumpf(quelle: string, ab: number): string {
  const rest = quelle.slice(ab);
  const naechster = rest.slice(1).search(/^(?:export |async function |function )/m);
  return naechster === -1 ? rest : rest.slice(0, naechster + 1);
}

/**
 * Rumpf samt aufgerufener Helfer DESSELBEN Moduls (eine Ebene). Exportierte
 * zaehlen mit: Ein Baustein hat eine Variante mit eigener Transaktion
 * (`akteurAnlegen`) und eine fuer fremde Transaktionen (`akteurAnlegenInTx`,
 * AP2.7 PR b); Rechte und Protokoll sitzen in der InTx-Variante, die erste
 * ruft sie nur. Vorher sah der Scanner nur nicht-exportierte Helfer — bei
 * a0 fiel das nicht auf, weil derselbe Schreibpfad (stromSpeichern) im
 * Bearbeiten-Zweig selbst protokolliert.
 */
function mitLokalen(quelle: string, text: string): string {
  const lokale = new Map<string, string>();
  for (const m of quelle.matchAll(/^(?:export )?(?:async )?function (\w+)\(/gm)) {
    lokale.set(m[1]!, rumpf(quelle, m.index!));
  }
  let erweitert = text;
  for (const [name, body] of lokale) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(text)) erweitert += "\n" + body;
  }
  return erweitert;
}

/**
 * Zusaetzlich die Ruempfe der aus `@/lib/...` importierten Funktionen, die
 * im Text aufgerufen werden (eine Ebene, keine Rekursion).
 */
function mitImporten(wurzel: string, quelle: string, text: string): string {
  let erweitert = text;
  for (const imp of quelle.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/([^"]+)"/g)) {
    const datei = ["", ".ts", "/index.ts"].map((e) => join(wurzel, "lib", imp[2]! + e)).find((d) => existsSync(d) && statSync(d).isFile());
    if (!datei) continue;
    const modul = readFileSync(datei, "utf8");
    for (const name of imp[1]!.split(",").map((n) => n.trim().split(/\s+as\s+/).pop()!).filter(Boolean)) {
      if (!new RegExp(`\\b${name}\\s*\\(`).test(text)) continue;
      const m = new RegExp(`^export (?:async )?function ${name}\\(`, "m").exec(modul);
      if (m) erweitert += "\n" + mitLokalen(modul, rumpf(modul, m.index));
    }
  }
  return erweitert;
}

export function schreibpfade(wurzel: string): Schreibpfad[] {
  const pfade: Schreibpfad[] = [];
  const eintrag = (datei: string, quelle: string, pfad: string, artText: string, ab: number) => {
    const r = rumpf(quelle, ab);
    const lokal = mitLokalen(quelle, r);
    pfade.push({
      datei: relative(wurzel, datei),
      pfad,
      artText,
      rumpf: r,
      mitLokalen: lokal,
      mitImporten: mitImporten(wurzel, quelle, lokal),
    });
  };

  // 1. Server-Actions: jede exportierte async-Funktion in einer "use server"-
  //    Datei — im GANZEN Baum (lib, app, components), nicht nur in lib/:
  //    eine Action ist ueberall ein Endpunkt (Sicherheitsmessung AP2.1).
  for (const datei of dateien(wurzel)) {
    if (datei.includes(`${sep}scripts${sep}`)) continue;
    const quelle = readFileSync(datei, "utf8");
    if (!/^["']use server["'];/m.test(quelle)) continue;
    for (const m of quelle.matchAll(/^export async function (\w+)/gm)) {
      eintrag(datei, quelle, `${m[1]!}()`, "Server-Action", m.index!);
    }
  }

  // 2. Schreibende API-Routen.
  for (const datei of dateien(join(wurzel, "app", "api"))) {
    if (!datei.endsWith("route.ts")) continue;
    const quelle = readFileSync(datei, "utf8");
    for (const methode of SCHREIB_METHODEN) {
      const m = new RegExp(`^export async function ${methode}\\b`, "m").exec(quelle);
      if (m) eintrag(datei, quelle, methode, "schreibende Route", m.index);
    }
  }

  return pfade;
}
