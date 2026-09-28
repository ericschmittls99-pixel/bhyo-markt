"use client";

import { useState } from "react";

import {
  FacettenChips,
  type FacettenChipDef,
} from "@/components/stroeme/FacettenChips";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { LeistenHinweise } from "@/components/stroeme/LeistenHinweise";
import type { Sicht } from "@/lib/auswertung-modell";
import { ExportMenue } from "@/components/ExportMenue";
import { FILTER_PARAMS, ruecksetzPatchAus } from "@/lib/filter-modell";
import { updateUiCookie } from "@/lib/ui-state";


/**
 * Toolbar von auswertung. (AP1i PR 7): sicht-Umschalter Feedstock ODER
 * Outputs (kein Alle-Tab — Spec-Aenderung Eric, die Kacheln sind artrein)
 * + Facetten-Chips (immer sichtbar, wie im Mockup — anders als karte./
 * stroeme. gibt es keinen Filter-Toggle) + Reset-X + CSV-Export als
 * Sekundaer-Button (E9). Die Filter leben im geteilten Querystring
 * (FILTER_PARAMS); der CSV-Link reicht genau diese Parameter
 * plus die explizite sicht an die Export-Route weiter.
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
}) {
  const { setze, searchParams } = useUrlZustand();
  const [schliessSignal, setSchliessSignal] = useState(0);
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

  const exportParams = new URLSearchParams();
  for (const k of FILTER_PARAMS) {
    const v = searchParams.get(k);
    if (v) exportParams.set(k, v);
  }
  // sicht immer explizit mitgeben: ohne den Parameter exportiert die Route
  // beide Arten, das Dashboard zeigt aber immer genau eine.
  exportParams.set("sicht", sicht);
  exportParams.set("ansicht", "auswertung");

  return (
    <div className="aw-toolbar">
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

      <div className="aw-toolbar-trenner" aria-hidden />

      {/* E32: Filterleiste auf- und zuklappbar wie in stroeme. und karte. —
          vorher war sie hier als einzige immer offen und der Zustand wurde
          nicht gemerkt. */}
      <button
        type="button"
        className={`fchip${offen || irgendeinFilter ? " aktiv" : ""}`}
        aria-expanded={offen}
        aria-controls="aw-filter"
        onClick={toggleLeiste}
      >
        Filter
      </button>

      <LeistenHinweise zurueckgehalten={zurueckgehalten} hinweise={hinweise} />

      {offen && (
      <FacettenChips
        facetten={facetten}
        auswahl={auswahl}
        bereichKeys={bereichKeys}
        bereich={bereich}
        mitReset={irgendeinFilter}
        onReset={zuruecksetzen}
        schliessSignal={schliessSignal}
      />
      )}

      {/* E36: ein Export-Knopf mit Menü (Modus extern/intern, Ausgaben). */}
      <ExportMenue exportParams={exportParams} className="aw-export" />
    </div>
  );
}
