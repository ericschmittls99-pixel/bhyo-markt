/**
 * Die drei Bäume aus dem Bestand (F5 PR B). Reine Funktionen: Ströme rein,
 * Baum raus. Kein Zugriff auf Datenbank oder Netz.
 *
 * **Leere Äste erscheinen nicht.** Ein Bundesland ohne Ströme wäre ein
 * Eintrag, der nichts filtert — er verlängert die Liste und führt in die
 * Irre. Dasselbe gilt für Kreise und Orte (Vorgabe Eric, 25.09.2026).
 *
 * **Ströme ohne Koordinate oder außerhalb Deutschlands** behalten ihre
 * benannten Zustände aus E24/F0b und erscheinen im Baum nicht als leere
 * Einträge — sie sind über die eigenen Filterwerte `ausserhalb` und
 * `ohne_koordinate` erreichbar.
 */
import type { Knoten } from "./hierarchie";

/** Was ein Baum vom Strom braucht — bewusst schmal gehalten. */
export interface BaumStrom {
  cluster: string | null;
  materialartCode: string | null;
  materialartLabel: string | null;
  gruppe: string | null;
  produktCode: string | null;
  produktLabel: string | null;
  ort: string | null;
  verwaltung: {
    kreisArs: string;
    kreisName: string;
    /** Kann fehlen, wenn der ARS-Praefix kein Land trifft (E25). */
    landArs: string | null;
    landName: string | null;
  } | null;
}

/**
 * Ortsnamen fürs Gruppieren vereinheitlichen: Leerraum am Rand weg, mehrfache
 * Leerzeichen zusammengezogen, Vergleich ohne Rücksicht auf Groß- und
 * Kleinschreibung. **Kein neuer Schlüssel und keine Ortsdatenbank** — dafür
 * ist es zu früh (Entscheidung Eric, 25.09.2026).
 */
export function ortsSchluessel(roh: string): string {
  return roh.trim().replace(/\s+/g, " ").toLocaleLowerCase("de");
}

/**
 * Häufigste Schreibweise je Schlüssel. Bei Gleichstand gewinnt die
 * alphabetisch erste — damit dieselbe Datenlage immer denselben Baum ergibt
 * und nicht die Reihenfolge der Zeilen entscheidet.
 */
function haeufigsteSchreibweise(varianten: Map<string, number>): string {
  let beste = "";
  let bestN = -1;
  for (const [text, n] of [...varianten.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], "de"),
  )) {
    if (n > bestN) {
      beste = text;
      bestN = n;
    }
  }
  return beste;
}

const sortiere = (a: Knoten, b: Knoten) => a.label.localeCompare(b.label, "de");

/** Cluster → Materialart. Zweistufig, Werte sind die Codes. */
export function baumMaterialart(
  stroeme: BaumStrom[],
  clusterLabel: Record<string, string>,
): Knoten[] {
  const cluster = new Map<string, Map<string, string>>();
  for (const s of stroeme) {
    if (!s.cluster || !s.materialartCode) continue;
    const kinder = cluster.get(s.cluster) ?? new Map();
    kinder.set(s.materialartCode, s.materialartLabel ?? s.materialartCode);
    cluster.set(s.cluster, kinder);
  }
  return [...cluster.entries()]
    .map(([wert, kinder]) => ({
      wert,
      label: clusterLabel[wert] ?? wert,
      kinder: [...kinder.entries()]
        .map(([w, l]) => ({ wert: w, label: l }))
        .sort(sortiere),
    }))
    .sort(sortiere);
}

/** Gruppe → Produkt. Zweistufig, Werte sind die Codes. */
export function baumProdukt(
  stroeme: BaumStrom[],
  gruppeLabel: Record<string, string>,
): Knoten[] {
  const gruppen = new Map<string, Map<string, string>>();
  for (const s of stroeme) {
    if (!s.gruppe || !s.produktCode) continue;
    const kinder = gruppen.get(s.gruppe) ?? new Map();
    kinder.set(s.produktCode, s.produktLabel ?? s.produktCode);
    gruppen.set(s.gruppe, kinder);
  }
  return [...gruppen.entries()]
    .map(([wert, kinder]) => ({
      wert,
      label: gruppeLabel[wert] ?? wert,
      kinder: [...kinder.entries()]
        .map(([w, l]) => ({ wert: w, label: l }))
        .sort(sortiere),
    }))
    .sort(sortiere);
}

/**
 * Bundesland → Landkreis → Ort. Land und Kreis kommen räumlich über den ARS
 * (E25), der Ort aus den strukturierten Adressfeldern (F0a) — **eingeschränkt
 * auf den Kreis-ARS desselben Stroms**. Ein Ortsname ohne Kreis hängt an
 * keinem Ast und erscheint nicht; ihn auf gut Glück irgendwo einzuhängen
 * hieße raten.
 */
export function baumOrt(stroeme: BaumStrom[]): Knoten[] {
  const laender = new Map<string, { label: string; kreise: Map<string, KreisRoh> }>();

  for (const s of stroeme) {
    const v = s.verwaltung;
    if (!v) continue; // ausserhalb / ohne Koordinate: eigene Filterwerte
    // Ein Kreis ohne Land haengt an keinem Ast. Ihn irgendwo einzuhaengen
    // hiesse raten — er bleibt ueber den Kreis-Filterwert erreichbar.
    if (!v.landArs) continue;
    const land = laender.get(v.landArs) ?? {
      label: v.landName ?? v.landArs,
      kreise: new Map(),
    };
    const kreis = land.kreise.get(v.kreisArs) ?? {
      label: v.kreisName,
      orte: new Map<string, Map<string, number>>(),
    };
    const roh = s.ort?.trim();
    if (roh) {
      const key = ortsSchluessel(roh);
      const varianten = kreis.orte.get(key) ?? new Map<string, number>();
      varianten.set(roh, (varianten.get(roh) ?? 0) + 1);
      kreis.orte.set(key, varianten);
    }
    land.kreise.set(v.kreisArs, kreis);
    laender.set(v.landArs, land);
  }

  return [...laender.entries()]
    .map(([ars, land]) => ({
      wert: ars,
      label: land.label,
      kinder: [...land.kreise.entries()]
        .map(([kArs, kreis]) => ({
          wert: kArs,
          label: kreis.label,
          kinder: [...kreis.orte.entries()]
            .map(([key, varianten]) => ({
              // Gespeichert wird der Schluessel (kleingeschrieben,
              // zusammengezogen), angezeigt die haeufigste Schreibweise —
              // sonst waeren "Speyer" und "speyer " zwei Filterwerte.
              wert: key,
              label: haeufigsteSchreibweise(varianten),
            }))
            .sort(sortiere),
        }))
        .sort(sortiere),
    }))
    .sort(sortiere);
}

interface KreisRoh {
  label: string;
  orte: Map<string, Map<string, number>>;
}
