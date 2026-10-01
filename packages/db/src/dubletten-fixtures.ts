/**
 * AP2.5 PR c: EINE Fixture-Liste fuer beide Normalisierungen — die SQL-Funktion
 * akteur_name_norm (Migration 0038, geprueft von dubletten-check in der CI
 * gegen die Preview) und das TypeScript-Spiegelbild apps/web/lib/akteur-norm.ts
 * (geprueft von akteur-norm.test.ts). Weicht eine Seite ab, wird es rot.
 */
export const NORM_FIXTURES: readonly (readonly [eingabe: string, erwartet: string])[] = [
  ["Müller Agrar GmbH", "mueller agrar"],
  ["Mueller Agrar", "mueller agrar"],
  ["Müller Agrar GmbH & Co. KG", "mueller agrar"],
  ["Biogas Kraichgau GmbH & Co. KG", "biogas kraichgau"],
  ["Biogas Kraichgau KG", "biogas kraichgau"],
  ["Forstbetrieb Rheinhessen e.K.", "forstbetrieb rheinhessen"],
  ["Verein Streuobst Weinstraße e.V.", "verein streuobst weinstrasse"],
  ["Projektgesellschaft Rhein-Neckar mbH", "projektgesellschaft rhein neckar"],
  ["Gärtnerei Weinheim OHG", "gaertnerei weinheim"],
  ["Raiffeisen Mosbach eG", "raiffeisen mosbach"],
  ["Hof Sonnenberg GbR", "hof sonnenberg"],
  ["Energie Südwest AG", "energie suedwest"],
  ["Sägewerk Walldürn GmbH & Co. KG", "saegewerk wallduern"],
  ["  Stadt   Landau ", "stadt landau"],
  ["Papier & Pappe Germersheim", "papier pappe germersheim"],
  ["AVR Abfallverwertung Rhein-Neckar", "avr abfallverwertung rhein neckar"],
  ["Agrar UG (haftungsbeschränkt)", "agrar"],
  ["Kompostwerk 2000 Vorderpfalz", "kompostwerk 2000 vorderpfalz"],
  ["Segelclub Eberbach", "segelclub eberbach"],
  ["Agrarhandel Co. KG", "agrarhandel"],
];

/**
 * Paare mit der pg_trgm-Aehnlichkeit, wie sie das TypeScript-Spiegelbild
 * rechnet (apps/web/lib/akteur-norm.ts, `aehnlichkeit`) — dubletten-check
 * vergleicht sie mit similarity() der Datenbank (Toleranz 1e-6).
 */
export const AEHNLICHKEIT_FIXTURES: readonly (readonly [a: string, b: string, erwartet: number])[] = [
  ["mueller agrar", "mueller agrar", 1],
  ["stadtwerke speyer", "stadt speyer", 11 / 18],
  ["forstbetrieb rheinhessen", "forstamt pfaelzerwald", 5 / 42],
  ["papierfabrik neckartal", "papier pappe germersheim", 2 / 13],
  ["", "mueller", 0],
  // Referenz aus der pg_trgm-Dokumentation: similarity('word', 'two words') = 4/11.
  ["word", "two words", 4 / 11],
];
