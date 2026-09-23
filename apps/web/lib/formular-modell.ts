import type { StromArt } from "./stroeme-modell";
// Nur Typ-Import: verfuegbarkeit.ts importiert zur Laufzeit aus dieser Datei,
// die Gegenrichtung bleibt typenreiner Import ohne Zykluswirkung.
import type { VergabeFormZeile } from "./verfuegbarkeit";

/**
 * Reine Formular-Logik fuer das Panel (AP1i PR 5) — ohne Datenbank- oder
 * Worker-Zugriff, damit jeder Datenpfad testbar ist (Lehre aus PR 3). Die
 * Loader liegen in lib/stroeme.ts, die Server-Action in lib/formular-actions.ts.
 */

// --- Monat <-> Datum ---------------------------------------------------------
// Das Datenmodell speichert Daten (JJJJ-MM-TT), das Formular fragt Monate ab
// (type="month", Delta-Bericht 1.3): von = Monatserster, bis = Monatsletzter.

export function datumZuMonat(d: string | null): string {
  return d ? d.slice(0, 7) : "";
}

export function monatZuVon(m: string): string {
  return `${m}-01`;
}

export function monatZuBis(m: string): string {
  const [j, mo] = m.split("-").map(Number);
  // Tag 0 des Folgemonats = letzter Tag dieses Monats (Schaltjahr-sicher).
  const letzter = new Date(Date.UTC(j!, mo!, 0)).getUTCDate();
  return `${m}-${String(letzter).padStart(2, "0")}`;
}

// --- Saisonalitaet -----------------------------------------------------------

/**
 * Saisonalitaet aus der DB (jsonb) oder vom Treiber als JSON-Text. Unerwartete
 * Formate werden protokolliert, nie stillschweigend geleert (Lehre aus PR 3).
 */
export function saisonOderLeer(v: unknown, kontext: string): number[] {
  if (Array.isArray(v) && v.length === 12) return v.map((x) => Number(x) || 0);
  if (typeof v === "string") {
    try {
      const p: unknown = JSON.parse(v);
      if (Array.isArray(p) && p.length === 12) return p.map((x) => Number(x) || 0);
    } catch {
      // faellt unten in die Protokollierung
    }
  }
  if (v != null) console.error(`Unerwartetes saisonalitaet-Format (${kontext}):`, v);
  return Array(12).fill(0);
}

/** Gleichverteilung: 12 × 8,3 % (Summe 99,6 — bewusst nicht kuenstlich auf 100 gezogen). */
export function gleichverteilung(): number[] {
  return Array(12).fill(Math.round((100 / 12) * 10) / 10);
}

/** Setzt einen Monatswert (0–100, ganzzahlig) und laesst die Nachbarn stehen. */
export function saisonWertSetzen(werte: number[], i: number, v: number): number[] {
  const geclampt = Math.min(100, Math.max(0, Math.round(v)));
  return werte.map((x, j) => (j === i ? geclampt : x));
}

// --- Gekoppelte Auswahllisten ------------------------------------------------

export function materialartenImCluster<T extends { cluster: string }>(
  alle: T[],
  cluster: string,
): T[] {
  return cluster ? alle.filter((m) => m.cluster === cluster) : alle;
}

export function clusterVonMaterialart(
  alle: { code: string; cluster: string }[],
  code: string,
): string {
  return alle.find((m) => m.code === code)?.cluster ?? "";
}

export function produkteInGruppe<T extends { gruppe: string }>(
  alle: T[],
  gruppe: string,
): T[] {
  return gruppe ? alle.filter((p) => p.gruppe === gruppe) : alle;
}

export function gruppeVonProdukt(
  alle: { code: string; gruppe: string }[],
  code: string,
): string {
  return alle.find((p) => p.code === code)?.gruppe ?? "";
}

// --- Preis-Herkunft -----------------------------------------------------------

export type PreisHerkunft = "eigene_datenbank" | "marktdaten" | "schaetzung";

