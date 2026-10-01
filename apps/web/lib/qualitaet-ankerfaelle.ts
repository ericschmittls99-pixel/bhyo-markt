import { BELEG_TYPEN, type BelegBewertung, type BelegTyp } from "./qualitaet";

/**
 * E23/E34: Ankerfaelle der Qualitaets-Matrix — die eine Referenzliste, gegen
 * die BEIDE Implementierungen laufen: deriveQualitaet (TS, qualitaet.test.ts)
 * und die DB-Funktion qualitaetsstufe() aus Migration 0021
 * (scripts/qualitaet-paritaet.ts im Deploy-CI). Wer die Matrix aendert,
 * aendert Funktion, DB-Migration und diese Liste gemeinsam — sonst schlaegt
 * die Paritaet laut fehl.
 *
 * Fuer jeden der sieben Typen ein vollstaendiger und ein unvollstaendiger
 * Fall, dazu die Randfaelle, an denen die Matrix kippen koennte — und seit
 * AP2.4 (E62, D3) je Stufe der Fall „als abgelaufen markiert": eine Stufe
 * tiefer, D bleibt D.
 */
export interface Ankerfall {
  name: string;
  bewertung: BelegBewertung;
  erwartet: "A" | "B" | "C" | "D";
}

const DATEI = "belege/preview/abc.pdf";
const LINK = "https://quelle.example/dokument";

/** E34-Matrix: [vollstaendig, unvollstaendig] je Typ. */
const MATRIX: Record<BelegTyp, ["A" | "B" | "C" | "D", "A" | "B" | "C" | "D"]> = {
  betriebsdaten: ["A", "B"],
  vertrag: ["A", "B"],
  absichtserklaerung: ["B", "C"],
  angebot: ["B", "C"],
  gespraech: ["C", "C"],
  dokument: ["C", "D"],
  webrecherche: ["D", "D"],
};

export const ANKERFAELLE: Ankerfall[] = [
  // Vollstaendig: Datei liegt vor (genuegt jedem Typ).
  ...BELEG_TYPEN.map<Ankerfall>((typ) => ({
    name: `${typ} vollstaendig (Datei)`,
    bewertung: { typ, dateiKey: DATEI, linkUrl: null },
    erwartet: MATRIX[typ][0],
  })),
  // Unvollstaendig: weder Datei noch Link.
  ...BELEG_TYPEN.map<Ankerfall>((typ) => ({
    name: `${typ} unvollstaendig (ohne Datei und Link)`,
    bewertung: { typ, dateiKey: null, linkUrl: null },
    erwartet: MATRIX[typ][1],
  })),
  // Randfaelle: Der Link genuegt nur, wo "Datei oder Link" gilt.
  { name: "betriebsdaten nur mit Link", bewertung: { typ: "betriebsdaten", linkUrl: LINK }, erwartet: "A" },
  { name: "angebot nur mit Link", bewertung: { typ: "angebot", linkUrl: LINK }, erwartet: "B" },
  { name: "dokument nur mit Link", bewertung: { typ: "dokument", linkUrl: LINK }, erwartet: "C" },
  { name: "vertrag nur mit Link", bewertung: { typ: "vertrag", linkUrl: LINK }, erwartet: "B" },
  { name: "absichtserklaerung nur mit Link", bewertung: { typ: "absichtserklaerung", linkUrl: LINK }, erwartet: "C" },
  // Glatte Typen: auch mit Link keine andere Stufe.
  { name: "gespraech mit Link bleibt C", bewertung: { typ: "gespraech", linkUrl: LINK }, erwartet: "C" },
  { name: "webrecherche mit Link bleibt D", bewertung: { typ: "webrecherche", linkUrl: LINK }, erwartet: "D" },
  // Leerraum ist kein Nachweis.
  { name: "vertrag mit Leerraum als Datei-Key", bewertung: { typ: "vertrag", dateiKey: "   " }, erwartet: "B" },
  { name: "dokument mit Leerraum als Link", bewertung: { typ: "dokument", linkUrl: "  " }, erwartet: "D" },
  // E62 D3: Markierung „abgelaufen" wertet eine Stufe ab — je Stufe ein Fall, D bleibt D.
  { name: "A markiert → B (vertrag mit Datei)", bewertung: { typ: "vertrag", dateiKey: DATEI, abgelaufenAm: "2026-09-30" }, erwartet: "B" },
  { name: "B markiert → C (angebot mit Link)", bewertung: { typ: "angebot", linkUrl: LINK, abgelaufenAm: "2026-09-30" }, erwartet: "C" },
  { name: "C markiert → D (gespraech)", bewertung: { typ: "gespraech", abgelaufenAm: "2026-09-30" }, erwartet: "D" },
  { name: "D markiert bleibt D (webrecherche)", bewertung: { typ: "webrecherche", linkUrl: LINK, abgelaufenAm: "2026-09-30" }, erwartet: "D" },
  // Ohne Markierung (null / leer) keine Abwertung.
  { name: "abgelaufen_am null: keine Abwertung", bewertung: { typ: "vertrag", dateiKey: DATEI, abgelaufenAm: null }, erwartet: "A" },
];
