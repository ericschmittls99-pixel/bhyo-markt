/**
 * E77 R5: Gleiche Typen desselben Tages als aufklappbare Gruppe mit Zaehler.
 * Rein: die Zeilen kommen sortiert (juengste zuerst) herein, die Reihenfolge
 * bleibt — eine Gruppe steht dort, wo ihr juengster Eintrag stand. Der Tag ist
 * der Kalendertag in Europe/Berlin (der Tag der Nutzer, nicht UTC: ein Eintrag
 * um 00:30 Uhr gehoert zum neuen Tag). Erst ab zwei Eintraegen wird gruppiert.
 */
import type { InboxZeile } from "./server";

export type GruppenZeile = Pick<InboxZeile, "id" | "typ" | "aktualisiertAm">;

export type GruppenEintrag<Z extends GruppenZeile> =
  | { art: "einzeln"; zeile: Z }
  | { art: "gruppe"; typ: Z["typ"]; tag: string; zeilen: Z[] };

const tagBerlin = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" });

/** Kalendertag (JJJJ-MM-TT, Europe/Berlin) eines ISO-Zeitpunkts; ungueltig = "". */
export function tagVon(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : tagBerlin.format(d);
}

const schluessel = (z: GruppenZeile) => `${z.typ}|${tagVon(z.aktualisiertAm)}`;

export function gruppiere<Z extends GruppenZeile>(zeilen: readonly Z[]): GruppenEintrag<Z>[] {
  const nachSchluessel = new Map<string, Z[]>();
  for (const z of zeilen) {
    const liste = nachSchluessel.get(schluessel(z));
    if (liste) liste.push(z);
    else nachSchluessel.set(schluessel(z), [z]);
  }
  const ergebnis: GruppenEintrag<Z>[] = [];
  const gesehen = new Set<string>();
  for (const z of zeilen) {
    const k = schluessel(z);
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    const liste = nachSchluessel.get(k)!;
    if (liste.length < 2) ergebnis.push({ art: "einzeln", zeile: z });
    else ergebnis.push({ art: "gruppe", typ: z.typ, tag: tagVon(z.aktualisiertAm), zeilen: liste });
  }
  return ergebnis;
}
