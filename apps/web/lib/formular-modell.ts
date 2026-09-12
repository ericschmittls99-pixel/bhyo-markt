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
