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
  fasseBerichteZusammen,
  filterStroemeMitBericht,
  nichtBeruecksichtigtText,
  type FacettenOption,
  type SearchParamsRoh,
  type Strom,
} from "@/lib/stroeme-modell";
import {
  reichereVerfuegbarkeitAn,
  type VergabeDaten,
} from "@/lib/verfuegbarkeit";
import { parseUiState, UI_COOKIE } from "@/lib/ui-state";
import { reichereVerifikationAn, verifikationsFaelligkeit } from "@/lib/verifizierung";
import { preisKorridorEinzel } from "@/lib/preiskorridor-einzel";
import { filterHinweis, filterLabel, leiste } from "@/lib/filter-modell";
import { baeumeAus, hierarchienFuer } from "@/lib/leiste-hierarchien";
import { withDb } from "@/lib/db";
import { FUER_MICH_LEER, fuerMichAktiv, reichereFuerMichAn, zeigeFuerMich } from "@/lib/fuer-mich";
import { ladeBeteiligungen } from "@/lib/fuer-mich-server";
import { aktuellerZugang } from "@/lib/rechte/wache";

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

  // E56: Zugang fuer den Schalter „Für mich"; Betrachter ohne Schalter und ohne Wirkung.
  const zugang = await aktuellerZugang();
  const fuerMichSichtbar = zeigeFuerMich(zugang);
  if (!fuerMichSichtbar) filter.fuer = "";
  const fuerMich = fuerMichAktiv(filter.fuer);
  const nutzerId = zugang.art === "erlaubt" ? zugang.id : null;
  const leereMenge = Promise.resolve(new Set<string>());

  const leereMap = new Map<string, VergabeDaten[]>();
  const [bioRoh, outRoh, regionen, umrisse, ui, vergabenBio, vergabenOut, beteiligtBio, beteiligtOut] =
    await Promise.all([
      sicht !== "outputs" ? ladeStroeme("biomasse") : Promise.resolve([] as Strom[]),
      sicht !== "feedstock" ? ladeStroeme("output") : Promise.resolve([] as Strom[]),
      ladeRegionOptionen(),
      listRegionGebiete(),
      cookies().then((c) => parseUiState(c.get(UI_COOKIE)?.value)),
      sicht !== "outputs" ? ladeAlleVergaben("biomasse") : Promise.resolve(leereMap),
      sicht !== "feedstock" ? ladeAlleVergaben("output") : Promise.resolve(leereMap),
      // E56: Beteiligung als EINE Menge je Art — nur wenn der Schalter steht.
      fuerMich && nutzerId && sicht !== "outputs" ? withDb((db) => ladeBeteiligungen(db, nutzerId, "biomasse")) : leereMenge,
      fuerMich && nutzerId && sicht !== "feedstock" ? withDb((db) => ladeBeteiligungen(db, nutzerId, "output")) : leereMenge,
    ]);

  // Verfuegbarkeitsstatus EINMAL je Request anreichern (PR 3) — Tooltip,
  // Sidebar und die neue Facette lesen dasselbe Feld.
  const stichtag = new Date().toISOString().slice(0, 10);
  const bioBasis = reichereVerifikationAn(
    reichereVerfuegbarkeitAn(bioRoh, vergabenBio, stichtag),
    vergabenBio,
    stichtag,
  );
  const outBasis = reichereVerifikationAn(
    reichereVerfuegbarkeitAn(outRoh, vergabenOut, stichtag),
    vergabenOut,
    stichtag,
  );
  // E56: das Flag einmal je Request am Pool, kein Nachladen je Zeile.
  const bio = fuerMich && nutzerId ? reichereFuerMichAn(bioBasis, nutzerId, beteiligtBio) : bioBasis;
  const out = fuerMich && nutzerId ? reichereFuerMichAn(outBasis, nutzerId, beteiligtOut) : outBasis;

  // Exklusiv filtern (Beschluss 22.09.2026): cluster blendet Outputs aus,
  // gruppe blendet Feedstock aus — sonst bleibt die fremde Art ungefiltert
  // stehen (CO2-Orb trotz Cluster-Filter).
  const leerErg = { stroeme: [] as Strom[], nichtBeruecksichtigt: [] };
  const bioErg = filter.gruppe.length ? leerErg : filterStroemeMitBericht(bio, filter, "karte");
  const outErg = filter.cluster.length ? leerErg : filterStroemeMitBericht(out, filter, "karte");
  const pool = [...bioErg.stroeme, ...outErg.stroeme];
  const hinweise = fasseBerichteZusammen(
    bioErg.nichtBeruecksichtigt,
    outErg.nichtBeruecksichtigt,
  ).map(nichtBeruecksichtigtText);
  // E56: benannter Leerzustand auf der Karte (es gibt keine Liste, also als Hinweiszeile).
  if (fuerMich && pool.length === 0) hinweise.unshift(FUER_MICH_LEER);
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

  // E32: Die Leiste kommt aus dem Filtermodell — vorher stand hier eine
  // handgeschriebene Liste, die sich von der in auswertung. und der in
  // stroeme. unabhaengig entwickeln konnte.
  const optionen: Record<string, { wert: string; label: string }[]> = {
    region: basisOpt.region ?? [],
    cluster: bioOpt.cluster ?? [],
    materialart: bioOpt.materialart ?? [],
    gruppe: gruppeOptionen,
    produkt: outOpt.produkt ?? [],
    qualitaet: basisOpt.qualitaet ?? [],
    status: basisOpt.status ?? [],
    verfuegbarkeit: basisOpt.verfuegbarkeit ?? [],
    belegtyp: basisOpt.belegtyp ?? [],
    landkreis: basisOpt.landkreis ?? [],
  };
  const lst = leiste("karte", sicht, filter as unknown as Record<string, unknown>, optionen);
  // F5 PR B: Die Baeume kommen aus dem UNGEFILTERTEN Pool — der Baum zeigt
  // den Bestand, nicht die aktuelle Auswahl; sonst verschwaenden beim
  // Filtern die Aeste, ueber die man zurueckwaehlen wollte.
  const baeume = baeumeAus([...bio, ...out]);
  const hierarchien = hierarchienFuer(baeume, filter as unknown as Record<string, unknown>);

  const facetten: FacettenChipDef[] = [...lst.haupt, ...lst.weitere]
    .filter((e) => e.def.typ === "facette" || e.def.typ === "hierarchie")
    .map((e) => ({
      key: e.def.params[0]!,
      label: filterLabel(e.def, "karte"),
      hinweis: filterHinweis(e.def, "karte"),
      optionen: e.optionen,
      hierarchie: hierarchien[e.def.key],
    }));
  const { auswahl, bereich, irgendeinFilter } = lst;
  const bereichKeys = lst.bereichParams;

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
      ? reichereVerifikationAn(
          reichereVerfuegbarkeitAn(
            [nachgeladen],
            nachgeladen.art === "biomasse" ? vergabenBio : vergabenOut,
            stichtag,
          ),
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
      bereichKeys={bereichKeys}
      ruecksetzParams={lst.ruecksetzParams}
      zurueckgehalten={lst.zurueckgehalten.map((f) => f.label)}
      hinweise={hinweise}
      sicht={sicht}
      fuerMich={fuerMich}
      zeigeFuerMich={fuerMichSichtbar}
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
      preisKorridor={
        detailStrom
          ? preisKorridorEinzel(detailStrom, detailStrom.art === "biomasse" ? bio : out, { cluster: CLUSTER_LABEL })
          : null
      }
      filterOffenInitial={!!ui.filterOffen?.karte}
      legendeInitial={ui.legende ?? { offen: true }}
      umrisseInitial={ui.legende?.umrisse ?? true}
      irgendeinFilter={irgendeinFilter}
    />
  );
}
