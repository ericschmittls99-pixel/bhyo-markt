import type { StromArt } from "./stroeme-modell";
import { kalendertag } from "./datum";
import { brauchtGueltigBis, istBelegTyp } from "./qualitaet";
// Nur Typ-Import: verfuegbarkeit.ts importiert zur Laufzeit aus dieser Datei,
// die Gegenrichtung bleibt typenreiner Import ohne Zykluswirkung.
import type { VergabeFormZeile } from "./verfuegbarkeit";
import { dezimalKanonisch, istMehrdeutig } from "@/lib/eingabe-format";

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

/** Gleichverteilung (Index-Konvention 23.09.2026): alle Monate auf 100. */
export function gleichverteilung(): number[] {
  return Array(12).fill(100);
}

/**
 * Ziehen im Editor: setzt einen Index (0–200, ganzzahlig), Nachbarn bleiben.
 * Werte ueber 200 gibt es nur ueber das Zahlenfeld (saisonWertDirekt) —
 * die Achse laeuft beim Ziehen nie davon.
 */
export function saisonWertSetzen(werte: number[], i: number, v: number): number[] {
  const geclampt = Math.min(200, Math.max(0, Math.round(v)));
  return werte.map((x, j) => (j === i ? geclampt : x));
}

/**
 * Zahlenfeld je Monat: kappt wie das Ziehen bei 200 (Review 23.09.2026 —
 * urspruenglich fuer Indizes >200 gedacht, wieder gestrichen). Extremere
 * Profile bleiben darstellbar, weil nur Verhaeltnisse zaehlen: statt
 * 240/100 zieht man die uebrigen Monate herunter (200/83 ist dasselbe
 * Profil).
 */
export function saisonWertDirekt(werte: number[], i: number, v: number): number[] {
  return saisonWertSetzen(werte, i, v);
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
  /** E33: gueltig_bis der oberen vier Typen (Pflicht in der Oberflaeche). */
  belegGueltigBis: string;
  /** F0a: Pin-Koordinate als Rohstrings der Hidden-Inputs ("" = kein Pin). */
  lat: string;
  lng: string;
  /** Saison-Index der 12 Monate (Skala bedeutungslos, nur Verhaeltnisse). */
  saison: number[];
}

const PFLICHT = "Pflichtfeld";
const KEINE_ZAHL = "Muss eine Zahl sein";
const MEHRDEUTIG =
  "Mehrdeutig — bitte Komma als Dezimaltrennzeichen (z. B. 33,333) oder die Punkte weglassen (33333)";

function zahlOk(v: string): boolean {
  return v === "" || Number.isFinite(Number(dezimalKanonisch(v)));
}

/** Eine Groesse, eine Umrechnung: derselbe Weg wie im Eingabefeld. */
function zahlWert(v: string): number | null {
  return v.trim() === "" || !zahlOk(v) ? null : Number(dezimalKanonisch(v));
}

/**
 * Feld-Fehler fuer die Inline-Anzeige (leeres Objekt = gueltig). Die Keys sind
 * die FormData-Feldnamen; Client und Server nutzen dieselbe Funktion.
 */
export function validiereFormular(
  art: StromArt,
  e: FormularEingaben,
  /** neu = Anlegen: keine Begruendungs-Pflicht (Review 23.09.2026). */
  kontext: { neu: boolean } = { neu: false },
): FeldFehler {
  const f: FeldFehler = {};
  const pflicht = (key: string, wert: string) => {
    if (!wert.trim()) f[key] = PFLICHT;
  };
  const zahl = (key: string, wert: string) => {
    // Mehrdeutig vor "keine Zahl": "10.000" IST eine Zahl, nur nicht
    // erkennbar welche. Der Hinweis muss sagen, was zu tun ist.
    if (istMehrdeutig(wert)) f[key] = MEHRDEUTIG;
    else if (!zahlOk(wert)) f[key] = KEINE_ZAHL;
  };

  pflicht("akteur_id", e.akteurId);
  pflicht("zeitraum_von", e.vonMonat);
  pflicht("zeitraum_bis", e.bisMonat);
  // Begruendung ist die Je-Aenderungs-Begruendung der Historie: beim
  // Bearbeiten Pflicht ("warum korrigiert"), beim Anlegen entfallen
  // (Review 23.09.2026). Auf die Qualitaets-Ableitung hat sie keinerlei
  // Einfluss.
  if (!kontext.neu) pflicht("begruendung", e.begruendung);

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
    const preisWert = zahlWert;
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
    // F7 (23.09.2026): Quellenangabe und Erhebungsdatum bleiben Pflicht;
    // Datei/Link sind optional — ein Beleg ohne Datei/Link ist speicherbar,
    // erreicht aber nur die niedrigere Stufe (E34-Matrix in qualitaet.ts).
    pflicht("beleg_quellenangabe", e.belegQuellenangabe);
    pflicht("beleg_erhebungsdatum", e.belegErhebungsdatum);
    if (istBelegTyp(e.belegTyp)) {
      // E33: Die oberen vier Typen tragen ihre Faelligkeit selbst — Pflicht
      // in der Oberflaeche ab Schritt 1, CHECK folgt in Schritt 3.
      if (brauchtGueltigBis(e.belegTyp)) pflicht("beleg_gueltig_bis", e.belegGueltigBis);
      // E34: Webrecherche verlangt den Link — FORMULARPFLICHT, keine
      // Stufenbedingung (die Stufe ist glatt D). Eine Recherche ohne Fundstelle
      // waere kein Beleg, nur eine Behauptung.
      if (e.belegTyp === "webrecherche") pflicht("beleg_link", e.belegLink);
    }
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
  /** E34: Freigabe zur externen Verwendung — kein Eingang der Stufe. */
  extern: boolean;
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
  strasse: string;
  hausnummer: string;
  plz: string;
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
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
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
    erhebungsdatum: r.belegErstelltAm ? kalendertag(r.belegErstelltAm) : "",
    gueltigBis: s(r.belegGueltigBis),
    extern: r.belegExtern ?? false,
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
    strasse: s(r.strasse),
    hausnummer: s(r.hausnummer),
    plz: s(r.plz),
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
