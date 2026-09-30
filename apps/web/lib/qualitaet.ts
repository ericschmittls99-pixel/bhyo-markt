// Qualitaets-Ableitung nach E34 (docs/ap0-schema-entscheidungen.md,
// Abschnitt 13). Reine Funktion ohne DB-/Netzzugriff: Eingabe rein, Stufe
// raus. Die Stufe wird nie manuell gesetzt (CLAUDE.md: "Qualitaet A-D wird
// abgeleitet") — in der DB ist sie eine GENERATED-Spalte ueber die
// SQL-Funktion qualitaetsstufe(typ, datei_key, link_url, abgelaufen_am) aus Migration 0032;
// der Paritaetstest (scripts/qualitaet-paritaet.ts) haelt beide deckungsgleich.

/**
 * E34: Die sieben Belegtypen in ihrer verbindlichen Reihenfolge — sie ist
 * zugleich die Rangfolge der Beweiskraft und gilt ueberall: Formular-Chips,
 * Filteroptionen, Auswertung, Sortierung. Wer hier umsortiert, sortiert
 * ueberall um.
 */
export const BELEG_TYPEN = [
  "betriebsdaten",
  "vertrag",
  "absichtserklaerung",
  "angebot",
  "gespraech",
  "dokument",
  "webrecherche",
] as const;

export type BelegTyp = (typeof BELEG_TYPEN)[number];

export type Qualitaet = "A" | "B" | "C" | "D";

/** Anzeige-Label je Typ (Domaenenbegriffe deutsch, Reihenfolge aus BELEG_TYPEN). */
export const BELEG_LABEL: Record<BelegTyp, string> = {
  betriebsdaten: "Betriebsdaten",
  vertrag: "Vertrag",
  absichtserklaerung: "Absichtserklärung",
  angebot: "Angebot",
  gespraech: "Gespräch",
  dokument: "Dokument",
  webrecherche: "Webrecherche",
};

export function istBelegTyp(wert: unknown): wert is BelegTyp {
  return typeof wert === "string" && (BELEG_TYPEN as readonly string[]).includes(wert);
}

/** Rang eines Typs in der E34-Reihenfolge (0 = hoechste Beweiskraft); unbekannt sortiert hinten. */
export function belegTypRang(typ: string): number {
  const i = (BELEG_TYPEN as readonly string[]).indexOf(typ);
  return i === -1 ? BELEG_TYPEN.length : i;
}

/**
 * E33: Die oberen vier Typen tragen ihre Faelligkeit selbst — `gueltig_bis`
 * ist bei ihnen Pflicht (Formular ab Schritt 1, CHECK ab Schritt 3). Die
 * unteren drei haben kein Enddatum im Dokument und bekommen eine Typ-Frist
 * ab Erhebungsdatum (siehe lib/verifizierung.ts).
 */
export const GUELTIG_BIS_PFLICHT: readonly BelegTyp[] = [
  "betriebsdaten",
  "vertrag",
  "absichtserklaerung",
  "angebot",
];

export function brauchtGueltigBis(typ: BelegTyp): boolean {
  return GUELTIG_BIS_PFLICHT.includes(typ);
}

/**
 * E33: Ein Feld, typabhaengig beschriftet — die Beschriftung nennt, was das
 * Datum fachlich bedeutet. Fuer die unteren drei Typen gibt es kein Feld.
 */
export const GUELTIG_BIS_BESCHRIFTUNG: Record<BelegTyp, string | null> = {
  betriebsdaten: "Daten repräsentativ bis",
  vertrag: "Vertrag läuft bis",
  absichtserklaerung: "Absichtserklärung gültig bis",
  angebot: "Angebot gültig bis",
  gespraech: null,
  dokument: null,
  webrecherche: null,
};

/**
 * Normalisierte Sicht auf einen Beleg fuer die Ableitung. Seit E34 zaehlen
 * nur noch Typ und der typspezifische Nachweis (Datei bzw. Datei oder Link).
 * Quellenangabe, Erhebungsdatum, gueltig_bis und Freigabe sind Pflichten
 * bzw. Felder mit eigener Bedeutung, aber keine Stufenbedingungen mehr.
 */
