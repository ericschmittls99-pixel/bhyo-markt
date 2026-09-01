// Serverseitige Qualitaets-Ableitung nach docs/ap1b-handoff-erfassung.md
// Abschnitt 2. Reine Funktion ohne DB-/Netzzugriff: Eingabe rein, Stufe raus.
// Wird bei jedem Speichern neu berechnet und ist im Formular read-only – die
// Stufe wird nie manuell gesetzt (CLAUDE.md: "Qualitaet A-D wird abgeleitet").

export type BelegTyp =
  | "dokument_link"
  | "gespraech"
  | "angebot"
  | "absichtserklaerung"
  | "vertrag"
  | "betriebsdaten";

export type Qualitaet = "A" | "B" | "C" | "D";

/** Typ-spezifische Zusatzfelder aus beleg.metadata (jsonb). */
export interface BelegMetadata {
  /** dokument_link: manuell gesetztes Toggle "Amtliche Quelle oder Betreiberdaten". */
  amtlich?: boolean | null;
  quellenangabe?: string | null;
  gespraechsdatum?: string | null;
  gespraechspartner?: string | null;
  kernnotiz?: string | null;
}

/**
 * Normalisierte Sicht auf einen Beleg, unabhaengig von der DB-Ablage. Der
 * Aufrufer mappt Formular bzw. Datenbankzeile auf diese Form.
 */
export interface BelegBewertung {
  typ: BelegTyp;
  externNachvollziehbar: boolean;
  erhebungsdatum?: string | null;
  dateiKey?: string | null;
  linkUrl?: string | null;
  /** Nur relevant fuer `angebot` (dort Pflicht fuer "vollstaendig"). */
  gueltigBis?: string | null;
  metadata?: BelegMetadata | null;
}

function gesetzt(wert?: string | null): boolean {
  return typeof wert === "string" && wert.trim().length > 0;
}

/**
 * "vollstaendig" = alle Pflichtfelder des Beleg-Typs gesetzt (Doku Abschnitt 4).
 * Bewusst getrennt von `externNachvollziehbar` – beide zusammen ergeben erst die
 * hohe Stufe (siehe deriveQualitaet). Quellenangabe + Erhebungsdatum sind immer
 * Pflicht, der Rest haengt am Typ.
 */
export function pflichtfelderVollstaendig(beleg: BelegBewertung): boolean {
  const m = beleg.metadata ?? {};
  const quelle = gesetzt(m.quellenangabe);
  const erhebung = gesetzt(beleg.erhebungsdatum);
  const dateiOderLink = gesetzt(beleg.dateiKey) || gesetzt(beleg.linkUrl);

  if (!quelle || !erhebung) return false;

  switch (beleg.typ) {
    case "betriebsdaten":
    case "dokument_link":
      return dateiOderLink;
    case "vertrag":
    case "absichtserklaerung":
      return gesetzt(beleg.dateiKey);
    case "angebot":
      return dateiOderLink && gesetzt(beleg.gueltigBis);
    case "gespraech":
      // Kernnotiz ist empfohlen, aber nicht Pflicht.
      return gesetzt(m.gespraechsdatum) && gesetzt(m.gespraechspartner);
  }
}

/**
 * Leitet die Qualitaetsstufe A-D aus Beleg-Typ und Vollstaendigkeit ab.
 * "vollstaendig" verlangt zusaetzlich `externNachvollziehbar = true`.
 */
export function deriveQualitaet(beleg: BelegBewertung): Qualitaet {
  const vollstaendig =
    beleg.externNachvollziehbar && pflichtfelderVollstaendig(beleg);

  switch (beleg.typ) {
    case "betriebsdaten":
    case "vertrag":
      return vollstaendig ? "A" : "B";
    case "absichtserklaerung":
      return vollstaendig ? "B" : "C";
    case "angebot":
    case "gespraech":
      return vollstaendig ? "C" : "D";
    case "dokument_link":
      if (!vollstaendig) return "D";
      return beleg.metadata?.amtlich ? "B" : "C";
  }
}

/**
 * Gueltigkeitsdauer je Beleg-Typ (Doku Abschnitt 4). Aktuell nur `betriebsdaten`
 * verbindlich festgelegt: 12 Monate ab Erhebungsdatum. `angebot` traegt sein
 * "gueltig bis" als Nutzereingabe (Pflichtfeld), wird also nicht hier berechnet.
 * Andere Typen haben (noch) keine Verfallsdauer – dann kein `gueltig_bis`.
 */
export function berechneGueltigBis(
  typ: BelegTyp,
  erhebungsdatum: string | null | undefined,
  angebotGueltigBis?: string | null,
): string | null {
  if (typ === "angebot") return gesetzt(angebotGueltigBis) ? angebotGueltigBis! : null;
  if (typ === "betriebsdaten" && gesetzt(erhebungsdatum)) {
    const d = new Date(erhebungsdatum!);
    d.setMonth(d.getMonth() + 12);
    return d.toISOString().slice(0, 10);
  }
  return null;
}
