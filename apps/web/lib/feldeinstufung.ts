/**
 * AP2.4 PR a (E62, E43/D6): Feldeinstufung als Daten im Code. Jede Spalte
 * der vier Tabellen (biomassestrom, output_bedarf, beleg, vergabe_zeitraum)
 * ist genau einer Klasse zugeordnet:
 *
 *   fachlich      — aendert die Aussage des Eintrags; eine Aenderung an einem
 *                   geprueften Strom setzt ihn auf „in Pruefung" zurueck
 *                   (Ereignis zurueckgesetzt mit der Feldliste).
 *   redaktionell  — Notizen und Kontakt; kein Ruecksetzen.
 *   technisch     — Schluessel, Status, Sperre, Zeitstempel, Ableitungen;
 *                   schreibt die App nicht ueber das Formular. Ausdruecklich
 *                   gefuehrt, nicht weggelassen, damit eine NEUE Spalte ohne
 *                   Einstufung den Waechter (scripts/feld-check.ts) rot macht.
 *
 * Entscheidung Eric (30.09.2026, Schritt 0.5): extern_nachvollziehbar ist
 * redaktionell (die Freigabe regelt die Sichtbarkeit, nicht die Richtigkeit).
 * strom.kontaktperson (ebenfalls redaktionell) ist mit dem AP2.5 Contract
 * (Migration 0040) entfallen — der Kontakt lebt am Akteur (kontaktperson).
 * beleg.metadata ist jsonb: quellenangabe fachlich, kernnotiz redaktionell —
 * die Schluessel stehen hier gesondert.
 */
export type FeldKlasse = "fachlich" | "redaktionell" | "technisch";

export type FeldTabelle = "biomassestrom" | "output_bedarf" | "beleg" | "vergabe_zeitraum";

const STROM_GEMEINSAM: Record<string, FeldKlasse> = {
  id: "technisch",
  akteur_id: "fachlich",
  bezeichnung: "fachlich",
  ort: "fachlich",
  strasse: "fachlich",
  hausnummer: "fachlich",
  plz: "fachlich",
  standort_geom: "fachlich",
  zeitraum_von: "fachlich",
  zeitraum_bis: "fachlich",
  saisonalitaet: "fachlich",
  preis_herkunft: "fachlich",
  beleg_id: "fachlich",
  status: "technisch",
  reserviert_bhyo: "fachlich",
  reserviert_seit: "fachlich",
  gesperrt_von: "technisch",
  gesperrt_am: "technisch",
  created_at: "technisch",
  updated_at: "technisch",
};

export const FELD_EINSTUFUNG: Record<FeldTabelle, Record<string, FeldKlasse>> = {
  biomassestrom: {
    ...STROM_GEMEINSAM,
    materialart_code: "fachlich",
    menge_roh_fm: "fachlich",
    ts_anteil_pct: "fachlich",
    aschegehalt_pct: "fachlich",
    menge_atro: "technisch",
    preis_min: "fachlich",
    preis_mittel: "fachlich",
    preis_max: "fachlich",
  },
  output_bedarf: {
    ...STROM_GEMEINSAM,
    produkt_code: "fachlich",
    menge_wert: "fachlich",
    menge_einheit: "fachlich",
    preis: "fachlich",
    preis_einheit: "fachlich",
  },
  beleg: {
    id: "technisch",
    beleg_nr: "technisch",
    typ: "fachlich",
    datei_key: "fachlich",
    link_url: "fachlich",
    notiz: "redaktionell",
    gueltig_bis: "fachlich",
    extern_nachvollziehbar: "redaktionell",
    metadata: "fachlich",
    erstellt_am: "fachlich",
    qualitaet: "technisch",
    abgelaufen_am: "fachlich",
    created_at: "technisch",
  },
  vergabe_zeitraum: {
    id: "technisch",
    biomassestrom_id: "technisch",
    output_bedarf_id: "technisch",
    vergeben_von: "fachlich",
    vergeben_bis: "fachlich",
    vergeben_an: "fachlich",
    an_bhyo: "fachlich",
    created_at: "technisch",
    updated_at: "technisch",
  },
};

/** Schluessel in beleg.metadata (jsonb), gesondert eingestuft. */
export const METADATA_EINSTUFUNG: Record<string, FeldKlasse> = {
  quellenangabe: "fachlich",
  kernnotiz: "redaktionell",
};

export function istFachlich(tabelle: FeldTabelle, spalte: string): boolean {
  return FELD_EINSTUFUNG[tabelle][spalte] === "fachlich";
}

/**
 * Welche der geaenderten Felder sind fachlich? Eingabe: Feldnamen in
 * Spaltenschreibweise (snake_case), qualifiziert „tabelle.spalte" oder fuer
 * die Stromtabelle unqualifiziert. Unbekannte Felder gelten als fachlich —
 * lieber einmal zu viel zuruecksetzen als ein geaendertes Feld uebersehen.
 */
export function fachlicheFelder(tabelle: FeldTabelle, geaendert: readonly string[]): string[] {
  return geaendert.filter((feld) => {
    const punkt = feld.indexOf(".");
    const [t, sp] = punkt >= 0 ? ([feld.slice(0, punkt) as FeldTabelle, feld.slice(punkt + 1)] as const) : ([tabelle, feld] as const);
    if (t === "beleg" && sp.startsWith("metadata.")) return METADATA_EINSTUFUNG[sp.slice("metadata.".length)] !== "redaktionell";
    const klasse = FELD_EINSTUFUNG[t]?.[sp];
    return klasse === undefined || klasse === "fachlich";
  });
}
