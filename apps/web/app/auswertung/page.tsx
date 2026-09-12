import { AuswertungAnsicht } from "@/components/auswertung/AuswertungAnsicht";
import type { FacettenChipDef } from "@/components/stroeme/FacettenChips";
import {
  belegtypZeilen,
  clusterFussnote,
  clusterZeilen,
  jahresBalken,
  kpiKarten,
  preisDaten,
  qualitaetsDaten,
  saisonDaten,
  statusZeilen,
  verifZeilen,
} from "@/lib/auswertung-modell";
import { CLUSTER_LABEL, OUTPUT_LABEL } from "@/lib/farben";
import {
  ladeErsteAenderung,
  ladeHistorie,
  ladeRegionOptionen,
  ladeStroeme,
} from "@/lib/stroeme";
import {
  facettenOptionen,
  filterAusSearchParams,
  filterStroeme,
  type SearchParamsRoh,
  type Strom,
} from "@/lib/stroeme-modell";
import { naechsteVerifizierung } from "@/lib/verifizierung";

export const dynamic = "force-dynamic";

function ersterWert(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return s ?? "";
}

/**
 * auswertung. (V2, AP1i PR 7): Bento-Dashboard. Der Datenpfad laeuft wie bei
 * karte. ueber die getesteten PR-3-Mapper (ladeStroeme) und die pure
 * Filter-/Kennzahlenlogik (filterStroeme, auswertung-modell) — es gibt keine
 * SQL-Aggregation und keine sql<number>-Behauptung mehr (Schritt 0, PR 7).
 * Zeitpunkte entstehen hier an der Seitengrenze, nie im Modell.
 */
export default async function AuswertungPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRoh>;
}) {
  const sp = await searchParams;
  const filter = filterAusSearchParams(sp);
  const sichtRoh = ersterWert(sp.sicht);
  const sicht =
    sichtRoh === "feedstock" ? ("feedstock" as const)
    : sichtRoh === "outputs" ? ("outputs" as const)
    : ("alle" as const);

  const [bio, out, regionen] = await Promise.all([
    sicht !== "outputs" ? ladeStroeme("biomasse") : Promise.resolve([] as Strom[]),
    sicht !== "feedstock" ? ladeStroeme("output") : Promise.resolve([] as Strom[]),
    ladeRegionOptionen(),
  ]);

  const bioGefiltert = filterStroeme(bio, filter);
  const outGefiltert = filterStroeme(out, filter);
  const pool = [...bio, ...out];
  const recs = [...bioGefiltert, ...outGefiltert];

  const jetzt = new Date();
  const heuteIso = jetzt.toISOString().slice(0, 10);
  const aktuellesJahr = Number(heuteIso.slice(0, 4));

  // Facetten identisch zu karte. (geteiltes Filterschema, Delta 1.4).
  const bioOpt = facettenOptionen("biomasse", bioGefiltert, regionen, CLUSTER_LABEL);
  const outOpt = facettenOptionen("output", outGefiltert, regionen, CLUSTER_LABEL);
  const basisOpt = sicht === "outputs" ? outOpt : bioOpt;
  const gruppeOptionen = Object.entries(OUTPUT_LABEL).map(([wert, label]) => ({
    wert,
    label,
  }));

  const facetten: FacettenChipDef[] = [
    { key: "region", label: "Region", optionen: basisOpt.region ?? [] },
    ...(sicht !== "outputs"
      ? [
          { key: "cluster", label: "Cluster", optionen: bioOpt.cluster ?? [] },
          ...(sicht === "feedstock"
            ? [{ key: "materialart", label: "Materialart", optionen: bioOpt.materialart ?? [] }]
            : []),
        ]
      : []),
    ...(sicht !== "feedstock"
      ? [
          { key: "gruppe", label: "Gruppe", optionen: gruppeOptionen },
          ...(sicht === "outputs"
            ? [{ key: "produkt", label: "Output", optionen: outOpt.produkt ?? [] }]
            : []),
        ]
      : []),
    { key: "qualitaet", label: "Qualität", optionen: basisOpt.qualitaet ?? [] },
    { key: "status", label: "Status", optionen: basisOpt.status ?? [] },
    { key: "belegtyp", label: "Belegtyp", optionen: basisOpt.belegtyp ?? [] },
  ];

  const auswahl = Object.fromEntries(
    facetten.map(({ key }) => [key, filter[key as "cluster"] as string[]]),
  );
  const bereich = { vonAb: filter.vonAb, erstellt: filter.erstellt };
  const irgendeinFilter =
    filter.q.trim() !== "" ||
    facetten.some(({ key }) => (filter[key as "cluster"] as string[]).length > 0) ||
    filter.vonAb !== "" ||
    filter.erstellt !== "";

  // Detail wie karte. (eine Detailansicht, zwei Einstiegspunkte): Strom nicht
  // im Pool (Filter/500er-Limit) -> gezielt nachladen, Art unbekannt.
  const detailId = ersterWert(sp.detail);
  let detailStrom: Strom | null = detailId
    ? (pool.find((s) => s.id === detailId) ?? null)
    : null;
  if (detailId && !detailStrom)
    detailStrom =
      (await ladeStroeme("biomasse", detailId))[0] ??
      (await ladeStroeme("output", detailId))[0] ??
      null;
  const [historie, ersteAenderung] = detailStrom
    ? await Promise.all([
        ladeHistorie(detailStrom.art, detailStrom.id),
        ladeErsteAenderung(detailStrom.art, detailStrom.id),
      ])
    : [[], null];
  const begruendung =
    ersteAenderung && ersteAenderung.includes(": ")
      ? ersteAenderung.slice(ersteAenderung.indexOf(": ") + 2)
      : null;

  return (
    <AuswertungAnsicht
      kpis={kpiKarten(recs, sicht)}
      cluster={clusterZeilen(pool, recs, sicht)}
      clusterFuss={clusterFussnote(recs, sicht)}
      qualitaet={qualitaetsDaten(recs)}
      status={statusZeilen(recs)}
      saison={saisonDaten(recs)}
      belegtypen={belegtypZeilen(recs)}
      jahre={jahresBalken(recs, sicht, aktuellesJahr)}
      preis={preisDaten(recs, sicht)}
      verif={verifZeilen(recs, heuteIso)}
      facetten={facetten}
      auswahl={auswahl}
      bereich={bereich}
      sicht={sicht}
      irgendeinFilter={irgendeinFilter}
      detailStrom={detailStrom}
      historie={historie}
      begruendung={begruendung}
      verifizierung={
        detailStrom?.beleg ? naechsteVerifizierung(detailStrom.beleg) : null
      }
    />
  );
}
