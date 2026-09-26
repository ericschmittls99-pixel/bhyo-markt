import { CLUSTER_LABEL } from "./farben";
import { filterKlartext } from "./export-filtertext";
import { type ExportKontext, exportModus } from "./export-modell";
import { exportAnsicht, exportZeilen } from "./export-zeilen";
import { type Ansicht, type Sicht, leiste, leseSicht } from "./filter-modell";
import { ladeAlleVergaben, ladeRegionOptionen, ladeStroeme } from "./stroeme";
import { type Strom, facettenOptionen, filterAusSearchParams } from "./stroeme-modell";
import { type VergabeDaten, reichereVerfuegbarkeitAn } from "./verfuegbarkeit";
import { reichereVerifikationAn } from "./verifizierung";

/**
 * EIN Ladepfad für beide Ausgaben (CSV-Route und Druck-Route, F6): dieselbe
 * Adresse (Filtermodell E32, `sicht=`, `ansicht=`, `modus=`), derselbe
 * Datenpfad mit Anreicherung wie in den Ansichten, dieselben Metazeilen.
 */

const ANSICHT_TEXT: Record<Ansicht, string> = {
  stroeme: "ströme.",
  karte: "karte.",
  auswertung: "auswertung.",
};
const SICHT_TEXT: Record<Sicht, string> = {
  feedstock: "Feedstock",
  outputs: "Outputs",
  alle: "Feedstock und Outputs",
};

/** Stand in deutscher Schreibweise, Europe/Berlin — die Datei sagt selbst, wann sie entstand. */
export function standText(jetzt: Date): string {
  const f = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${f.format(jetzt)} Uhr`;
}

export interface ExportDaten {
  rows: Strom[];
  kontext: ExportKontext;
  sicht: Sicht;
  stichtag: string;
}

export async function ladeExport(roh: Record<string, string>, jetzt = new Date()): Promise<ExportDaten> {
  const { sicht } = leseSicht(roh.sicht, "alle");
  const ansicht = exportAnsicht(roh.ansicht);
  const modus = exportModus(roh.modus);

  const leereMap = new Map<string, VergabeDaten[]>();
  const [bioRoh, outRoh, vergabenBio, vergabenOut, regionen] = await Promise.all([
    sicht !== "outputs" ? ladeStroeme("biomasse") : Promise.resolve([] as Strom[]),
    sicht !== "feedstock" ? ladeStroeme("output") : Promise.resolve([] as Strom[]),
    sicht !== "outputs" ? ladeAlleVergaben("biomasse") : Promise.resolve(leereMap),
    sicht !== "feedstock" ? ladeAlleVergaben("output") : Promise.resolve(leereMap),
    ladeRegionOptionen(),
  ]);
  const stichtag = jetzt.toISOString().slice(0, 10);
  const anreichern = (pool: Strom[], vergaben: Map<string, VergabeDaten[]>) =>
    reichereVerifikationAn(reichereVerfuegbarkeitAn(pool, vergaben, stichtag), vergaben, stichtag);
  const bio = anreichern(bioRoh, vergabenBio);
  const out = anreichern(outRoh, vergabenOut);
  const rows = [...exportZeilen(bio, roh), ...exportZeilen(out, roh)];

  const filter = filterAusSearchParams(roh) as unknown as Record<string, unknown>;
  const optionen = facettenOptionen(sicht === "outputs" ? "output" : "biomasse", [...bio, ...out], regionen, CLUSTER_LABEL);
  const lst = leiste(ansicht, sicht, filter, optionen);
  const kontext: ExportKontext = {
    modus,
    stand: standText(jetzt),
    ansicht: `${ANSICHT_TEXT[ansicht]} · ${SICHT_TEXT[sicht]}`,
    bezugsjahr: Number(stichtag.slice(0, 4)),
    aktiveFilter: filterKlartext([...lst.haupt, ...lst.weitere].map((e) => e.def), filter, optionen),
    nichtAngewandt: filterKlartext(lst.zurueckgehalten, filter, optionen),
  };
  return { rows, kontext, sicht, stichtag };
}
