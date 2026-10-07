/**
 * F8/E30, E42 (rechte-check): Findet jeden Schreibpfad, der nicht mit einer
 * benannten Aktion durch die Wache geht — und jede Aktion, die die Matrix
 * nicht kennt.
 *
 * Der Sinn ist nicht, den heutigen Stand zu bestaetigen — der ist gruen.
 * Der Sinn ist der MORGIGE Schreibpfad: Wer eine neue Server-Action oder
 * eine neue POST/PUT/PATCH/DELETE-Route anlegt und die Wache vergisst,
 * soll es von der CI erfahren und nicht von einem Betrachter, der etwas
 * geaendert hat. Gleiches Muster wie der step="any"-Test: geprueft wird die
 * Ursache (fehlende Pruefung), nicht das Symptom.
 *
 * Bewusst quellentextbasiert: Ein Laufzeittest muesste jede Route aufrufen
 * und wuerde neue Pfade genau dann verpassen, wenn niemand an ihn denkt.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { schreibpfade, type Lücke } from "./schreibpfade";

export type { Lücke };

const WURZEL = process.cwd();

/**
 * Was als Durchsetzung gilt, wird aus lib/rechte/wache.ts SELBST gelesen — jede
 * dort exportierte Funktion. Eine Liste, die hier noch einmal stuende, waere
 * eine zweite Wahrheit: Sie koennte von der Wache abdriften, und der Test
 * wuerde den Bruch nicht melden, sondern verdecken.
 */
function wacheNamen(wurzel: string): string[] {
  const quelle = readFileSync(join(wurzel, "lib", "rechte", "wache.ts"), "utf8");
  const namen = [...quelle.matchAll(/^export (?:async )?function (\w+)\(\s*aktion: Aktion/gm)].map((m) => m[1]!);
  if (namen.length === 0) throw new Error("lib/rechte/wache.ts exportiert keine Funktion mit Aktion — Test kaputt.");
  return namen;
}

/** Die Aktionen der Matrix, aus matrix.ts SELBST gelesen (keine zweite Liste). */
function aktionen(wurzel: string): Set<string> {
  const quelle = readFileSync(join(wurzel, "lib", "rechte", "matrix.ts"), "utf8");
  const block = quelle.slice(quelle.indexOf("export const AKTIONEN = ["), quelle.indexOf("] as const;"));
  const werte = [...block.matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]!);
  if (werte.length === 0) throw new Error("matrix.ts: keine Aktionen gefunden — Test kaputt.");
  return new Set(werte);
}

/**
 * E44: Aktionen mit Objektregel (Sperre), aus matrix.ts SELBST gelesen. Ein
 * Schreibpfad, der eine solche Aktion nennt, muss die Objektstufe in seiner
 * Transaktion pruefen (`pruefeStromSperre(`) — die Wache am Eingang prueft
 * nur die Rollenstufe.
 */
function objektAktionen(wurzel: string): Set<string> {
  const quelle = readFileSync(join(wurzel, "lib", "rechte", "matrix.ts"), "utf8");
  const start = quelle.indexOf("const OBJEKT_REGELN");
  const block = quelle.slice(start, quelle.indexOf("};", start));
  return new Set([...block.matchAll(/"([a-z_]+\.[a-z_]+)":/g)].map((m) => m[1]!));
}

export function findeLuecken(wurzel = WURZEL): Lücke[] {
  const luecken: Lücke[] = [];
  const bekannt = aktionen(wurzel);
  const mitObjekt = objektAktionen(wurzel);
  // Nur Funktionen, die eine AKTION verlangen, zaehlen als Durchsetzung eines
  // Schreibpfads — `zugangFuerRoute()` (Lesen) reicht fuer Schreiben nicht.
  // Wortgrenze, damit `verlange` nicht auf `verlangeZugang` matcht.
  const wache = new RegExp(`\\b(${wacheNamen(wurzel).join("|")})\\s*\\(([^)]*)\\)`);
  /**
   * Prueft einen Rumpf: Aufruf vorhanden, Aktion(en) als Literal und in der
   * Matrix? Ein Ausdruck wie `id == null ? "strom.anlegen" : "strom.bearbeiten"`
   * traegt zwei Literale — jedes muss bekannt sein. Gibt den Grund oder null.
   */
  const pruefe = (text: string, mitBausteinen: string): string | null => {
    const m = wache.exec(text);
    if (!m) return "kein Aufruf der Wache mit einer Aktion";
    const literale = [...m[2]!.matchAll(/"([^"]*)"/g)].map((l) => l[1]!);
    if (literale.length === 0) return "Aktion nicht als Literal angegeben (nicht pruefbar)";
    const fremd = literale.filter((l) => !bekannt.has(l));
    if (fremd.length) return `unbekannte Aktion „${fremd.join('", „')}" (nicht in der Matrix)`;
    // E44: Objektstufe — wer eine Aktion mit Sperrregel nennt, muss sie in der
    // Transaktion pruefen (direkt oder ueber einen Rumpf mit demselben Literal).
    // AP2.2: Inbox-Objektregel (Empfaenger) prueft `pruefeInboxEmpfaenger(`.
    // AP2.6 PR a (E71): Kommentar-Objektregel (Autor) prueft `pruefeKommentarObjekt(`
    // — sie sitzt im Baustein kommentar-schreibweg.ts, den die Action in ihrer
    // Transaktion ruft; deshalb zaehlt hier auch der Rumpf einer aus `@/lib/...`
    // importierten Funktion (eine Ebene, wie beim Protokoll). Die Wache selbst
    // bleibt am Eingang (oben: nur der Pfad und seine lokalen Helfer).
    if (literale.some((l) => mitObjekt.has(l)) && !/\b(pruefeStromSperre|pruefeInboxEmpfaenger|pruefeKommentarObjekt)\s*\(/.test(mitBausteinen)) {
      return `Aktion mit Objektregel ohne Objektstufe (pruefeStromSperre / pruefeInboxEmpfaenger / pruefeKommentarObjekt) im Schreibpfad`;
    }
    return null;
  };

  // Die Wache muss im Pfad selbst oder einem LOKALEN Helfer sitzen — ein
  // importierter Helfer zaehlt hier nicht (die Wache gehoert an den Eingang).
  for (const pfad of schreibpfade(wurzel)) {
    const grund = pruefe(pfad.mitLokalen, pfad.mitImporten);
    if (grund) luecken.push({ datei: pfad.datei, pfad: pfad.pfad, grund: `${pfad.artText}: ${grund}` });
  }

  return luecken;
}

// Direkt aufrufbar (pnpm --filter web exec tsx scripts/rechte-check.ts),
// damit sich die Liste auch von Hand ansehen laesst.
if (process.argv[1]?.endsWith("rechte-check.ts")) {
  const luecken = findeLuecken();
  if (luecken.length === 0) {
    console.log("rechte-check OK — jeder Schreibpfad nennt eine Aktion der Matrix und geht durch lib/rechte/wache.ts.");
  } else {
    for (const l of luecken) console.error(`::error file=${l.datei}::${l.pfad} — ${l.grund}`);
    process.exit(1);
  }
}