/**
 * Gespeichert wird nur, was im Formular stand (Review #29): kein serverseitiges
 * Nachtragen einer nie gemachten Herkunfts-Aussage. "Schätzung" ist bei der
 * Neuanlage lediglich die Vorauswahl des Selects im FormularPanel.
 */
export function herkunftOderNull(roh: string | null): PreisHerkunft | null {
  if (roh === "eigene_datenbank" || roh === "marktdaten" || roh === "schaetzung")
    return roh;
  if (roh != null && roh !== "") console.error("Unerwartete preis_herkunft:", roh);
  return null;
}

// --- Einheiten (E13 + Mockup) ------------------------------------------------

export const MENGE_EINHEITEN = ["t/a", "MWh/a", "Nm³/a"] as const;
export const PREIS_EINHEITEN = ["€/t", "€/MWh", "€/kg", "€/Nm³"] as const;

// --- Validierung --------------------------------------------------------------

export type FeldFehler = Record<string, string>;

/** Vom Formular/der Action extrahierte Roh-Eingaben (getrimmte Strings). */
export interface FormularEingaben {
  akteurId: string;
  materialartCode: string;
  produktCode: string;
  mengeRohFm: string;
  tsAnteilPct: string;
  aschegehaltPct: string;
  mengeWert: string;
  mengeEinheit: string;
  preisMin: string;
  preisMittel: string;
  preisMax: string;
  preis: string;
  vonMonat: string;
  bisMonat: string;
  begruendung: string;
  belegTyp: string;
  belegQuellenangabe: string;
  belegErhebungsdatum: string;
  belegHatDatei: boolean;
  belegLink: string;
  /** F0a: Pin-Koordinate als Rohstrings der Hidden-Inputs ("" = kein Pin). */
  lat: string;
  lng: string;
}

const PFLICHT = "Pflichtfeld";
const KEINE_ZAHL = "Muss eine Zahl sein";

function zahlOk(v: string): boolean {
  return v === "" || Number.isFinite(Number(v.replace(",", ".")));
}

/**
 * Feld-Fehler fuer die Inline-Anzeige (leeres Objekt = gueltig). Die Keys sind
 * die FormData-Feldnamen; Client und Server nutzen dieselbe Funktion.
 */
