import type { StromArt } from "./stroeme-modell";

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

  if (e.belegTyp) {
    pflicht("beleg_quellenangabe", e.belegQuellenangabe);
    pflicht("beleg_erhebungsdatum", e.belegErhebungsdatum);
    if (!e.belegHatDatei && !e.belegLink.trim())
      f.beleg_datei = "Datei oder Link erforderlich";
  }

  return f;
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

export function formularZeileZuWerte(art: StromArt, r: FormularZeile): FormularWerte {
  return {
    id: r.id,
    art,
    akteurId: s(r.akteurId),
    akteurName: s(r.akteurName),
    akteurSektor: r.akteurSektor,
    bezeichnung: s(r.bezeichnung),
    ort: s(r.ort),
    landkreis: s(r.landkreis),
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
    beleg: belegAusZeile(r),
  };
}
