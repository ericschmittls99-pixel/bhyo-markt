import { cookies } from "next/headers";

import { KarteAnsicht } from "@/components/karte/KarteAnsicht";
import type { KarteRegion } from "@/components/karte/KarteMap";
import type { FacettenChipDef } from "@/components/stroeme/FacettenChips";
import { CLUSTER_LABEL, OUTPUT_LABEL } from "@/lib/farben";
import { stromZuPunkt, type KartePunkt } from "@/lib/karte-modell";
import { listRegionGebiete } from "@/lib/register";
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
import { parseUiState, UI_COOKIE } from "@/lib/ui-state";
import { naechsteVerifizierung } from "@/lib/verifizierung";

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

  const [bio, out, regionen, umrisse, ui] = await Promise.all([
    sicht !== "outputs" ? ladeStroeme("biomasse") : Promise.resolve([] as Strom[]),
    sicht !== "feedstock" ? ladeStroeme("output") : Promise.resolve([] as Strom[]),
    ladeRegionOptionen(),
    listRegionGebiete(),
    cookies().then((c) => parseUiState(c.get(UI_COOKIE)?.value)),
  ]);

  const bioGefiltert = filterStroeme(bio, filter);
  const outGefiltert = filterStroeme(out, filter);
  const pool = [...bioGefiltert, ...outGefiltert];
  const punkte = pool
    .map(stromZuPunkt)
    .filter((p): p is KartePunkt => p != null);
  const gesamt = [...bio, ...out]
    .map(stromZuPunkt)
    .filter((p) => p != null).length;

  // Regionen: Umriss + Anzahl der (gefilterten) Stroeme, deren Standort in
  // der Region liegt (regionIds kommen fertig aus dem PR-3-Datenpfad).
  const karteRegionen: KarteRegion[] = umrisse.map((r) => ({
    id: r.id,
    name: r.name,
    geojson: r.geojson,
    anzahl: pool.filter((s) => s.regionIds.includes(r.id) && s.lng != null).length,
  }));

  // Facetten je sicht (Delta 1.4): gemeinsame Listen aus facettenOptionen,
  // gruppe aus den festen Gruppen-Labels.
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

  // Marker-Klick oeffnet DASSELBE Detail wie stroeme. (Spec-Anpassung Eric):
  // vollen Strom + Historie laden; nicht im Pool (Filter/500er-Limit) →
  // gezielt nachladen, Art ist unbekannt, also beide probieren.
  const detailId = ersterWert(sp.detail);
  let detailStrom: Strom | null = detailId
    ? ([...bio, ...out].find((s) => s.id === detailId) ?? null)
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
  const detailPunkt = detailId
    ? (punkte.find((p) => p.id === detailId) ?? null)
    : null;

  return (
    <KarteAnsicht
      punkte={punkte}
      gesamt={gesamt}
      regionen={karteRegionen}
      facetten={facetten}
      auswahl={auswahl}
      bereich={bereich}
      sicht={sicht}
      detailPunkt={detailPunkt}
      detailStrom={detailStrom}
      historie={historie}
      begruendung={begruendung}
      verifizierung={
        detailStrom?.beleg ? naechsteVerifizierung(detailStrom.beleg) : null
      }
      filterOffenInitial={!!ui.filterOffen?.karte}
      legendeInitial={ui.legende ?? { offen: true }}
      umrisseInitial={ui.legende?.umrisse ?? true}
      irgendeinFilter={irgendeinFilter}
    />
  );
}
