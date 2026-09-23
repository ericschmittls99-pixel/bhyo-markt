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
  poolJahresAchse,
  potenzialZeilen,
  preisKorridorZeilen,
  qualitaetsDaten,
  saisonDaten,
  statusZeilen,
  verifZeilen,
} from "@/lib/auswertung-modell";
import {
  ALLE_FENSTER_KATEGORIEN,
  wendeFensterAn,
  type FensterKategorie,
} from "@/lib/fenster";
import { CLUSTER_LABEL, OUTPUT_LABEL } from "@/lib/farben";
import {
  ladeAlleVergaben,
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
import { verifikationsFaelligkeit } from "@/lib/verifizierung";

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

  const [pool, regionen, vergabenMap] = await Promise.all([
    ladeStroeme(art),
    ladeRegionOptionen(),
    ladeAlleVergaben(art),
  ]);

  const jetzt = new Date();
  const heuteIso = jetzt.toISOString().slice(0, 10);
  const aktuellesJahr = Number(heuteIso.slice(0, 4));

  // Zeitbezug (AP1j PR 4): Einzeljahr (Default aktuelles Jahr) oder
  // Zeitraum; oe pro Jahr oder Summe (beim Einzeljahr identisch).
  const zeitmodus =
    ersterWert(sp.zeitmodus) === "zeitraum"
      ? ("zeitraum" as const)
      : ("einzeljahr" as const);
  const agg =
    zeitmodus === "zeitraum" && ersterWert(sp.agg) === "summe"
      ? ("summe" as const)
      : ("oe" as const);
  const jahreRoh = ersterWert(sp.jahre)
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n));
  const poolAchse = poolJahresAchse(pool, aktuellesJahr);
  const jahre =
    zeitmodus === "einzeljahr"
      ? [
          jahreRoh.find((j) => poolAchse.includes(j)) ??
            (poolAchse.includes(aktuellesJahr)
              ? aktuellesJahr
              : poolAchse[poolAchse.length - 1]!),
        ]
      : jahreRoh.filter((j) => poolAchse.includes(j)).length
        ? jahreRoh.filter((j) => poolAchse.includes(j)).sort()
        : poolAchse;

  // verfuegbarkeit wirkt hier FENSTERBEZOGEN (Handoff), nicht auf heute —
  // deshalb aus dem normalen Filter heraushalten und ueber wendeFensterAn
  // anwenden; alle Module rechnen mit den fensterbezogen skalierten Kopien.
  const recsHeute = filterStroeme(pool, { ...filter, verfuegbarkeit: [] });
  const recs = wendeFensterAn(
    recsHeute,
    vergabenMap,
    jahre,
    filter.verfuegbarkeit,
    agg,
  );
  const fensterKats: ReadonlySet<FensterKategorie> | null =
    filter.verfuegbarkeit.length
      ? new Set(
          ALLE_FENSTER_KATEGORIEN.filter((k) =>
            filter.verfuegbarkeit.includes(k),
          ),
        )
      : null;

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
    {
      key: "verfuegbarkeit",
      label: "Verfügbarkeit",
      optionen: opt.verfuegbarkeit ?? [],
    },
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
      kpis={kpiKarten(recs, sicht, agg === "summe")}
      auswahlText={auswahlZeile(recs)}
      anzahl={recs.length}
      cluster={sicht === "feedstock" ? clusterZeilen(pool, recs, sicht) : []}
      qualitaet={qualitaetsDaten(recs)}
      status={statusZeilen(recs)}
      saison={saisonDaten(recs)}
      belegtypen={belegtypZeilen(recs)}
      jahre={
        sicht === "feedstock"
          ? jahresBalken(recsHeute, aktuellesJahr, vergabenMap, fensterKats)
          : []
      }
      potenzial={sicht === "feedstock" ? potenzialZeilen(pool, recs) : []}
      preisKorridore={sicht === "feedstock" ? preisKorridorZeilen(pool, recs) : []}
      outMengen={sicht === "outputs" ? outputMengen(pool, recs) : null}
      outPotenzial={sicht === "outputs" ? outputPotenzialZeilen(pool, recs) : null}
      outPreise={sicht === "outputs" ? outputPreisZeilen(pool, recs) : null}
      outJahre={
        sicht === "outputs"
          ? outputJahre(recsHeute, aktuellesJahr, vergabenMap, fensterKats)
          : null
      }
      verif={verifZeilen(recs, heuteIso, vergabenMap)}
      facetten={facetten}
      auswahl={auswahl}
      bereich={bereich}
      sicht={sicht}
      zeitmodus={zeitmodus}
      agg={agg}
      jahreAuswahl={jahre}
      poolAchse={poolAchse}
      irgendeinFilter={irgendeinFilter}
      detailStrom={detailStrom}
      historie={historie}
      begruendung={begruendung}
      verifizierung={
        detailStrom
          ? verifikationsFaelligkeit(
              detailStrom.beleg,
              detailStrom,
              vergabenMap.get(detailStrom.id) ?? [],
            )
          : null
      }
    />
  );
}
