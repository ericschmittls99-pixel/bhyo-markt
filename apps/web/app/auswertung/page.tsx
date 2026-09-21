import { AuswertungAnsicht } from "@/components/auswertung/AuswertungAnsicht";
import type { FacettenChipDef } from "@/components/stroeme/FacettenChips";
import {
  auswahlZeile,
  belegtypZeilen,
  clusterZeilen,
  jahresBalken,
  kpiKarten,
  outputJahre,
  outputMengen,
  outputPotenzialZeilen,
  outputPreisZeilen,
  saldoZeilen,
  preisKorridorZeilen,
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
  // Kein Alle-Tab (Spec-Aenderung Eric): die Kacheln sind artrein, ohne
  // Parameter (z. B. von karte. kommend) gilt Feedstock.
  const sichtRoh = ersterWert(sp.sicht);
  const sicht = sichtRoh === "outputs" ? ("outputs" as const) : ("feedstock" as const);
  const art = sicht === "outputs" ? ("output" as const) : ("biomasse" as const);

  const [pool, regionen] = await Promise.all([
    ladeStroeme(art),
    ladeRegionOptionen(),
  ]);
  const recs = filterStroeme(pool, filter);

  const jetzt = new Date();
  const heuteIso = jetzt.toISOString().slice(0, 10);
  const aktuellesJahr = Number(heuteIso.slice(0, 4));

  // Facetten identisch zu karte. (geteiltes Filterschema, Delta 1.4),
  // je sicht: Feedstock -> Cluster/Materialart, Outputs -> Gruppe/Output.
  const opt = facettenOptionen(art, recs, regionen, CLUSTER_LABEL);
  const gruppeOptionen = Object.entries(OUTPUT_LABEL).map(([wert, label]) => ({
    wert,
    label,
  }));

  const facetten: FacettenChipDef[] = [
    { key: "region", label: "Region", optionen: opt.region ?? [] },
    ...(sicht === "feedstock"
      ? [
          { key: "cluster", label: "Cluster", optionen: opt.cluster ?? [] },
          { key: "materialart", label: "Materialart", optionen: opt.materialart ?? [] },
        ]
      : [
          { key: "gruppe", label: "Gruppe", optionen: gruppeOptionen },
          { key: "produkt", label: "Output", optionen: opt.produkt ?? [] },
        ]),
    { key: "qualitaet", label: "Qualität", optionen: opt.qualitaet ?? [] },
    { key: "status", label: "Status", optionen: opt.status ?? [] },
    { key: "belegtyp", label: "Belegtyp", optionen: opt.belegtyp ?? [] },
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
      auswahlText={auswahlZeile(recs)}
      anzahl={recs.length}
      cluster={sicht === "feedstock" ? clusterZeilen(pool, recs, sicht) : []}
      qualitaet={qualitaetsDaten(recs)}
      status={statusZeilen(recs)}
      saison={saisonDaten(recs)}
      belegtypen={belegtypZeilen(recs)}
      jahre={sicht === "feedstock" ? jahresBalken(recs, aktuellesJahr) : []}
      saldo={sicht === "feedstock" ? saldoZeilen(pool, recs) : []}
      preisKorridore={sicht === "feedstock" ? preisKorridorZeilen(pool, recs) : []}
      outMengen={sicht === "outputs" ? outputMengen(pool, recs) : null}
      outPotenzial={sicht === "outputs" ? outputPotenzialZeilen(pool, recs) : []}
      outPreise={sicht === "outputs" ? outputPreisZeilen(pool, recs) : null}
      outJahre={sicht === "outputs" ? outputJahre(recs, aktuellesJahr) : null}
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
