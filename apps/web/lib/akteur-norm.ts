/**
 * AP2.5 PR c (E66): Normalisierung des Akteurnamens — das TypeScript-
 * Spiegelbild der SQL-Funktion akteur_name_norm (Migration 0038). Beide
 * laufen gegen dieselben Fixtures (@bhyo/db/dubletten-fixtures): die SQL-
 * Seite prueft dubletten-check in der CI, diese Seite akteur-norm.test.ts.
 *
 * Form: Kleinschreibung, Umlaute (ae/oe/ue/ss), e.K./e.V. als Woerter, alles
 * Nicht-Alphanumerische zu Leerzeichen, Rechtsform-Woerter entfernt (bis
 * nichts mehr faellt), Leerraum zusammengezogen.
 *
 * Die Aehnlichkeit kommt in der Datenbank aus pg_trgm (similarity). Fuer die
 * Kalibrierung ohne Datenbank rechnet `aehnlichkeit` dieselben Trigramme
 * nach: je Wort zwei fuehrende und ein schliessendes Leerzeichen, Trigramme
 * als Menge, Aehnlichkeit = gemeinsame / vereinigte Trigramme.
 */
const RECHTSFORM_WOERTER = /(^|\s)(gmbh|mbh|gbr|kg|kgaa|ag|ohg|ug|se|eg|ek|ev|co|haftungsbeschraenkt|ltd|inc)(?=\s|$)/g;

export function akteurNameNorm(name: string): string {
  let s = name.toLowerCase();
  s = s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  s = s.replace(/\be\.\s?k\.?/g, " ek ").replace(/\be\.\s?v\.?/g, " ev ");
  s = s.replace(/[^a-z0-9]+/g, " ");
  for (;;) {
    const v = s.replace(RECHTSFORM_WOERTER, " ");
    if (v === s) break;
    s = v;
  }
  return s.replace(/\s+/g, " ").trim();
}

/** pg_trgm-Trigramme eines (bereits normalisierten) Texts. */
export function trigramme(text: string): Set<string> {
  const t = new Set<string>();
  for (const wort of text.split(/\s+/).filter(Boolean)) {
    const w = `  ${wort} `;
    for (let i = 0; i + 3 <= w.length; i++) t.add(w.slice(i, i + 3));
  }
  return t;
}

/** pg_trgm similarity: |A ∩ B| / |A ∪ B|; ohne Trigramme 0 (wie pg_trgm). */
export function aehnlichkeit(a: string, b: string): number {
  const ta = trigramme(a);
  const tb = trigramme(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let gemeinsam = 0;
  for (const t of ta) if (tb.has(t)) gemeinsam += 1;
  return gemeinsam / (ta.size + tb.size - gemeinsam);
}

/**
 * Schwellen (E66, kalibriert an den Seed-Namen — Bericht
 * docs/ap25-dubletten-kalibrierung.md, Begruendung im Entscheidungslog §35):
 *
 *  - STARK: Aehnlichkeit >= DUBLETTE_STARK UND gleiche PLZ oder gleicher
 *    Kreis-ARS. Mit Ortsbezug zaehlt die Trefferquote: echte Varianten
 *    (Tippfehler, Zusatzwort wie „Energie", „Nord") liegen bei 0,65–0,83,
 *    die Seed-Kandidaten bei 1,0; die falschen Freunde am selben Ort
 *    („Stadt X" · „Stadtwerke X" 0,70, „Forstbetrieb X" · „Agrarbetrieb X"
 *    0,62) werden bewusst mit vorgeschlagen — dafuer gibt es „keine Dublette".
 *  - SCHWACH: nur Aehnlichkeit >= DUBLETTE_SCHWACH. Ohne Ortsbezug zaehlt die
 *    Genauigkeit: gleiche Betriebsart an anderem Ort („Saegewerk Mannheim" ·
 *    „Saegewerk Weinheim" 0,58, „Winzergenossenschaft Weinheim" · „… Sinsheim"
 *    0,69) bleibt unter der Schwelle, der staerkste Nicht-Kandidat des Seeds
 *    liegt bei 0,696.
 *
 * dubletten-kalibrierung.test.ts haelt diese Trennung gegen den Seed fest.
 */
export const DUBLETTE_STARK = 0.6;
export const DUBLETTE_SCHWACH = 0.75;

export type DublettenGrad = "stark" | "schwach";

export function dublettenGrad(sim: number, gleicherOrt: boolean): DublettenGrad | null {
  if (sim >= DUBLETTE_STARK && gleicherOrt) return "stark";
  if (sim >= DUBLETTE_SCHWACH) return "schwach";
  return null;
}
