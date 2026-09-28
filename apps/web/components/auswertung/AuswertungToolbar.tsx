"use client";

import { useState } from "react";

import {
  FacettenChips,
  type FacettenChipDef,
} from "@/components/stroeme/FacettenChips";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { LeistenHinweise } from "@/components/stroeme/LeistenHinweise";
import type { Sicht } from "@/lib/auswertung-modell";
import { SORTIERUNGEN, SORTIERUNG_STANDARD, type Sortierung } from "@/lib/auswertung-sortierung";
import { ExportMenue } from "@/components/ExportMenue";
import { SortMenue } from "@/components/SortMenue";
import { FILTER_PARAMS, ruecksetzPatchAus } from "@/lib/filter-modell";
import { updateUiCookie } from "@/lib/ui-state";

/**
 * Kopfzeile von auswertung. (E39, 28.09.2026) — dieselbe Bedienlogik wie
 * ströme.: Zeile 1 links der Schalter Feedstock/Outputs, rechts Filter-Pille
 * (mit Zähler), Sortier-Pille und Export-Icon; ihre Höhe ändert sich NIE.
 * Die Filter stehen ausschließlich in der Zeile darunter (zu: Zähltext,
 * offen: Chips, „Weitere Filter" als „+"). Vorher saßen die Chips in der
 * Kopfzeile selbst, die dadurch von 52 auf 88 px wuchs und alles darunter
 * verschob. Auf-/Zuklappen lebt im Cookie bhyo_ui, die Filter im Querystring.
 */
export function AuswertungToolbar({
  facetten,
  auswahl,
  bereich,
  bereichKeys,
  ruecksetzParams,
  offenInitial,
  zurueckgehalten,
  hinweise,
  sicht,
  irgendeinFilter,
  countText,
  sortierung,
}: {
  facetten: FacettenChipDef[];
  auswahl: Record<string, string[]>;
  bereich: Record<string, string>;
  bereichKeys: readonly string[];
  /** Alle Parameter, die „Zurücksetzen" leert (lib/filter-modell.ts, leiste().ruecksetzParams). */
  ruecksetzParams: readonly string[];
  /** Gemerkter Auf-/Zuklappzustand der Filterleiste (Cookie bhyo_ui). */
  offenInitial: boolean;
  zurueckgehalten: string[];
  /** F5 PR B: nicht beruecksichtigte Stroeme, fertige Saetze (LeistenHinweise). */
  hinweise: string[];
  sicht: Sicht;
  irgendeinFilter: boolean;
  /** Zähltext der Filterzeile im zugeklappten Zustand („73 Belege"). */
  countText: string;
  /** E39: Sortierung der Akkordeon-Einträge (URL `awsort`). */
  sortierung: Sortierung;
}) {
  const { setze, searchParams } = useUrlZustand();
  const [schliessSignal, setSchliessSignal] = useState(0);
  // Eigenes Signal nur fuer das Sortiermenue: oeffnet sich ein Filter-Popover,
  // geht das Menue zu — und umgekehrt. Ein gemeinsames Signal wuerde das
  // Menue beim eigenen Oeffnen sofort wieder schliessen.
  const [sortSchliessen, setSortSchliessen] = useState(0);
  const [offen, setOffen] = useState(offenInitial);

  function toggleLeiste() {
    const neu = !offen;
    setOffen(neu);
    setSchliessSignal((s) => s + 1);
    const aktuell = updateUiCookie({});
    updateUiCookie({ filterOffen: { ...aktuell.filterOffen, auswertung: neu } });
  }

  function zuruecksetzen() {
    setze(ruecksetzPatchAus(ruecksetzParams));
    setSchliessSignal((s) => s + 1);
  }

  const bereichAnzahl = bereichKeys.filter((k) => (bereich[k] ?? "") !== "").length;
  const facettenAnzahl = facetten.reduce((n, f) => n + (auswahl[f.key]?.length ?? 0), 0);
  const filterAnzahl = facettenAnzahl + bereichAnzahl;

  const exportParams = new URLSearchParams();
  for (const k of FILTER_PARAMS) {
    const v = searchParams.get(k);
    if (v) exportParams.set(k, v);
  }
  // sicht immer explizit mitgeben: ohne den Parameter exportiert die Route
  // beide Arten, das Dashboard zeigt aber immer genau eine.
  exportParams.set("sicht", sicht);
  exportParams.set("ansicht", "auswertung");
  // E41: der Export rechnet den Verfuegbarkeitsstatus gegen dasselbe Fenster.
  for (const k of ["zeitmodus", "jahre"]) {
    const v = searchParams.get(k);
    if (v) exportParams.set(k, v);
  }

  return (
    <>
      <div className="st-toolbar aw-kopfzeile">
        <div className="seg" role="group" aria-label="Feedstock oder Outputs">
          {(
            [
              ["feedstock", "Feedstock"],
              ["outputs", "Outputs"],
            ] as const
          ).map(([wert, label]) => (
            <button
              key={wert}
              type="button"
              className="seg-opt"
              aria-pressed={sicht === wert}
              onClick={() => setze({ sicht: wert })}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="st-toolbar-rechts">
          <button
            type="button"
            className={`fchip${offen || filterAnzahl ? " aktiv" : ""}`}
            aria-expanded={offen}
            aria-controls="aw-filter"
            onClick={toggleLeiste}
          >
            Filter
            {filterAnzahl > 0 && <span className="fchip-count">{filterAnzahl}</span>}
          </button>
          <SortMenue
            optionen={SORTIERUNGEN.map(([key, label]) => ({ key, label }))}
            aktiv={sortierung}
            onWahl={(key) => setze({ awsort: key === SORTIERUNG_STANDARD ? null : key })}
            schliessSignal={sortSchliessen}
            onOffen={() => setSchliessSignal((s) => s + 1)}
          />
          {/* E36: ein Export-Knopf mit Menü (Modus extern/intern, Ausgaben). */}
          <ExportMenue exportParams={exportParams} />
        </div>
      </div>
      {/* aw-kopfzeile-ende */}

      <div className="st-filterzeile aw-filterzeile">
        {!offen && <span className="st-count">{countText}</span>}
        {offen && (
          <div id="aw-filter" className="st-chips">
            <FacettenChips
              facetten={facetten}
              auswahl={auswahl}
              bereichKeys={bereichKeys}
              bereich={bereich}
              bereichKompakt
              mitReset={irgendeinFilter}
              onReset={zuruecksetzen}
              schliessSignal={schliessSignal}
              onPopoverOffen={() => setSortSchliessen((s) => s + 1)}
            />
          </div>
        )}
        <LeistenHinweise zurueckgehalten={zurueckgehalten} hinweise={hinweise} />
      </div>
    </>
  );
}
