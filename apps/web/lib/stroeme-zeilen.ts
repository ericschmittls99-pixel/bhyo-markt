import {
  GRUPPE_LABEL,
  type Strom,
  type StromBeleg,
} from "./stroeme-modell";
import { vollstaendigkeit } from "./vollstaendigkeit";

/**
 * Reines Mapping von DB-Zeilen auf das Strom-Modell — ohne Datenbank- oder
 * Worker-Zugriff, damit der Pfad testbar ist. Der Postgres-Treiber im Worker
 * liefert SQL-Ausdruecke (json_agg, ST_X/ST_Y) je nach Typ-Aufloesung als
 * Zeichenkette statt als Array/Number; eine sql<...>-Annotation in Drizzle ist
 * keine Konvertierung. Deshalb konvertieren `stringListe` und `zahlOderNull`
 * hier an genau einer Stelle, statt an jeder Aufrufstelle zu hoffen.
 */

/** JSON-Aggregat (json_agg) → string[]; akzeptiert Array oder JSON-Text. */
export function stringListe(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // kein JSON — unten leeres Array
    }
  }
  return [];
}

/** Numerischer SQL-Ausdruck → number | null; akzeptiert Number oder Text. */
export function zahlOderNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

// Kalendertag in Europe/Berlin (sv-SE formatiert als JJJJ-MM-TT). Der
// "Erstellt am"-Filter und die Anzeige rechnen sonst mit dem UTC-Tag, waehrend
// die Historie Berliner Zeit zeigt.
const tagBerlin = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });

function parseSaison(j: unknown): number[] | null {
  if (Array.isArray(j) && j.length === 12) return j.map((x) => Number(x) || 0);
  return null;
}

