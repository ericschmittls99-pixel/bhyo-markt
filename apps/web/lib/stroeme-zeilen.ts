import {
  GRUPPE_LABEL,
  type Strom,
  type StromBeleg,
  type StromVerwaltung,
  type SperrNutzer,
  type StromSperreAnzeige,
} from "./stroeme-modell";
import { kalendertag } from "./datum";
import { istVerifikationsZustand, type VerifikationsErgebnis } from "./verifikation";
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
/**
 * F0b: json_build_object kommt je nach Treiberpfad als Objekt ODER als
 * JSON-Text an — hier die EINE Konvertierungsstelle. null = kein Kreis
 * (ausserhalb oder ohne Koordinate; verwaltungsZustand unterscheidet das).
 */
export function verwaltungOderNull(v: unknown): StromVerwaltung | null {
  const roh = typeof v === "string" ? (JSON.parse(v) as unknown) : v;
  if (roh == null || typeof roh !== "object") return null;
  const o = roh as Record<string, unknown>;
  if (typeof o.kreisArs !== "string") return null;
  return {
    kreisArs: o.kreisArs,
    kreisName: (o.kreisName as string | null) ?? "",
    kreisBez: (o.kreisBez as string | null) ?? "",
    landArs: (o.landArs as string | null) ?? null,
    landName: (o.landName as string | null) ?? null,
  };
}

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
  /** E28: Belegnummer B-000123 aus der Sequenz (Anzeige und Suche). */
  belegNr: string | null;
  belegTyp: string | null;
  belegDateiKey: string | null;
  belegLinkUrl: string | null;
  belegExtern: boolean | null;
  belegGueltigBis: string | null;
  belegErstelltAm: Date | null;
  belegAbgelaufenAm?: string | null;
  belegMetadata: unknown;
};

/** AP2.4 (E62): die drei Spalten des Joins auf strom_verifikation(). */
type VerifikationZeile = {
  verifikationZustand?: unknown;
  verifiziertAm?: unknown;
  verifiziertBis?: unknown;
};

function zeitpunktOderNull(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Ohne Join-Treffer (sollte nicht vorkommen) bleibt der Strom unangereichert — kein stummes Raten. */
function verifikationAus(r: VerifikationZeile): VerifikationsErgebnis | undefined {
  const zustand = r.verifikationZustand == null ? null : String(r.verifikationZustand);
  if (!zustand || !istVerifikationsZustand(zustand)) return undefined;
  return {
    zustand,
    verifiziertAm: zeitpunktOderNull(r.verifiziertAm),
    verifiziertBis: r.verifiziertBis == null ? null : String(r.verifiziertBis).slice(0, 10),
  };
}

function belegAus(r: BelegZeile): StromBeleg | null {
  if (!r.belegTyp || !r.belegId) return null;
  const m = (r.belegMetadata ?? {}) as Record<string, unknown>;
  return {
    id: r.belegId,
    nr: r.belegNr,
    typ: r.belegTyp,
    quellenangabe: str(m.quellenangabe),
    href: r.belegDateiKey ? `/api/belege/${r.belegDateiKey}` : r.belegLinkUrl,
    externNachvollziehbar: r.belegExtern ?? false,
    gueltigBis: r.belegGueltigBis,
    // PR b: Kalendertag Europe/Berlin — dieselbe Achse wie die Frist-Aufloesung in SQL.
    erhebungsdatum: r.belegErstelltAm ? kalendertag(r.belegErstelltAm) : null,
    abgelaufenAm: r.belegAbgelaufenAm ?? null,
    kernnotiz: str(m.kernnotiz),
  };
}

type GemeinsameZeile = BelegZeile & VerifikationZeile & {
  id: string;
  akteurId: string | null;
  akteurName: string | null;
  sektor: string | null;
  sektorLabel: string | null;
  bezeichnung: string | null;
  kontaktperson: string | null;
  ort: string | null;
  verwaltung: unknown;
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
  /** AP2.3: Gueltigkeit der Reservierung in Monaten aus parameter_wert() ab reserviert_seit. */
  reservierungMonate?: unknown;
  createdAt: Date;
  /** E44 */
  gesperrtAm: Date | null;
  sperrInhaber: unknown;
  zuweisungen: unknown;
};

/** JSON kommt je nach Treiber als Objekt oder als Text an (siehe stringListe). */
function jsonWert(v: unknown): unknown {
  return typeof v === "string" ? JSON.parse(v) : v;
}
function nutzerAus(v: unknown): SperrNutzer | null {
  const o = jsonWert(v) as { id?: string; name?: string | null; email?: string } | null;
  return o && typeof o.id === "string" ? { id: o.id, name: o.name ?? null, email: o.email ?? "" } : null;
}
function sperreAus(r: Pick<GemeinsameZeile, "gesperrtAm" | "sperrInhaber">): StromSperreAnzeige | null {
  const von = nutzerAus(r.sperrInhaber);
  return von && r.gesperrtAm ? { von, am: r.gesperrtAm.toISOString() } : null;
}
function zuweisungenAus(v: unknown): SperrNutzer[] {
  const liste = jsonWert(v);
  return Array.isArray(liste) ? liste.map(nutzerAus).filter((n): n is SperrNutzer => n != null) : [];
}

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
    akteurId: r.akteurId,
    akteurName: r.akteurName,
    sektor: r.sektor,
    sektorLabel: r.sektorLabel,
    bezeichnung: r.bezeichnung,
    kontaktperson: r.kontaktperson,
    ort: r.ort,
    verwaltung: verwaltungOderNull(r.verwaltung),
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
    reservierungMonate: zahlOderNull(r.reservierungMonate),
    erstelltAm: tagBerlin.format(r.createdAt),
    beleg: b,
    verifikation: verifikationAus(r),
    sperre: sperreAus(r),
    zuweisungen: zuweisungenAus(r.zuweisungen),
  };
  return {
    ...basis,
    vollstaendigkeit: vollstaendigkeit({
      art: "biomasse",
      bezeichnung: basis.bezeichnung,
      kontaktperson: basis.kontaktperson,
      ort: basis.ort,
      koordinate: basis.lng != null && basis.lat != null,
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
        dateiOderLink: !!b.href,
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
    akteurId: r.akteurId,
    akteurName: r.akteurName,
    sektor: r.sektor,
    sektorLabel: r.sektorLabel,
    bezeichnung: r.bezeichnung,
    kontaktperson: r.kontaktperson,
    ort: r.ort,
    verwaltung: verwaltungOderNull(r.verwaltung),
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
    reservierungMonate: zahlOderNull(r.reservierungMonate),
    erstelltAm: tagBerlin.format(r.createdAt),
    beleg: b,
    verifikation: verifikationAus(r),
    sperre: sperreAus(r),
    zuweisungen: zuweisungenAus(r.zuweisungen),
  };
  return {
    ...basis,
    vollstaendigkeit: vollstaendigkeit({
      art: "output",
      bezeichnung: basis.bezeichnung,
      kontaktperson: basis.kontaktperson,
      ort: basis.ort,
      koordinate: basis.lng != null && basis.lat != null,
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
        dateiOderLink: !!b.href,
        kernnotiz: b.kernnotiz,
      },
      status: basis.status,
    }),
  };
}
