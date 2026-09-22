import { cookies } from "next/headers";

import { KarteAnsicht } from "@/components/karte/KarteAnsicht";
import type { KarteRegion } from "@/components/karte/KarteMap";
import type { FacettenChipDef } from "@/components/stroeme/FacettenChips";
import { CLUSTER_LABEL, OUTPUT_LABEL } from "@/lib/farben";
import { stromZuPunkt, type KartePunkt } from "@/lib/karte-modell";
import { listRegionGebiete } from "@/lib/register";
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
  type FacettenOption,
  type SearchParamsRoh,
  type Strom,
} from "@/lib/stroeme-modell";
import {
  reichereVerfuegbarkeitAn,
  type VergabeDaten,
} from "@/lib/verfuegbarkeit";
import { parseUiState, UI_COOKIE } from "@/lib/ui-state";
import { verifikationsFaelligkeit } from "@/lib/verifizierung";

export const dynamic = "force-dynamic";

function ersterWert(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return s ?? "";
}

/**
 * karte. (V2, AP1i PR 6): Vollbreite MapLibre-Karte. Der Datenpfad laeuft
 * ueber die getesteten PR-3-Mapper (ladeStroeme -> Strom mit konvertierten
 * lng/lat) statt ueber sql<number>-Behauptungen; gefiltert wird mit demselben
 * Querystring-Schema wie stroeme./auswertung. (inkl. sicht=).
 */
