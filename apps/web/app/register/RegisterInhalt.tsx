import Link from "next/link";
import { cookies } from "next/headers";

import { Detail } from "@/components/stroeme/Detail";
import { FilterSortZeile } from "@/components/stroeme/FilterSortZeile";
import { FormularPanel } from "@/components/stroeme/FormularPanel";
import { Grid } from "@/components/stroeme/Grid";
import { Tabelle } from "@/components/stroeme/Tabelle";
import { Toolbar } from "@/components/stroeme/Toolbar";
import { EmptyState } from "@/components/shell/EmptyState";
import { CLUSTER_LABEL } from "@/lib/farben";
import type { FormularWerte } from "@/lib/formular-modell";
import {
  listMaterialartenMitCluster,
  listOutputProdukte,
  type MaterialartMitCluster,
  type OutputProduktOption,
} from "@/lib/register";
import {
  ladeErsteAenderung,
  ladeFormularWerte,
  ladeHistorie,
  ladeAlleVergaben,
  ladeRegionOptionen,
  ladeStroeme,
} from "@/lib/stroeme";
import {
  facettenOptionen,
  filterAusSearchParams,
  filterStroeme,
  SORTIERUNGEN,
  sortiereStroeme,
} from "@/lib/stroeme-modell";
import { parseUiState, UI_COOKIE } from "@/lib/ui-state";
import { reichereVerfuegbarkeitAn } from "@/lib/verfuegbarkeit";
import { verifikationsFaelligkeit } from "@/lib/verifizierung";
import { darf } from "@/lib/rollen";
import { aktuellerZugang } from "@/lib/wache";
import { artAusSicht, leiste, leseSicht } from "@/lib/filter-modell";
import { baeumeAus, hierarchienFuer } from "@/lib/leiste-hierarchien";

export type SearchParams = Record<string, string | string[] | undefined>;

function ersterWert(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return s ?? "";
}

/**
 * stroeme. (V2, AP1i PR 3 + 5): Toolbar, ausklappbare Facetten-Filter,
 * Sortierung, Grid (Default) / Liste, Detail als Modal/Panel und das
 * Formular-Panel (?form=neu | ?form=<id>). Von /register und vom Deeplink
 * /register/[art]/neu gerendert; letzterer erzwingt das offene Formular und
 * gibt `zurueckHref` fuers Schliessen mit.
 */
