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
  // Abkuerzung SW (Stadtwerke) wird aufgeloest; „Gem." bewusst nicht (gem. GmbH = gemeinnuetzig).
  ["SW Speyer", "stadtwerke speyer"],
  ["SW Speyer GmbH", "stadtwerke speyer"],
  ["Gem. Haßloch", "gem hassloch"],
  ["Südwest Energie", "suedwest energie"],
];

/**
 * Kalibrier-Paare (Entscheidung Eric 01.10.2026) — ROHE Namen, Klasse und
 * Ortsbezug (gleiche PLZ oder Sitz-Abstand <= 2 km):
 *  variante  — echte Varianten desselben Akteurs (sollen gefunden werden)
 *  kommunal  — kommunale falsche Treffer derselben Stadt (sollen NICHT als
 *              Dublette gelten; was dennoch erscheint, ist ein Fehlalarm)
 *  seed_stark / seed_schwach — die Kandidaten des Seeds
 * `aehnlichkeit` ist die mit dem TypeScript-Spiegelbild nachgerechnete
 * pg_trgm-similarity der normalisierten Namen, `wortTeilmenge` die
 * Zusatzregel (dubletten-check vergleicht beides mit der Datenbank), `grad`
 * das Ergebnis bei den gewaehlten Schwellen samt Zusatzregel
 * (dubletten-kalibrierung.test.ts haelt es fest; der Bericht in
 * docs/ap25-dubletten-kalibrierung.md nennt Treffer und Fehlalarme je Klasse).
 */