export function validiereFormular(art: StromArt, e: FormularEingaben): FeldFehler {
  const f: FeldFehler = {};
  const pflicht = (key: string, wert: string) => {
    if (!wert.trim()) f[key] = PFLICHT;
  };
  const zahl = (key: string, wert: string) => {
    if (!zahlOk(wert)) f[key] = KEINE_ZAHL;
  };

  pflicht("akteur_id", e.akteurId);
  pflicht("zeitraum_von", e.vonMonat);
  pflicht("zeitraum_bis", e.bisMonat);
  pflicht("begruendung", e.begruendung);

  if (art === "biomasse") {
    pflicht("materialart_code", e.materialartCode);
    pflicht("menge_roh_fm", e.mengeRohFm);
    pflicht("ts_anteil_pct", e.tsAnteilPct);
    pflicht("aschegehalt_pct", e.aschegehaltPct);
    zahl("menge_roh_fm", e.mengeRohFm);
    zahl("ts_anteil_pct", e.tsAnteilPct);
    zahl("aschegehalt_pct", e.aschegehaltPct);
    zahl("preis_min", e.preisMin);
    zahl("preis_mittel", e.preisMittel);
    zahl("preis_max", e.preisMax);
    // E14: preis_* ist ein signierter Zahlungsstrom (negativ = Annahme-
    // entgelt). Die Reihenfolge Min <= Mittel <= Max muss auch ueber das
    // Vorzeichen hinweg gelten — verdrehte Werte wuerden Spannen und
    // Saldo still verzerren. Verglichen wird nur, was befuellt ist.
    const preisWert = (v: string): number | null =>
      v.trim() === "" || !zahlOk(v) ? null : Number(v.replace(",", "."));
    const pMin = preisWert(e.preisMin);
    const pMittel = preisWert(e.preisMittel);
    const pMax = preisWert(e.preisMax);
    if (pMin != null && pMittel != null && pMittel < pMin)
      f.preis_mittel ??= "Muss ≥ Min sein";
    if (pMittel != null && pMax != null && pMax < pMittel)
      f.preis_max ??= "Muss ≥ Mittel sein";
    if (pMin != null && pMax != null && pMax < pMin)
      f.preis_max ??= "Muss ≥ Min sein";
  } else {
    pflicht("produkt_code", e.produktCode);
    pflicht("menge_wert", e.mengeWert);
    pflicht("menge_einheit", e.mengeEinheit);
    zahl("menge_wert", e.mengeWert);
    zahl("preis", e.preis);
  }

  if (
    !f.zeitraum_von &&
    !f.zeitraum_bis &&
    e.vonMonat &&
    e.bisMonat &&
    e.bisMonat < e.vonMonat
  ) {
    f.zeitraum_bis = "Bis-Monat liegt vor dem Ab-Monat";
  }

  // F0a: Pin ist optional, aber nie halb — und nur mit plausiblen Werten.
  const latLeer = e.lat.trim() === "";
  const lngLeer = e.lng.trim() === "";
  if (latLeer !== lngLeer) {
    f.standort = "Pin unvollständig — Koordinate braucht Breite und Länge";
  } else if (!latLeer) {
    const lat = Number(e.lat.replace(",", "."));
    const lng = Number(e.lng.replace(",", "."));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      f.standort = "Koordinate außerhalb des gültigen Bereichs";
  }

  if (e.belegTyp) {
    pflicht("beleg_quellenangabe", e.belegQuellenangabe);
    pflicht("beleg_erhebungsdatum", e.belegErhebungsdatum);
    if (!e.belegHatDatei && !e.belegLink.trim())
      f.beleg_datei = "Datei oder Link erforderlich";
  }

  return f;
}

/** F0a: geparste Pin-Koordinate (null = kein Pin). Nach validiereFormular aufrufen. */
export function koordinateAus(
  e: Pick<FormularEingaben, "lat" | "lng">,
): { lat: number; lng: number } | null {
  if (e.lat.trim() === "" || e.lng.trim() === "") return null;
  return { lat: Number(e.lat.replace(",", ".")), lng: Number(e.lng.replace(",", ".")) };
}

// --- Formularwerte (Edit-Prefill) -------------------------------------------

export interface FormularBeleg {
  typ: string;
  quellenangabe: string;
  linkUrl: string;
  dateiKey: string | null;
  erhebungsdatum: string;
  gueltigBis: string;
  extern: boolean;
  amtlich: boolean;
  gespraechsdatum: string;
  gespraechspartner: string;
  kernnotiz: string;
}

/** Alle Werte Input-tauglich (Strings bzw. 12er-Array); "" = leer. */
export interface FormularWerte {
  id: string;
  art: StromArt;
  akteurId: string;
  akteurName: string;
  akteurSektor: string | null;
  bezeichnung: string;
  ort: string;
  landkreis: string;
  strasse: string;
  hausnummer: string;
  plz: string;
  bundesland: string;
  lat: string;
  lng: string;
  kontaktperson: string;
  cluster: string;
  materialartCode: string;
  produktCode: string;
  vonMonat: string;
  bisMonat: string;
  mengeRohFm: string;
  tsAnteilPct: string;
  aschegehaltPct: string;
  mengeWert: string;
  mengeEinheit: string;
  preisMin: string;
  preisMittel: string;
  preisMax: string;
  preis: string;
  preisEinheit: string;
  preisHerkunft: string;
  saisonalitaet: number[];
  status: string;
  reserviertBhyo: boolean;
  reserviertSeit: string | null;
  vergaben: VergabeFormZeile[];
  beleg: FormularBeleg | null;
}