export async function RegisterInhalt({
  sp,
  zurueckHref,
}: {
  sp: SearchParams;
  zurueckHref?: string;
}) {
  // E32: `tab=biomasse|output` ist abgeloest — die Stromart heisst ueberall
  // `sicht=feedstock|outputs`. stroeme. zeigt immer genau eine Art, "alle"
  // gibt es hier nicht.
  const { sicht: sichtRoh } = leseSicht(ersterWert(sp.sicht) || undefined, "feedstock", [
    "feedstock",
    "outputs",
  ]);
  // stroeme. zeigt immer genau eine Art; "alle" ist hier ausgeschlossen.
  const sicht = sichtRoh as "feedstock" | "outputs";
  const art = artAusSicht(sicht) ?? "biomasse";
  const ansicht = ersterWert(sp.ansicht) === "liste" ? ("liste" as const) : ("grid" as const);

  const filter = filterAusSearchParams(sp);

  const sortOptionen = SORTIERUNGEN[art];
  const sortKey = sortOptionen.some(([k]) => k === ersterWert(sp.sort))
    ? ersterWert(sp.sort)
    : "erstellt";
  const richtung = ersterWert(sp.richtung) === "auf" ? ("auf" as const) : ("ab" as const);

  const [poolRoh, vergabenMap, regionen, ui] = await Promise.all([
    ladeStroeme(art),
    ladeAlleVergaben(art),
    ladeRegionOptionen(),
    cookies().then((c) => parseUiState(c.get(UI_COOKIE)?.value)),
  ]);

  // AP1j PR 3: Verfuegbarkeitsstatus EINMAL je Request an den Pool anreichern
  // (stichtag = Serverdatum) — Grid, Tabelle, Detail und die neue Facette
  // lesen alle dasselbe Feld.
  const stichtag = new Date().toISOString().slice(0, 10);
  const pool = reichereVerfuegbarkeitAn(poolRoh, vergabenMap, stichtag);

  const gefiltert = filterStroeme(pool, filter);
  const stroeme = sortiereStroeme(gefiltert, sortKey, richtung);

  // E32: Facetten, Bereiche, Auswahl, Ruecksetz-Schluessel und die
  // zurueckgehaltenen Filter kommen aus dem Filtermodell — hier steht keine
  // eigene Liste mehr.
  const optionen = facettenOptionen(art, pool, regionen, CLUSTER_LABEL);
  const lst = leiste("stroeme", sicht, filter as unknown as Record<string, unknown>, optionen);
  // F5 PR B: Die Baeume kommen aus dem UNGEFILTERTEN Pool — der Baum zeigt
  // den Bestand, nicht die aktuelle Auswahl; sonst verschwaenden beim
  // Filtern die Aeste, ueber die man zurueckwaehlen wollte.
  const baeume = baeumeAus(pool);
  const hierarchien = hierarchienFuer(
    ["materialart", "produkt", "ort"],
    baeume,
    filter as unknown as Record<string, unknown>,
  );

  const facetten = [...lst.haupt, ...lst.weitere]
    .filter((e) => e.def.typ === "facette" || e.def.typ === "hierarchie")
    .map((e) => ({
      key: e.def.params[0]!,
      label: e.def.label,
      optionen: e.optionen,
      hierarchie: hierarchien[e.def.key],
    }));
  const { auswahl, bereich, irgendeinFilter } = lst;

  const countText = `${stroeme.length} ${stroeme.length === 1 ? "Strom" : "Ströme"}${irgendeinFilter ? " gefiltert" : ""}`;

  // F8/E30: Schreibrecht kommt aus der Rolle, nicht mehr hart aus `true`.
  // Das blendet nur aus — die tragende Pruefung sitzt in der Wache, die jede
  // Server-Action und jede schreibende Route aufruft.
  const zugang = await aktuellerZugang();
  const canEdit = zugang.art === "erlaubt" && darf(zugang.rolle, "schreiben");

  // Formular-Panel (PR 5): ?form=neu oder ?form=<id>; gewinnt gegen ?detail=.
  const formParam = ersterWert(sp.form);
  let formularWerte: FormularWerte | null = null;
  let formOffen = formParam !== "";
  if (formParam && formParam !== "neu") {
    formularWerte = await ladeFormularWerte(art, formParam);
    if (!formularWerte) {
      console.error(`Formular: Strom ${formParam} (${art}) nicht gefunden.`);
      formOffen = false;
    }
  }
  let materialarten: MaterialartMitCluster[] = [];
  let produkte: OutputProduktOption[] = [];
  if (formOffen && canEdit) {
    [materialarten, produkte] = await Promise.all([
      art === "biomasse" ? listMaterialartenMitCluster() : Promise.resolve([]),
      art === "output" ? listOutputProdukte() : Promise.resolve([]),
    ]);
  }

  // Detail: URL-getrieben; aus dem Grid als Modal, aus der Liste als Panel.
  // Nicht im Pool (jenseits des 500er-Limits)? Dann gezielt per ID nachladen.
  const detailId = ersterWert(sp.detail);
  let detailStrom = detailId ? (pool.find((s) => s.id === detailId) ?? null) : null;
  if (detailId && !detailStrom) {
    const nachgeladen = (await ladeStroeme(art, detailId))[0] ?? null;
    detailStrom = nachgeladen
      ? reichereVerfuegbarkeitAn([nachgeladen], vergabenMap, stichtag)[0]!
      : null;
  }
  const [historie, ersteAenderung] = detailStrom
    ? await Promise.all([
        ladeHistorie(art, detailStrom.id),
        ladeErsteAenderung(art, detailStrom.id),
      ])
    : [[], null];
  // Die Begruendung des Anlegens ist der aelteste Log-Eintrag ("email: text").
  const begruendung =
    ersteAenderung && ersteAenderung.includes(": ")
      ? ersteAenderung.slice(ersteAenderung.indexOf(": ") + 2)
      : null;

  // Detail liest denselben angereicherten Status wie Grid/Tabelle/Facette.
  const vergaben = detailStrom ? (vergabenMap.get(detailStrom.id) ?? []) : [];
  const verfuegbarkeit = detailStrom?.verfuegbarkeit ?? null;

  const resetHref = `/register${sicht === "outputs" ? "?sicht=outputs" : ""}`;

  return (
    <div className="st-seite">
      <Toolbar sicht={sicht} q={filter.q} canEdit={canEdit} />
      <FilterSortZeile
        art={art}
        countText={countText}
        facetten={facetten}
        auswahl={auswahl}
        bereich={bereich}
        bereichKeys={lst.haupt
          .concat(lst.weitere)
          .filter((e) => !["facette", "hierarchie", "text"].includes(e.def.typ))
          .flatMap((e) => e.def.params)}
        zurueckgehalten={lst.zurueckgehalten.map((f) => f.label)}
        sortKey={sortKey}
        richtung={richtung}
        sortOptionen={sortOptionen}
        ansicht={ansicht}
        offenInitial={!!ui.filterOffen?.stroeme}
        irgendeinFilter={irgendeinFilter}
      />

      <div className="st-inhalt">
        {stroeme.length === 0 ? (
          irgendeinFilter ? (
            <EmptyState
              icon="funnel"
              titel="keine treffer."
              beschreibung="Kein Strom entspricht Suche und Filtern."
            >
              <Link className="btn btn--sm" href={resetHref}>
                Filter zurücksetzen
              </Link>
            </EmptyState>
          ) : (
            <EmptyState
              icon="leaf"
              titel="noch keine ströme."
              beschreibung={
                art === "biomasse"
                  ? "Über „Feedstock anlegen“ entsteht der erste Datensatz."
                  : "Über „Output anlegen“ entsteht der erste Datensatz."
              }
            >
              {canEdit && (
                <Link
                  className="btn btn--primary btn--sm"
                  href={`/register?sicht=${sicht}&form=neu`}
                >
                  <i className="ph-bold ph-plus" aria-hidden />
                  {art === "biomasse" ? "Feedstock anlegen" : "Output anlegen"}
                </Link>
              )}
            </EmptyState>
          )
        ) : ansicht === "grid" ? (
          <Grid stroeme={stroeme} />
        ) : (
          <Tabelle
            art={art}
            stroeme={stroeme}
            sortKey={sortKey}
            richtung={richtung}
            detailId={detailId || undefined}
          />
        )}
      </div>

      {formOffen && canEdit ? (
        <FormularPanel
          art={art}
          werte={formularWerte}
          materialarten={materialarten}
          produkte={produkte}
          zurueckHref={zurueckHref}
          modal={ansicht === "grid"}
        />
      ) : (
        detailStrom && (
          <Detail
            strom={detailStrom}
            historie={historie}
            begruendung={begruendung}
            verifizierung={verifikationsFaelligkeit(
              detailStrom.beleg,
              detailStrom,
              vergaben,
            )}
            modal={ansicht === "grid"}
            canEdit={canEdit}
            verfuegbarkeit={verfuegbarkeit}
            vergaben={vergaben}
          />
        )
      )}
    </div>
  );
}
