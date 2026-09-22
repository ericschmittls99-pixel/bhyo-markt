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
  ladeLandkreisOptionen,
  ladeRegionOptionen,
  ladeStroeme,
  ladeVergaben,
} from "@/lib/stroeme";
import {
  FACETTEN,
  facettenOptionen,
  filterAusSearchParams,
  filterStroeme,
  SORTIERUNGEN,
  sortiereStroeme,
} from "@/lib/stroeme-modell";
import { parseUiState, UI_COOKIE } from "@/lib/ui-state";
import { leiteVerfuegbarkeitAb } from "@/lib/verfuegbarkeit";
import { naechsteVerifizierung } from "@/lib/verifizierung";

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
  const art = ersterWert(sp.tab) === "output" ? ("output" as const) : ("biomasse" as const);
  const ansicht = ersterWert(sp.ansicht) === "liste" ? ("liste" as const) : ("grid" as const);

  const filter = filterAusSearchParams(sp);

  const sortOptionen = SORTIERUNGEN[art];
  const sortKey = sortOptionen.some(([k]) => k === ersterWert(sp.sort))
    ? ersterWert(sp.sort)
    : "erstellt";
  const richtung = ersterWert(sp.richtung) === "auf" ? ("auf" as const) : ("ab" as const);

  const [pool, regionen, ui] = await Promise.all([
    ladeStroeme(art),
    ladeRegionOptionen(),
    cookies().then((c) => parseUiState(c.get(UI_COOKIE)?.value)),
  ]);

  const gefiltert = filterStroeme(pool, filter);
  const stroeme = sortiereStroeme(gefiltert, sortKey, richtung);

  const facetten = FACETTEN[art];
  const optionen = facettenOptionen(art, pool, regionen, CLUSTER_LABEL);
  const auswahl = Object.fromEntries(
    facetten.map(({ key }) => [key, filter[key] as string[]]),
  );
  const irgendeinFilter =
    filter.q.trim() !== "" ||
    facetten.some(({ key }) => (filter[key] as string[]).length > 0) ||
    [filter.mengeMin, filter.mengeMax, filter.preisMin, filter.preisMax, filter.vonAb, filter.erstellt].some(
      (v) => v !== "",
    );

  const countText = `${stroeme.length} ${stroeme.length === 1 ? "Strom" : "Ströme"}${irgendeinFilter ? " gefiltert" : ""}`;

  // Rollen kommen mit der benutzer-Tabelle; bis dahin darf jede eingeloggte
  // Person erfassen (wie bisher, Zugang ist ueber Cloudflare Access begrenzt).
  const canEdit = true;

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
  let landkreise: string[] = [];
  if (formOffen && canEdit) {
    [materialarten, produkte, landkreise] = await Promise.all([
      art === "biomasse" ? listMaterialartenMitCluster() : Promise.resolve([]),
      art === "output" ? listOutputProdukte() : Promise.resolve([]),
      ladeLandkreisOptionen(),
    ]);
  }

  // Detail: URL-getrieben; aus dem Grid als Modal, aus der Liste als Panel.
  // Nicht im Pool (jenseits des 500er-Limits)? Dann gezielt per ID nachladen.
  const detailId = ersterWert(sp.detail);
  let detailStrom = detailId ? (pool.find((s) => s.id === detailId) ?? null) : null;
  if (detailId && !detailStrom)
    detailStrom = (await ladeStroeme(art, detailId))[0] ?? null;
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

  // AP1j: Vergaben nur fuer das offene Detail laden; EIN heute je Request,
  // damit Pille und Sektion konsistent aus demselben Stichtag entstehen.
  const vergaben = detailStrom ? await ladeVergaben(art, detailStrom.id) : [];
  const heute = new Date().toISOString().slice(0, 10);
  const verfuegbarkeit =
    detailStrom?.zeitraumVon && detailStrom.zeitraumBis
      ? leiteVerfuegbarkeitAb(
          heute,
          {
            zeitraumVon: detailStrom.zeitraumVon,
            zeitraumBis: detailStrom.zeitraumBis,
            reserviertBhyo: detailStrom.reserviertBhyo,
          },
          vergaben,
        )
      : null;

  const resetHref = `/register${art === "output" ? "?tab=output" : ""}`;

  return (
    <div className="st-seite">
      <Toolbar tab={art} q={filter.q} canEdit={canEdit} />
      <FilterSortZeile
        art={art}
        countText={countText}
        facetten={facetten.map(({ key, label }) => ({
          key,
          label,
          optionen: optionen[key] ?? [],
        }))}
        auswahl={auswahl}
        bereich={{
          mengeMin: filter.mengeMin,
          mengeMax: filter.mengeMax,
          preisMin: filter.preisMin,
          preisMax: filter.preisMax,
          vonAb: filter.vonAb,
          erstellt: filter.erstellt,
        }}
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
                  href={`/register?tab=${art}&form=neu`}
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
          landkreise={landkreise}
          zurueckHref={zurueckHref}
          modal={ansicht === "grid"}
        />
      ) : (
        detailStrom && (
          <Detail
            strom={detailStrom}
            historie={historie}
            begruendung={begruendung}
            verifizierung={
              detailStrom.beleg ? naechsteVerifizierung(detailStrom.beleg) : null
            }
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