/** Zeile der ladeFormularWerte-Query (nur echte Spalten, keine sql-Ausdruecke). */
export type FormularZeile = {
  id: string;
  akteurId: string | null;
  akteurName: string | null;
  akteurSektor: string | null;
  bezeichnung: string | null;
  ort: string | null;
  landkreis: string | null;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  bundesland: string | null;
  lat: number | null;
  lng: number | null;
  kontaktperson: string | null;
  materialartCode: string | null;
  cluster: string | null;
  produktCode: string | null;
  zeitraumVon: string | null;
  zeitraumBis: string | null;
  mengeRohFm: string | null;
  tsAnteilPct: string | null;
  aschegehaltPct: string | null;
  mengeWert: string | null;
  mengeEinheit: string | null;
  preisMin: string | null;
  preisMittel: string | null;
  preisMax: string | null;
  preis: string | null;
  preisEinheit: string | null;
  preisHerkunft: string | null;
  saisonalitaet: unknown;
  status: string;
  reserviertBhyo: boolean;
  reserviertSeit: string | null;
  belegId: string | null;
  belegTyp: string | null;
  belegLinkUrl: string | null;
  belegDateiKey: string | null;
  belegErstelltAm: Date | null;
  belegGueltigBis: string | null;
  belegExtern: boolean | null;
  belegMetadata: unknown;
};

const s = (v: string | null | undefined) => v ?? "";

function belegAusZeile(r: FormularZeile): FormularBeleg | null {
  if (!r.belegTyp) return null;
  const m = (r.belegMetadata ?? {}) as Record<string, unknown>;
  const mStr = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : "");
  return {
    typ: r.belegTyp,
    quellenangabe: mStr("quellenangabe"),
    linkUrl: s(r.belegLinkUrl),
    dateiKey: r.belegDateiKey,
    erhebungsdatum: r.belegErstelltAm
      ? r.belegErstelltAm.toISOString().slice(0, 10)
      : "",
    gueltigBis: s(r.belegGueltigBis),
    extern: r.belegExtern ?? false,
    amtlich: m.amtlich === true,
    gespraechsdatum: mStr("gespraechsdatum"),
    gespraechspartner: mStr("gespraechspartner"),
    kernnotiz: mStr("kernnotiz"),
  };
}

export function formularZeileZuWerte(
  art: StromArt,
  r: FormularZeile,
  vergaben: VergabeFormZeile[] = [],
): FormularWerte {
  return {
    id: r.id,
    art,
    akteurId: s(r.akteurId),
    akteurName: s(r.akteurName),
    akteurSektor: r.akteurSektor,
    bezeichnung: s(r.bezeichnung),
    ort: s(r.ort),
    landkreis: s(r.landkreis),
    strasse: s(r.strasse),
    hausnummer: s(r.hausnummer),
    plz: s(r.plz),
    bundesland: s(r.bundesland),
    lat: r.lat == null ? "" : String(r.lat),
    lng: r.lng == null ? "" : String(r.lng),
    kontaktperson: s(r.kontaktperson),
    cluster: s(r.cluster),
    materialartCode: s(r.materialartCode),
    produktCode: s(r.produktCode),
    vonMonat: datumZuMonat(r.zeitraumVon),
    bisMonat: datumZuMonat(r.zeitraumBis),
    mengeRohFm: s(r.mengeRohFm),
    tsAnteilPct: s(r.tsAnteilPct),
    aschegehaltPct: s(r.aschegehaltPct),
    mengeWert: s(r.mengeWert),
    mengeEinheit: s(r.mengeEinheit),
    preisMin: s(r.preisMin),
    preisMittel: s(r.preisMittel),
    preisMax: s(r.preisMax),
    preis: s(r.preis),
    preisEinheit: s(r.preisEinheit),
    preisHerkunft: s(r.preisHerkunft),
    saisonalitaet: saisonOderLeer(r.saisonalitaet, `strom ${r.id}`),
    status: r.status,
    reserviertBhyo: r.reserviertBhyo,
    reserviertSeit: r.reserviertSeit,
    vergaben,
    beleg: belegAusZeile(r),
  };
}
