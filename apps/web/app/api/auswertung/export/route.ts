import { ladeAlleVergaben, ladeRegionOptionen, ladeStroeme } from "@/lib/stroeme";
import { wacheFuerRoute } from "@/lib/wache";
import { CLUSTER_LABEL } from "@/lib/farben";
import { leiste, leseSicht, type Ansicht, type Sicht } from "@/lib/filter-modell";
import { erzeugeCsv, exportDateiname, exportModus, type ExportKontext } from "@/lib/export-modell";
import { exportAnsicht, exportZeilen } from "@/lib/export-zeilen";
import { filterKlartext } from "@/lib/export-filtertext";
import { type Strom, facettenOptionen, filterAusSearchParams } from "@/lib/stroeme-modell";
import { reichereVerifikationAn } from "@/lib/verifizierung";
import { reichereVerfuegbarkeitAn, type VergabeDaten } from "@/lib/verfuegbarkeit";

export const dynamic = "force-dynamic";

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
function standText(jetzt: Date): string {
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

/**
 * CSV-Export (E9, E36): exportiert genau die Auswahl der aufrufenden Ansicht
 * — dasselbe Querystring-Schema (Filtermodell E32, `sicht=`, `ansicht=`),
 * derselbe Datenpfad (ladeStroeme + Anreicherung + filterStroeme). Spalten,
 * Einstufung und Format kommen aus lib/export-modell.ts; der Modus
 * (`modus=extern|intern`, voreingestellt extern) entscheidet, ob nicht
 * freigegebene Belegangaben und Abnehmernamen zurückgehalten werden.
 */
export async function GET(req: Request) {
  // F8/E30: auch Lesen laeuft ueber die Wache — eine unbekannte oder
  // deaktivierte Adresse darf keine Daten sehen (fail closed).
  const wache = await wacheFuerRoute("lesen");
  if (!wache.ok) return wache.antwort;
  const p = new URL(req.url).searchParams;
  const roh: Record<string, string> = {};
  for (const [k, v] of p.entries()) roh[k] = v;
  const { sicht } = leseSicht(p.get("sicht") ?? undefined, "alle");
  const ansicht = exportAnsicht(p.get("ansicht"));
  const modus = exportModus(p.get("modus"));

  const leereMap = new Map<string, VergabeDaten[]>();
  const [bioRoh, outRoh, vergabenBio, vergabenOut, regionen] = await Promise.all([
    sicht !== "outputs" ? ladeStroeme("biomasse") : Promise.resolve([] as Strom[]),
    sicht !== "feedstock" ? ladeStroeme("output") : Promise.resolve([] as Strom[]),
    sicht !== "outputs" ? ladeAlleVergaben("biomasse") : Promise.resolve(leereMap),
    sicht !== "feedstock" ? ladeAlleVergaben("output") : Promise.resolve(leereMap),
    ladeRegionOptionen(),
  ]);
  // Verfuegbarkeit, Vergaben und Verifikation EINMAL je Request anreichern —
  // dieselben Funktionen wie in den Ansichten.
  const jetzt = new Date();
  const stichtag = jetzt.toISOString().slice(0, 10);
  const anreichern = (pool: Strom[], vergaben: Map<string, VergabeDaten[]>) =>
    reichereVerifikationAn(reichereVerfuegbarkeitAn(pool, vergaben, stichtag), vergaben, stichtag);
  const bio = anreichern(bioRoh, vergabenBio);
  const out = anreichern(outRoh, vergabenOut);
  const rows = [...exportZeilen(bio, roh), ...exportZeilen(out, roh)];

  // Aktive und nicht angewandte Filter im Klartext — aus dem Modell (E32),
  // Optionslabels aus demselben Pool wie die Leiste der Ansicht.
  const filter = filterAusSearchParams(roh);
  const artFuerOptionen = sicht === "outputs" ? "output" : "biomasse";
  const optionen = facettenOptionen(artFuerOptionen, [...bio, ...out], regionen, CLUSTER_LABEL);
  const lst = leiste(ansicht, sicht, filter as unknown as Record<string, unknown>, optionen);
  const kontext: ExportKontext = {
    modus,
    stand: standText(jetzt),
    ansicht: `${ANSICHT_TEXT[ansicht]} · ${SICHT_TEXT[sicht]}`,
    bezugsjahr: Number(stichtag.slice(0, 4)),
    aktiveFilter: filterKlartext(
      [...lst.haupt, ...lst.weitere].map((e) => e.def),
      filter as unknown as Record<string, unknown>,
      optionen,
    ),
    nichtAngewandt: filterKlartext(lst.zurueckgehalten, filter as unknown as Record<string, unknown>, optionen),
  };

  const csv = erzeugeCsv(rows, kontext);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportDateiname(sicht, modus, stichtag)}"`,
      "Cache-Control": "no-store",
    },
  });
}
