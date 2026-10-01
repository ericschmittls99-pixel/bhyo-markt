/**
 * AP2.5 PR c: Entscheidungen beim Zusammenfuehren — Feldkonflikte entscheidet
 * der Nutzer, voreingestellt gewinnt das Ziel. Felder sind Name, Sektor und
 * der Sitz als Ganzes (Adresse, PLZ, Ort und Pin gehoeren zusammen: der Pin
 * bestimmt den Kreis-ARS, E25).
 */
export const KONFLIKT_FELDER = ["name", "sektor", "sitz"] as const;
export type KonfliktFeld = (typeof KONFLIKT_FELDER)[number];
export type Gewinner = "ziel" | "quelle";
export type Entscheidungen = Partial<Record<KonfliktFeld, Gewinner>>;

export interface VergleichsAkteur {
  name: string;
  sektor: string;
  sitzStrasse: string | null;
  sitzHausnummer: string | null;
  sitzPlz: string | null;
  sitzOrt: string | null;
}

export function sitzSchluessel(a: VergleichsAkteur): string {
  return [a.sitzStrasse ?? "", a.sitzHausnummer ?? "", a.sitzPlz ?? "", a.sitzOrt ?? ""].map((s) => s.trim().toLowerCase()).join("|");
}

/** Welche Felder sich unterscheiden (nur die stehen zur Entscheidung). */
export function konflikte(ziel: VergleichsAkteur, quelle: VergleichsAkteur): KonfliktFeld[] {
  const k: KonfliktFeld[] = [];
  if (ziel.name.trim() !== quelle.name.trim()) k.push("name");
  if (ziel.sektor !== quelle.sektor) k.push("sektor");
  if (sitzSchluessel(ziel) !== sitzSchluessel(quelle)) k.push("sitz");
  return k;
}

/** Entscheidungen aus einem Formular/JSON lesen; unbekannte Felder und Werte fallen weg (Ziel gewinnt). */
export function entscheidungenAus(roh: unknown): Entscheidungen {
  const e: Entscheidungen = {};
  if (!roh || typeof roh !== "object") return e;
  for (const f of KONFLIKT_FELDER) {
    const w = (roh as Record<string, unknown>)[f];
    if (w === "quelle" || w === "ziel") e[f] = w;
  }
  return e;
}

export const GRAD_LABEL = { stark: "stark", schwach: "schwach" } as const;

/** Ergebnis der Server-Action akteureZusammenfuehren (Typen leben hier, die Action-Datei exportiert nur async-Funktionen). */
export interface ZusammenfuehrenErgebnis {
  ok: boolean;
  fehler?: string;
  zielId?: string;
  stroeme?: number;
  kontaktpersonen?: number;
}
