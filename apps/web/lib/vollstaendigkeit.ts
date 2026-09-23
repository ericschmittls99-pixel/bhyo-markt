// Erfassungsgrad eines Stroms (AP1i, V2-Mockup): Anteil gefuellter Felder.
// Reine Ableitung im Web-Code, KEIN Schema-Feld (Delta-Bericht §3). Die
// Checkliste folgt dem Mockup; einzige Abweichung: die Begruendung entfaellt
// als Pruefpunkt, weil sie im Datenmodell kein eigenes Feld ist (sie lebt im
// Aenderungslog und waere nach dem Anlegen immer "gefuellt").

export interface VollstaendigkeitEingabe {
  art: "biomasse" | "output";
  bezeichnung: string | null;
  kontaktperson: string | null;
  ort: string | null;
  landkreis: string | null;
  zeitraumVon: string | null;
  zeitraumBis: string | null;
  /** Rohmenge (Biomasse) bzw. Bedarfsmenge (Output). */
  menge: number | null;
  /** Biomasse: TS-Anteil %. */
  tsAnteil: number | null;
  /** Biomasse: Aschegehalt %. */
  aschegehalt: number | null;
  /** Output: Mengen-Einheit. */
  mengeEinheit: string | null;
  /** Biomasse: mittlerer Preis. Output: Abnahmepreis. */
  preis: number | null;
  /** Output: Preis-Einheit. */
  preisEinheit: string | null;
  /** 12 Monatswerte; "gefuellt" nur, wenn nicht alle gleich (= Gleichverteilung). */
  saisonalitaet: number[] | null;
  beleg: {
    typ: string;
    quellenangabe: string | null;
    erhebungsdatum: string | null;
    externNachvollziehbar: boolean;
    /** F7: Datei oder Link vorhanden — fehlende Datei ist fehlende Vollstaendigkeit. */
    dateiOderLink: boolean;
    /** Nur gespraech: Kernnotiz aus beleg.metadata. */
    kernnotiz: string | null;
  } | null;
  status: string;
}

function gefuellt(v: unknown): boolean {
  if (v == null || v === false) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

/** Saison zaehlt nur, wenn sie von der Gleichverteilung abweicht. */
function saisonGepflegt(saison: number[] | null): boolean {
  if (!saison || saison.length !== 12) return false;
  return saison.some((v) => Math.abs(v - saison[0]!) > 0.001);
}

/** Erfassungsgrad 0-100, gerundet. */
export function vollstaendigkeit(e: VollstaendigkeitEingabe): number {
  const feed = e.art === "biomasse";
  const b = e.beleg;
  const checks: unknown[] = [
    e.bezeichnung,
    e.kontaktperson,
    e.ort,
    e.landkreis,
    e.zeitraumVon,
    e.zeitraumBis,
    e.menge,
    feed ? e.tsAnteil : e.mengeEinheit,
    feed ? e.aschegehalt : e.preisEinheit,
    e.preis,
    saisonGepflegt(e.saisonalitaet),
    b?.quellenangabe,
    // Kernnotiz ist nur beim Gespraech ein Pruefpunkt; sonst zaehlt er als erfuellt.
    b ? (b.typ === "gespraech" ? b.kernnotiz : true) : false,
    b?.erhebungsdatum,
    b?.externNachvollziehbar,
    b?.dateiOderLink,
    e.status !== "entwurf",
  ];
  const voll = checks.filter(gefuellt).length;
  return Math.round((voll / checks.length) * 100);
}
