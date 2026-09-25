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
  filterStroemeMitBericht,
  nichtBeruecksichtigtText,
  type SearchParamsRoh,
  type Strom,
} from "@/lib/stroeme-modell";
import { verifikationsFaelligkeit } from "@/lib/verifizierung";
import { leiste } from "@/lib/filter-modell";
import { cookies } from "next/headers";
import { parseUiState, UI_COOKIE } from "@/lib/ui-state";
import { baeumeAus, hierarchienFuer } from "@/lib/leiste-hierarchien";

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
  // sie gilt in dieser Ansicht laut Modell nicht (der Scope haelt sie
  // heraus) und wird stattdessen ueber wendeFensterAn angewendet; alle
  // Module rechnen mit den fensterbezogen skalierten Kopien.
  const { stroeme: recsHeute, nichtBeruecksichtigt } = filterStroemeMitBericht(
    pool,
    filter,
    "auswertung",
  );
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

  // E32: Leiste aus dem Filtermodell statt einer eigenen Liste.
  const optionen: Record<string, { wert: string; label: string }[]> = {
    region: opt.region ?? [],
    cluster: opt.cluster ?? [],
    materialart: opt.materialart ?? [],
    gruppe: gruppeOptionen,
    produkt: opt.produkt ?? [],
    qualitaet: opt.qualitaet ?? [],
    status: opt.status ?? [],
    belegtyp: opt.belegtyp ?? [],
  };
  // Auf-/Zuklappzustand der Filterleiste wie in den anderen Ansichten.
  const ui = parseUiState((await cookies()).get(UI_COOKIE)?.value);
  const lst = leiste(
    "auswertung",
    sicht,
    filter as unknown as Record<string, unknown>,
    optionen,
  );
  // F5 PR B: Die Baeume kommen aus dem UNGEFILTERTEN Pool — der Baum zeigt
  // den Bestand, nicht die aktuelle Auswahl; sonst verschwaenden beim
  // Filtern die Aeste, ueber die man zurueckwaehlen wollte.
  const baeume = baeumeAus(pool);
  const hierarchien = hierarchienFuer(
    ["materialart", "produkt", "ort"],
    baeume,
    filter as unknown as Record<string, unknown>,
  );

  const facetten: FacettenChipDef[] = [...lst.haupt, ...lst.weitere]
    .filter((e) => e.def.typ === "facette" || e.def.typ === "hierarchie")
    .map((e) => ({
      key: e.def.params[0]!,
      label: e.def.label,
      optionen: e.optionen,
      hierarchie: hierarchien[e.def.key],
    }));
  const { auswahl, bereich, irgendeinFilter } = lst;
  const bereichKeys = [...lst.haupt, ...lst.weitere]
    .filter((e) => !["facette", "hierarchie", "text"].includes(e.def.typ))
    .flatMap((e) => e.def.params);

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
      cluster={sicht === "feedstock" ? clusterZeilen(pool, recs, sicht) : null}
      qualitaet={qualitaetsDaten(recs)}
      status={statusZeilen(recs)}
      saison={saisonDaten(recs)}
      belegtypen={belegtypZeilen(recs)}
      jahre={
        sicht === "feedstock"
          ? jahresBalken(recsHeute, aktuellesJahr, vergabenMap, fensterKats)
          : null
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
      bereichKeys={bereichKeys}
      offenInitial={!!ui.filterOffen?.auswertung}
      zurueckgehalten={lst.zurueckgehalten.map((f) => f.label)}
      hinweise={nichtBeruecksichtigt.map(nichtBeruecksichtigtText)}
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