export default async function KartePage({
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

  const leereMap = new Map<string, VergabeDaten[]>();
  const [bioRoh, outRoh, regionen, umrisse, ui, vergabenBio, vergabenOut] =
    await Promise.all([
      sicht !== "outputs" ? ladeStroeme("biomasse") : Promise.resolve([] as Strom[]),
      sicht !== "feedstock" ? ladeStroeme("output") : Promise.resolve([] as Strom[]),
      ladeRegionOptionen(),
      listRegionGebiete(),
      cookies().then((c) => parseUiState(c.get(UI_COOKIE)?.value)),
      sicht !== "outputs" ? ladeAlleVergaben("biomasse") : Promise.resolve(leereMap),
      sicht !== "feedstock" ? ladeAlleVergaben("output") : Promise.resolve(leereMap),
    ]);

  // Verfuegbarkeitsstatus EINMAL je Request anreichern (PR 3) — Tooltip,
  // Sidebar und die neue Facette lesen dasselbe Feld.
  const stichtag = new Date().toISOString().slice(0, 10);
  const bio = reichereVerfuegbarkeitAn(bioRoh, vergabenBio, stichtag);
  const out = reichereVerfuegbarkeitAn(outRoh, vergabenOut, stichtag);

  // Exklusiv filtern (Beschluss 22.09.2026): cluster blendet Outputs aus,
  // gruppe blendet Feedstock aus — sonst bleibt die fremde Art ungefiltert
  // stehen (CO2-Orb trotz Cluster-Filter).
  const bioGefiltert = filter.gruppe.length ? [] : filterStroeme(bio, filter);
  const outGefiltert = filter.cluster.length ? [] : filterStroeme(out, filter);
  const pool = [...bioGefiltert, ...outGefiltert];
  const punkte = pool
    .map(stromZuPunkt)
    .filter((p): p is KartePunkt => p != null);
  const poolPunkte = [...bio, ...out]
    .map(stromZuPunkt)
    .filter((p): p is KartePunkt => p != null);
  const gesamtStroeme = bio.length + out.length;

  // Regionen: Umriss + Anzahl der (gefilterten) Stroeme, deren Standort in
  // der Region liegt (regionIds kommen fertig aus dem PR-3-Datenpfad).
  const karteRegionen: KarteRegion[] = umrisse.map((r) => ({
    id: r.id,
    name: r.name,
    geojson: r.geojson,
    anzahl: pool.filter((s) => s.regionIds.includes(r.id) && s.lng != null).length,
  }));

  // Facetten je sicht (Delta 1.4): Optionen aus dem UNGEFILTERTEN Pool
  // (Pool-Prinzip wie stroeme., Karten-Review 22.09.2026) — Filtern laesst
  // die Optionslisten nicht mehr zusammenschrumpfen. In der Sicht "alle"
  // speisen BEIDE Arten die gemeinsamen Listen (Union nach Wert; bei
  // Label-Konflikt gewinnt Feedstock, dokumentiert im Handoff).
  const bioOpt = facettenOptionen("biomasse", bio, regionen, CLUSTER_LABEL);
  const outOpt = facettenOptionen("output", out, regionen, CLUSTER_LABEL);
  const misch = (a: FacettenOption[] = [], b: FacettenOption[] = []) => {
    const map = new Map(b.map((o) => [o.wert, o]));
    for (const o of a) map.set(o.wert, o);
    return [...map.values()].sort((x, y) => x.label.localeCompare(y.label, "de"));
  };
  const basisOpt =
    sicht === "outputs"
      ? outOpt
      : sicht === "feedstock"
        ? bioOpt
        : {
            region: misch(bioOpt.region, outOpt.region),
            qualitaet: misch(bioOpt.qualitaet, outOpt.qualitaet),
            status: misch(bioOpt.status, outOpt.status),
            verfuegbarkeit: misch(bioOpt.verfuegbarkeit, outOpt.verfuegbarkeit),
            belegtyp: misch(bioOpt.belegtyp, outOpt.belegtyp),
          };
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
    {
      key: "verfuegbarkeit",
      label: "Verfügbarkeit",
      optionen: basisOpt.verfuegbarkeit ?? [],
    },
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

  // Marker-Klick oeffnet DASSELBE Detail wie stroeme. (Spec-Anpassung Eric):
  // vollen Strom + Historie laden; nicht im Pool (Filter/500er-Limit) →
  // gezielt nachladen, Art ist unbekannt, also beide probieren.
  const detailId = ersterWert(sp.detail);
  let detailStrom: Strom | null = detailId
    ? ([...bio, ...out].find((s) => s.id === detailId) ?? null)
    : null;
  if (detailId && !detailStrom) {
    const nachgeladen =
      (await ladeStroeme("biomasse", detailId))[0] ??
      (await ladeStroeme("output", detailId))[0] ??
      null;
    detailStrom = nachgeladen
      ? reichereVerfuegbarkeitAn(
          [nachgeladen],
          nachgeladen.art === "biomasse" ? vergabenBio : vergabenOut,
          stichtag,
        )[0]!
      : null;
  }
  const detailVergaben = detailStrom
    ? ((detailStrom.art === "biomasse" ? vergabenBio : vergabenOut).get(
        detailStrom.id,
      ) ?? [])
    : [];
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
  const detailPunkt = detailId
    ? (punkte.find((p) => p.id === detailId) ?? null)
    : null;

  return (
    <KarteAnsicht
      punkte={punkte}
      poolPunkte={poolPunkte}
      gesamtStroeme={gesamtStroeme}
      regionen={karteRegionen}
      facetten={facetten}
      auswahl={auswahl}
      bereich={bereich}
      sicht={sicht}
      detailPunkt={detailPunkt}
      detailStrom={detailStrom}
      detailVerfuegbarkeit={detailStrom?.verfuegbarkeit ?? null}
      detailVergaben={detailVergaben}
      historie={historie}
      begruendung={begruendung}
      verifizierung={
        detailStrom
          ? verifikationsFaelligkeit(detailStrom.beleg, detailStrom, detailVergaben)
          : null
      }
      filterOffenInitial={!!ui.filterOffen?.karte}
      legendeInitial={ui.legende ?? { offen: true }}
      umrisseInitial={ui.legende?.umrisse ?? true}
      irgendeinFilter={irgendeinFilter}
    />
  );
}