export type KalibrierKlasse = "variante" | "kommunal" | "seed_stark" | "seed_schwach";
export interface KalibrierPaar {
  a: string;
  b: string;
  klasse: KalibrierKlasse;
  gleicherOrt: boolean;
  aehnlichkeit: number;
  wortTeilmenge: boolean;
  grad: "stark" | "schwach" | null;
}
export const KALIBRIER_PAARE: readonly KalibrierPaar[] = [
  // Werte nachgerechnet mit: pnpm --filter web exec tsx scripts/dubletten-kalibrierung.ts --fixtures
  { a: "Müller Agrar GmbH", b: "Mueller Agrar", klasse: "seed_stark", gleicherOrt: true, aehnlichkeit: 1, wortTeilmenge: true, grad: "stark" },
  { a: "Stadtwerke Speyer GmbH", b: "Stadtwerke Speyer", klasse: "seed_stark", gleicherOrt: true, aehnlichkeit: 1, wortTeilmenge: true, grad: "stark" },
  { a: "Biogas Kraichgau GmbH & Co. KG", b: "Biogas Kraichgau KG", klasse: "seed_stark", gleicherOrt: true, aehnlichkeit: 1, wortTeilmenge: true, grad: "stark" },
  { a: "Forstbetrieb Rheinhessen e.K.", b: "Forstbetrieb Rheinhessen", klasse: "seed_schwach", gleicherOrt: false, aehnlichkeit: 1, wortTeilmenge: true, grad: "schwach" },
  { a: "Papierfabrik Neckartal AG", b: "Papierfabrik Neckartal", klasse: "seed_schwach", gleicherOrt: false, aehnlichkeit: 1, wortTeilmenge: true, grad: "schwach" },
  { a: "Stadtwerke Speyer", b: "Stadwerke Speyer", klasse: "variante", gleicherOrt: true, aehnlichkeit: 0.7368421052631579, wortTeilmenge: false, grad: "stark" },
  { a: "Müller Agrar", b: "Müler Agrar", klasse: "variante", gleicherOrt: true, aehnlichkeit: 0.8, wortTeilmenge: false, grad: "stark" },
  { a: "Kompostwerk Vorderpfalz", b: "Kompostwerk Vorderpflaz", klasse: "variante", gleicherOrt: false, aehnlichkeit: 0.7142857142857143, wortTeilmenge: false, grad: null },
  { a: "Raiffeisen Mosbach eG", b: "Raifeisen Mosbach", klasse: "variante", gleicherOrt: false, aehnlichkeit: 0.85, wortTeilmenge: false, grad: "schwach" },
  { a: "SW Speyer", b: "Stadtwerke Speyer", klasse: "variante", gleicherOrt: true, aehnlichkeit: 1, wortTeilmenge: true, grad: "stark" },
  { a: "SW Speyer GmbH", b: "Stadtwerke Speyer", klasse: "variante", gleicherOrt: false, aehnlichkeit: 1, wortTeilmenge: true, grad: "schwach" },
  { a: "Gem. Haßloch", b: "Gemeinde Haßloch", klasse: "variante", gleicherOrt: true, aehnlichkeit: 0.631578947368421, wortTeilmenge: false, grad: "stark" },
  { a: "Gem. Haßloch", b: "Gemeinde Haßloch", klasse: "variante", gleicherOrt: false, aehnlichkeit: 0.631578947368421, wortTeilmenge: false, grad: null },
  { a: "Hof Sonnenberg GbR", b: "Sonnenberg Hof", klasse: "variante", gleicherOrt: false, aehnlichkeit: 1, wortTeilmenge: true, grad: "schwach" },
  { a: "Biogas Kraichgau", b: "Kraichgau Biogas GmbH", klasse: "variante", gleicherOrt: false, aehnlichkeit: 1, wortTeilmenge: true, grad: "schwach" },
  { a: "Biogas Müller GmbH & Co. KG", b: "Müller Biogas", klasse: "variante", gleicherOrt: true, aehnlichkeit: 1, wortTeilmenge: true, grad: "stark" },
  { a: "Stadtwerke Speyer", b: "Stadtwerke Speyer Energie", klasse: "variante", gleicherOrt: true, aehnlichkeit: 0.68, wortTeilmenge: true, grad: "stark" },
  { a: "Stadtwerke Speyer", b: "Stadtwerke Speyer Energie", klasse: "variante", gleicherOrt: false, aehnlichkeit: 0.68, wortTeilmenge: true, grad: null },
  { a: "Biogas Kraichgau", b: "Biogasanlage Kraichgau", klasse: "variante", gleicherOrt: true, aehnlichkeit: 0.6666666666666666, wortTeilmenge: false, grad: "stark" },
  { a: "Forstbetrieb Rheinhessen", b: "Forstbetrieb Rheinhessen Nord", klasse: "variante", gleicherOrt: false, aehnlichkeit: 0.8333333333333334, wortTeilmenge: true, grad: "schwach" },
  { a: "Chemiepark Ludwigshafen GmbH", b: "Chemiepark Ludwigshafen Nord", klasse: "variante", gleicherOrt: false, aehnlichkeit: 0.8275862068965517, wortTeilmenge: true, grad: "schwach" },
  { a: "Entsorgung Mannheim GmbH", b: "Entsorgungsbetrieb Mannheim", klasse: "variante", gleicherOrt: true, aehnlichkeit: 0.6551724137931034, wortTeilmenge: false, grad: "stark" },
  { a: "AVR Abfallverwertung Rhein-Neckar", b: "AVR Rhein-Neckar", klasse: "variante", gleicherOrt: true, aehnlichkeit: 0.5151515151515151, wortTeilmenge: true, grad: "stark" },
  { a: "Stadt Speyer", b: "Stadtwerke Speyer", klasse: "kommunal", gleicherOrt: true, aehnlichkeit: 0.6111111111111112, wortTeilmenge: false, grad: "stark" },
  { a: "Stadt Speyer", b: "Gemeindewerke Speyer", klasse: "kommunal", gleicherOrt: true, aehnlichkeit: 0.2692307692307692, wortTeilmenge: false, grad: null },
  { a: "Stadtwerke Speyer", b: "Gemeindewerke Speyer", klasse: "kommunal", gleicherOrt: true, aehnlichkeit: 0.4074074074074074, wortTeilmenge: false, grad: null },
  { a: "Stadt Speyer", b: "Zweckverband Speyer", klasse: "kommunal", gleicherOrt: true, aehnlichkeit: 0.28, wortTeilmenge: false, grad: null },
  { a: "Stadtwerke Speyer", b: "Zweckverband Speyer", klasse: "kommunal", gleicherOrt: true, aehnlichkeit: 0.23333333333333334, wortTeilmenge: false, grad: null },
  { a: "Gemeinde Haßloch", b: "Gemeindewerke Haßloch", klasse: "kommunal", gleicherOrt: true, aehnlichkeit: 0.7083333333333334, wortTeilmenge: false, grad: "stark" },
  { a: "Gemeinde Haßloch", b: "Zweckverband Haßloch", klasse: "kommunal", gleicherOrt: true, aehnlichkeit: 0.2903225806451613, wortTeilmenge: false, grad: null },
  { a: "Stadt Hockenheim", b: "Stadtwerke Hockenheim", klasse: "kommunal", gleicherOrt: true, aehnlichkeit: 0.6956521739130435, wortTeilmenge: false, grad: "stark" },
  { a: "Stadt Landau", b: "Stadtwerke Landau in der Pfalz", klasse: "kommunal", gleicherOrt: true, aehnlichkeit: 0.375, wortTeilmenge: false, grad: null },
  { a: "Stadt Mannheim", b: "Stadtentwässerung Mannheim", klasse: "kommunal", gleicherOrt: true, aehnlichkeit: 0.4827586206896552, wortTeilmenge: false, grad: null },
  { a: "Stadtwerke Mannheim", b: "Stadtentwässerung Mannheim", klasse: "kommunal", gleicherOrt: true, aehnlichkeit: 0.4117647058823529, wortTeilmenge: false, grad: null },
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