export interface BelegBewertung {
  typ: BelegTyp;
  dateiKey?: string | null;
  linkUrl?: string | null;
  /** AP2.4 (E62, D3): Ablauf-Markierung des Pruefers (JJJJ-MM-TT) — wertet eine Stufe ab. */
  abgelaufenAm?: string | null;
}

function gesetzt(wert?: string | null): boolean {
  return typeof wert === "string" && wert.trim().length > 0;
}

/**
 * E34: Liegt der typspezifische Nachweis vor? Betriebsdaten, Angebot und
 * Dokument genuegt Datei ODER Link; Vertrag und Absichtserklaerung verlangen
 * die Datei. Gespraech und Webrecherche sind "glatt" — fuer sie ist die
 * Frage ohne Wirkung auf die Stufe (der Link bei Webrecherche ist eine
 * Formularpflicht, keine Stufenbedingung).
 */
export function nachweisVollstaendig(beleg: BelegBewertung): boolean {
  const datei = gesetzt(beleg.dateiKey);
  const dateiOderLink = datei || gesetzt(beleg.linkUrl);
  switch (beleg.typ) {
    case "betriebsdaten":
    case "angebot":
    case "dokument":
      return dateiOderLink;
    case "vertrag":
    case "absichtserklaerung":
      return datei;
    case "gespraech":
    case "webrecherche":
      return true;
  }
}

/**
 * E34-Matrix. Vollstaendig / unvollstaendig:
 *   betriebsdaten A/B · vertrag A/B · absichtserklaerung B/C · angebot B/C ·
 *   gespraech C/C · dokument C/D · webrecherche D/D.
 * D ist die Untergrenze; "unbelegt" bleibt dem Strom ohne Beleg vorbehalten (E24).
 */
export function deriveQualitaet(beleg: BelegBewertung): Qualitaet {
  const basis = basisStufe(beleg);
  // E62 D3: Nur die Markierung wertet ab — eine bloss ueberfaellige
  // Verifikation nicht. D bleibt D (Untergrenze).
  return basis; // tmp Rot-Nachweis: Spiegel ohne Abwertung
}

const EINE_STUFE_TIEFER: Record<Qualitaet, Qualitaet> = { A: "B", B: "C", C: "D", D: "D" };

/** E34-Matrix ohne die D3-Abwertung — Spiegel des CASE in qualitaetsstufe(). */
function basisStufe(beleg: BelegBewertung): Qualitaet {
  const voll = nachweisVollstaendig(beleg);
  switch (beleg.typ) {
    case "betriebsdaten":
    case "vertrag":
      return voll ? "A" : "B";
    case "absichtserklaerung":
    case "angebot":
      return voll ? "B" : "C";
    case "gespraech":
      return "C";
    case "dokument":
      return voll ? "C" : "D";
    case "webrecherche":
      return "D";
  }
}

/**
 * F4: Eine Eingabe wie "www.beispiel.de" oder "beispiel.de/pfad" ist als
 * Beleg-Link gemeint — die App ergaenzt das Schema, statt die Eingabe
 * abzuweisen. Vorhandene Schemata (http/https) bleiben unangetastet,
 * ebenso Leerwerte. Bewusst kein Erraten von Tippfehlern: nur das fehlende
 * "https://" wird vorangestellt.
 */
export function normalisiereUrl(roh: string | null): string | null {
  const t = (roh ?? "").trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  // Andere Schemata (mailto:, ftp:, …) nicht anfassen.
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  return `https://${t}`;
}

/**
 * F7: Stufen-Obergrenze eines Belegtyps OHNE Datei/Link — null, wenn eine
 * Datei die Stufe gar nicht hoebe (gespraech, webrecherche). Speist den
 * Live-Hinweis im Formular: "Ohne Datei oder Link erreicht dieser Beleg nur
 * Stufe X".
 */
export function stufeObergrenzeOhneDatei(typ: BelegTyp): Qualitaet | null {
  const ohne = deriveQualitaet({ typ, dateiKey: null, linkUrl: null });
  const mit = deriveQualitaet({ typ, dateiKey: "x", linkUrl: null });
  return mit === ohne ? null : ohne;
}