function num(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export type BelegZeile = {
  belegId: string | null;
  belegTyp: string | null;
  belegDateiKey: string | null;
  belegLinkUrl: string | null;
  belegExtern: boolean | null;
  belegGueltigBis: string | null;
  belegErstelltAm: Date | null;
  belegMetadata: unknown;
};

function belegAus(r: BelegZeile): StromBeleg | null {
  if (!r.belegTyp || !r.belegId) return null;
  const m = (r.belegMetadata ?? {}) as Record<string, unknown>;
  return {
    id: r.belegId,
    typ: r.belegTyp,
    quellenangabe: str(m.quellenangabe),
    href: r.belegDateiKey ? `/api/belege/${r.belegDateiKey}` : r.belegLinkUrl,
    externNachvollziehbar: r.belegExtern ?? false,
    gueltigBis: r.belegGueltigBis,
    erhebungsdatum: r.belegErstelltAm
      ? r.belegErstelltAm.toISOString().slice(0, 10)
      : null,
    amtlich: typeof m.amtlich === "boolean" ? m.amtlich : null,
    gespraechsdatum: str(m.gespraechsdatum),
    gespraechspartner: str(m.gespraechspartner),
    kernnotiz: str(m.kernnotiz),
  };
}

type GemeinsameZeile = BelegZeile & {
  id: string;
  akteurName: string | null;
  sektor: string | null;
  bezeichnung: string | null;
  kontaktperson: string | null;
  ort: string | null;
  landkreis: string | null;
  regionIds: unknown;
  regionNamen: unknown;
  lng: unknown;
  lat: unknown;
  zeitraumVon: string | null;
  zeitraumBis: string | null;
  saisonalitaet: unknown;
  qualitaet: string | null;
  status: string;
  reserviertBhyo: boolean;
  reserviertSeit: string | null;
  createdAt: Date;
};

export type BiomasseZeile = GemeinsameZeile & {
  cluster: string | null;
  materialartCode: string | null;
  materialartLabel: string | null;
  mengeFm: string | null;
  tsAnteil: string | null;
  aschegehalt: string | null;
  mengeAtro: string | null;
  preisMin: string | null;
  preisMittel: string | null;
  preisMax: string | null;
  preisHerkunft: string | null;
};

export type OutputZeile = GemeinsameZeile & {
  gruppe: string | null;
  produktCode: string | null;
  produktLabel: string | null;
  kategorie: string | null;
  mengeWert: string | null;
  mengeEinheit: string | null;
  preis: string | null;
  preisEinheit: string | null;
};

export function biomasseZeileZuStrom(r: BiomasseZeile): Strom {
  const b = belegAus(r);
  const basis = {
    id: r.id,
    art: "biomasse" as const,
    akteurName: r.akteurName,
    sektor: r.sektor,
    bezeichnung: r.bezeichnung,
    kontaktperson: r.kontaktperson,
    ort: r.ort,
    landkreis: r.landkreis,
    regionIds: stringListe(r.regionIds),
    regionNamen: stringListe(r.regionNamen),
    lng: zahlOderNull(r.lng),
    lat: zahlOderNull(r.lat),
    cluster: r.cluster,
    materialartCode: r.materialartCode,
    materialartLabel: r.materialartLabel,
    mengeFm: num(r.mengeFm),
    tsAnteil: num(r.tsAnteil),
    aschegehalt: num(r.aschegehalt),
    mengeAtro: num(r.mengeAtro),
    preisMin: num(r.preisMin),
    preisMittel: num(r.preisMittel),
    preisMax: num(r.preisMax),
    preisHerkunft: r.preisHerkunft,
    gruppe: null,
    gruppeLabel: null,
    produktCode: null,
    produktLabel: null,
    kategorie: null,
    mengeWert: null,
    mengeEinheit: null,
    preis: null,
    preisEinheit: null,
    zeitraumVon: r.zeitraumVon,
    zeitraumBis: r.zeitraumBis,
    saisonalitaet: parseSaison(r.saisonalitaet),
    qualitaet: r.qualitaet,
    status: r.status,
    reserviertBhyo: r.reserviertBhyo,
    reserviertSeit: r.reserviertSeit,
    erstelltAm: tagBerlin.format(r.createdAt),
    beleg: b,
  };
  return {
    ...basis,
    vollstaendigkeit: vollstaendigkeit({
      art: "biomasse",
      bezeichnung: basis.bezeichnung,
      kontaktperson: basis.kontaktperson,
      ort: basis.ort,
      landkreis: basis.landkreis,
      zeitraumVon: basis.zeitraumVon,
      zeitraumBis: basis.zeitraumBis,
      menge: basis.mengeFm,
      tsAnteil: basis.tsAnteil,
      aschegehalt: basis.aschegehalt,
      mengeEinheit: null,
      preis: basis.preisMittel,
      preisEinheit: null,
      saisonalitaet: basis.saisonalitaet,
      beleg: b && {
        typ: b.typ,
        quellenangabe: b.quellenangabe,
        erhebungsdatum: b.erhebungsdatum,
        externNachvollziehbar: b.externNachvollziehbar,
        kernnotiz: b.kernnotiz,
      },
      status: basis.status,
    }),
  };
}

export function outputZeileZuStrom(r: OutputZeile): Strom {
  const b = belegAus(r);
  const basis = {
    id: r.id,
    art: "output" as const,
    akteurName: r.akteurName,
    sektor: r.sektor,
    bezeichnung: r.bezeichnung,
    kontaktperson: r.kontaktperson,
    ort: r.ort,
    landkreis: r.landkreis,
    regionIds: stringListe(r.regionIds),
    regionNamen: stringListe(r.regionNamen),
    lng: zahlOderNull(r.lng),
    lat: zahlOderNull(r.lat),
    cluster: null,
    materialartCode: null,
    materialartLabel: null,
    mengeFm: null,
    tsAnteil: null,
    aschegehalt: null,
    mengeAtro: null,
    preisMin: null,
    preisMittel: null,
    preisMax: null,
    preisHerkunft: null,
    gruppe: r.gruppe,
    gruppeLabel: r.gruppe ? (GRUPPE_LABEL[r.gruppe] ?? r.gruppe) : null,
    produktCode: r.produktCode,
    produktLabel: r.produktLabel,
    kategorie: r.kategorie,
    mengeWert: num(r.mengeWert),
    mengeEinheit: r.mengeEinheit,
    preis: num(r.preis),
    preisEinheit: r.preisEinheit,
    zeitraumVon: r.zeitraumVon,
    zeitraumBis: r.zeitraumBis,
    saisonalitaet: parseSaison(r.saisonalitaet),
    qualitaet: r.qualitaet,
    status: r.status,
    reserviertBhyo: r.reserviertBhyo,
    reserviertSeit: r.reserviertSeit,
    erstelltAm: tagBerlin.format(r.createdAt),
    beleg: b,
  };
  return {
    ...basis,
    vollstaendigkeit: vollstaendigkeit({
      art: "output",
      bezeichnung: basis.bezeichnung,
      kontaktperson: basis.kontaktperson,
      ort: basis.ort,
      landkreis: basis.landkreis,
      zeitraumVon: basis.zeitraumVon,
      zeitraumBis: basis.zeitraumBis,
      menge: basis.mengeWert,
      tsAnteil: null,
      aschegehalt: null,
      mengeEinheit: basis.mengeEinheit,
      preis: basis.preis,
      preisEinheit: basis.preisEinheit,
      saisonalitaet: basis.saisonalitaet,
      beleg: b && {
        typ: b.typ,
        quellenangabe: b.quellenangabe,
        erhebungsdatum: b.erhebungsdatum,
        externNachvollziehbar: b.externNachvollziehbar,
        kernnotiz: b.kernnotiz,
      },
      status: basis.status,
    }),
  };
}
