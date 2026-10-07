import Link from "next/link";
import { cookies } from "next/headers";

import { Detail } from "@/components/stroeme/Detail";
import { FilterSortZeile } from "@/components/stroeme/FilterSortZeile";
import { FormularPanel } from "@/components/stroeme/FormularPanel";
import { Grid } from "@/components/stroeme/Grid";
import { Tabelle } from "@/components/stroeme/Tabelle";
import { Toolbar } from "@/components/stroeme/Toolbar";
import { EmptyState } from "@/components/shell/EmptyState";
import { heuteBerlin } from "@/lib/datum";
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
  filterStroemeMitBericht,
  nichtBeruecksichtigtText,
  SORTIERUNGEN,
  sortiereStroeme,
} from "@/lib/stroeme-modell";
import { parseUiState, UI_COOKIE } from "@/lib/ui-state";
import { reichereVerfuegbarkeitAn } from "@/lib/verfuegbarkeit";
import { detailDatenAus } from "@/lib/detail-daten";
import { darfRolle } from "@/lib/rechte";
import { aktuellerZugang } from "@/lib/rechte/wache";
import { withDb } from "@/lib/db";
import { FUER_MICH_LEER, fuerMichAktiv, reichereFuerMichAn, zeigeFuerMich } from "@/lib/fuer-mich";
import { ladeBeteiligungen } from "@/lib/fuer-mich-server";
import { artAusSicht, filterHinweis, filterLabel, leiste, leseSicht } from "@/lib/filter-modell";
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

  // F8/E30: Der Zugang entscheidet ueber Schreibrecht (Ausblenden) und den
  // Schalter „Für mich" (E56) — die tragende Pruefung sitzt in der Wache.
  const zugang = await aktuellerZugang();
  // E56: Betrachter koennen nicht beteiligt sein — kein Schalter, und der
  // Parameter wirkt nicht (ein Filter ohne Wirkung wird nicht angezeigt).
  const fuerMichSichtbar = zeigeFuerMich(zugang);
  if (!fuerMichSichtbar) filter.fuer = "";
  const fuerMich = fuerMichAktiv(filter.fuer);

  const [poolRoh, vergabenMap, regionen, ui, beteiligt] = await Promise.all([
    ladeStroeme(art),
    ladeAlleVergaben(art),
    ladeRegionOptionen(),
    cookies().then((c) => parseUiState(c.get(UI_COOKIE)?.value)),
    // E56: Beteiligung als EINE Menge aus dem Protokoll — nur wenn der Schalter steht.
    fuerMich && zugang.art === "erlaubt" ? withDb((db) => ladeBeteiligungen(db, zugang.id, art)) : Promise.resolve(new Set<string>()),
  ]);

  // AP1j PR 3: Verfuegbarkeitsstatus EINMAL je Request an den Pool anreichern
  // (stichtag = Serverdatum) — Grid, Tabelle, Detail und die neue Facette
  // lesen alle dasselbe Feld.
  const stichtag = heuteBerlin();
  // E62: der Verifikationszustand kommt aus dem Loader (strom_verifikation).
  const poolBasis = reichereVerfuegbarkeitAn(poolRoh, vergabenMap, stichtag);
  // E56: das Flag einmal je Request am Pool, kein Nachladen je Zeile.
  const pool = fuerMich && zugang.art === "erlaubt" ? reichereFuerMichAn(poolBasis, zugang.id, beteiligt) : poolBasis;

  const { stroeme: gefiltert, nichtBeruecksichtigt } = filterStroemeMitBericht(
    pool,
    filter,
    "stroeme",
  );
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
  const hierarchien = hierarchienFuer(baeume, filter as unknown as Record<string, unknown>);

  const facetten = [...lst.haupt, ...lst.weitere]
    .filter((e) => e.def.typ === "facette" || e.def.typ === "hierarchie")
    .map((e) => ({
      key: e.def.params[0]!,
      label: filterLabel(e.def, "stroeme"),
      hinweis: filterHinweis(e.def, "stroeme"),
      optionen: e.optionen,
      hierarchie: hierarchien[e.def.key],
    }));
  const { auswahl, bereich, irgendeinFilter } = lst;

  const countText = `${stroeme.length} ${stroeme.length === 1 ? "Strom" : "Ströme"}${irgendeinFilter ? " gefiltert" : ""}`;

  // F8/E30: Schreibrecht kommt aus der Rolle, nicht mehr hart aus `true`.
  // Das blendet nur aus — die tragende Pruefung sitzt in der Wache, die jede
  // Server-Action und jede schreibende Route aufruft.
  // E42: dieselbe Matrix wie die Wache — hier nur zum Ausblenden. Rollenstufe
  // (Anlegen-Knopf, Bearbeiten-Knoepfe); die Objektstufe (Sperre) kommt unten
  // je Detail dazu — darf() ohne Objekt waere fuer strom.bearbeiten bewusst false.
  const canEdit = darfRolle(zugang, "strom.bearbeiten");

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
    detailStrom = nachgeladen ? reichereVerfuegbarkeitAn([nachgeladen], vergabenMap, stichtag)[0]! : null;
  }
  // Detail-Daten an einer Stelle (lib/detail-daten.ts) — dieselbe
  // Zusammenstellung wie in inbox. („Öffnen" zeigt dasselbe Panel, AP2.2).
  const detail = detailStrom
    ? await detailDatenAus(
        detailStrom,
        pool,
        vergabenMap.get(detailStrom.id) ?? [],
        zugang,
        ...(await Promise.all([ladeHistorie(art, detailStrom.id), ladeErsteAenderung(art, detailStrom.id)])),
      )
    : null;

  const resetHref = `/register${sicht === "outputs" ? "?sicht=outputs" : ""}`;

  return (
    <div className="st-seite">
      <Toolbar sicht={sicht} q={filter.q} canEdit={canEdit} fuerMich={fuerMich} zeigeFuerMich={fuerMichSichtbar} />
      <FilterSortZeile
        art={art}
        countText={countText}
        facetten={facetten}
        auswahl={auswahl}
        bereich={bereich}
        ruecksetzParams={lst.ruecksetzParams}
        bereichKeys={lst.bereichParams}
        zurueckgehalten={lst.zurueckgehalten.map((f) => f.label)}
        hinweise={nichtBeruecksichtigt.map(nichtBeruecksichtigtText)}
        sortKey={sortKey}
        richtung={richtung}
        sortOptionen={sortOptionen}
        ansicht={ansicht}
        offenInitial={!!ui.filterOffen?.stroeme}
        irgendeinFilter={irgendeinFilter}
      />

      <div className="st-inhalt">
        {stroeme.length === 0 ? (
          fuerMich ? (
            <EmptyState icon="user" titel={FUER_MICH_LEER} beschreibung="Ströme, die du gesperrt hast, die dir zugewiesen sind oder an denen du beteiligt bist, erscheinen hier.">
              <Link className="btn btn--sm" href={resetHref}>
                Alle anzeigen
              </Link>
            </EmptyState>
          ) : irgendeinFilter ? (
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
        detail && (
          <Detail
            strom={detail.strom}
            historie={detail.historie}
            begruendung={detail.begruendung}
            modal={ansicht === "grid"}
            canEdit={canEdit}
            sperrRechte={detail.sperrRechte}
            zuweisbare={detail.zuweisbare}
            anfrage={detail.anfrage}
            verfuegbarkeit={detail.verfuegbarkeit}
            vergaben={detail.vergaben}
            preisKorridor={detail.preisKorridor}
            kommentare={detail.kommentare}
            kommentarZugang={detail.kommentarZugang}
            darfKommentieren={detail.darfKommentieren}
            erwaehnbare={detail.erwaehnbare}
          />
        )
      )}
    </div>
  );
}
