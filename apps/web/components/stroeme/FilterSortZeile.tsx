"use client";

import { useEffect, useRef, useState } from "react";

import {
  FacettenChips,
  type FacettenChipDef,
} from "@/components/stroeme/FacettenChips";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { LeistenHinweise } from "@/components/stroeme/LeistenHinweise";
import { ExportMenue } from "@/components/ExportMenue";
import { FILTER_PARAMS } from "@/lib/filter-modell";
import { updateUiCookie } from "@/lib/ui-state";

export type FacettenChip = FacettenChipDef;

/**
 * Zeile 2 von stroeme. (V2): links Zaehltext bzw. ausgeklappte Facetten-Chips,
 * rechts Filter-Toggle, Sortier-Menue und Grid/Liste. Die Chip-Popover leben
 * seit PR 6 geteilt in FacettenChips (auch karte. nutzt sie). Auf-/Zuklappen
 * der Filterleiste lebt im Cookie bhyo_ui, die Filter selbst im Querystring.
 * Bei Platzmangel weicht erst „Weitere Filter" auf ein Plus-Icon, dann der
 * Sortier-Button auf Icon-only aus (wie im Mockup).
 */
export function FilterSortZeile({
  art,
  countText,
  facetten,
  auswahl,
  bereich,
  sortKey,
  richtung,
  sortOptionen,
  bereichKeys,
  zurueckgehalten,
  hinweise,
  ansicht,
  offenInitial,
  irgendeinFilter,
}: {
  art: "biomasse" | "output";
  countText: string;
  facetten: FacettenChip[];
  auswahl: Record<string, string[]>;
  bereich: Record<string, string>;
  /** Bereichs-, Monats- und Datumsparameter dieser Ansicht (aus dem Modell). */
  bereichKeys: readonly string[];
  /** E32: gesetzte Filter, die hier nicht gelten — Beschriftungen. */
  zurueckgehalten: string[];
  /** F5 PR B: nicht beruecksichtigte Stroeme, fertige Saetze (LeistenHinweise). */
  hinweise: string[];
  sortKey: string;
  richtung: "auf" | "ab";
  sortOptionen: [string, string][];
  ansicht: "grid" | "liste";
  offenInitial: boolean;
  irgendeinFilter: boolean;
}) {
  const { setze, searchParams } = useUrlZustand();
  const [offen, setOffen] = useState(offenInitial);
  const [sortOffen, setSortOffen] = useState(false);
  const [schliessSignal, setSchliessSignal] = useState(0);
  const [zeilenBreite, setZeilenBreite] = useState(0);
  const zeileRef = useRef<HTMLDivElement>(null);

  // Sortmenue schliessen bei Klick ausserhalb / Escape.
  useEffect(() => {
    function onDown(ev: MouseEvent) {
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.("[data-pop]")) return;
      setSortOffen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setSortOffen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Breite der Zeile beobachten (responsive Verdichtung).
  useEffect(() => {
    const node = zeileRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]!.contentRect.width);
      setZeilenBreite((alt) => (Math.abs(w - alt) > 2 ? w : alt));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const bereichAnzahl = bereichKeys.filter((k) => (bereich[k] ?? "") !== "").length;
  const facettenAnzahl = facetten.reduce(
    (n, f) => n + (auswahl[f.key]?.length ?? 0),
    0,
  );
  const filterAnzahl = facettenAnzahl + bereichAnzahl;
  const sortLabel =
    sortOptionen.find(([k]) => k === sortKey)?.[1] ??
    sortOptionen[sortOptionen.length - 1]![1];

  // Platzabschaetzung wie im Mockup: erst „Weitere Filter" -> „+", dann Sort-Icon.
  const chipBreite = (label: string, count: number) =>
    Math.round(label.length * 7.4) + 30 + (count ? 24 : 0);
  const chipsBreite = (kompaktBereich: boolean) =>
    facetten.reduce((n, f) => n + chipBreite(f.label, auswahl[f.key]?.length ?? 0), 0) +
    chipBreite(kompaktBereich ? "" : "Weitere Filter", bereichAnzahl) +
    (irgendeinFilter ? 44 : 0) +
    facetten.length * 8;
  const rechtsBreite = (kompaktSort: boolean) =>
    chipBreite("Filter", filterAnzahl) +
    (kompaktSort ? 36 : chipBreite(sortLabel, 0) + 44) +
    168 + 16 + 12;
  const breite = zeilenBreite || 1120;
  const bereichKompakt = offen && chipsBreite(false) + rechtsBreite(false) > breite;
  const sortKompakt = offen && chipsBreite(true) + rechtsBreite(false) > breite;

  function toggleLeiste() {
    const neu = !offen;
    setOffen(neu);
    setSchliessSignal((s) => s + 1);
    const aktuell = updateUiCookie({});
    updateUiCookie({ filterOffen: { ...aktuell.filterOffen, stroeme: neu } });
  }

  function zuruecksetzen() {
    const leer: Record<string, null> = { q: null };
    for (const f of facetten) leer[f.key] = null;
    for (const k of bereichKeys) leer[k] = null;
    setze(leer);
    setSchliessSignal((s) => s + 1);
  }

  function sortiere(key: string) {
    const neueRichtung =
      key === sortKey ? (richtung === "auf" ? "ab" : "auf") : "auf";
    setze({ sort: key, richtung: neueRichtung });
    setSortOffen(false);
  }

  // F5 PR B: Die stoffliche Menge ist immer eine Masse — Feedstock als
  // Frischmasse, Outputs in t/a.
  const einheit = art === "biomasse" ? "t FM/a" : "t/a";

  // Derselbe Export wie in auswertung. (eine Route, ein Ursprung): die
  // geteilten Filter-Parameter plus die Art dieses Tabs als sicht.
  const exportParams = new URLSearchParams();
  for (const k of FILTER_PARAMS) {
    const v = searchParams.get(k);
    if (v) exportParams.set(k, v);
  }
  exportParams.set("sicht", art === "biomasse" ? "feedstock" : "outputs");
  // Scope der Ansicht mitgeben: In stroeme. gelten Freitext, Verfuegbarkeit
  // und "Verfuegbar ab" — der Export muss sie genauso anwenden.
  exportParams.set("ansicht", "stroeme");

  return (
    <div className="st-filterzeile" ref={zeileRef}>
      {!offen && <span className="st-count">{countText}</span>}

      {offen && (
        <div id="strom-filter" className="st-chips">
          <FacettenChips
            facetten={facetten}
            auswahl={auswahl}
            bereichKeys={bereichKeys}
            bereich={bereich}
            bereichKompakt={bereichKompakt}
            einheit={einheit}
            preisLabel={art === "biomasse" ? "Preiskorridor (Mittel)" : "Preis stofflich"}
            mitReset={irgendeinFilter}
            onReset={zuruecksetzen}
            schliessSignal={schliessSignal}
            onPopoverOffen={() => setSortOffen(false)}
          />
        </div>
      )}

      <LeistenHinweise zurueckgehalten={zurueckgehalten} hinweise={hinweise} />

      <div className="st-filterzeile-rechts">
        <button
          type="button"
          className={`fchip${offen || filterAnzahl ? " aktiv" : ""}`}
          aria-expanded={offen}
          aria-controls="strom-filter"
          onClick={toggleLeiste}
        >
          Filter
          {filterAnzahl > 0 && <span className="fchip-count">{filterAnzahl}</span>}
        </button>

        <div data-pop className="pop-anchor">
          <button
            type="button"
            className="btn btn--sm st-sort"
            aria-haspopup="menu"
            aria-expanded={sortOffen}
            aria-label={sortKompakt ? `Sortieren: ${sortLabel}` : undefined}
            onClick={() => {
              setSortOffen((v) => !v);
              setSchliessSignal((s) => s + 1);
            }}
          >
            <i className="ph ph-arrows-down-up" aria-hidden />
            {!sortKompakt && (
              <>
                {sortLabel}
                <i className="ph-bold ph-caret-down" aria-hidden />
              </>
            )}
          </button>
          {sortOffen && (
            <div role="menu" aria-label="Sortieren" className="pop" style={{ width: 240 }}>
              <div className="menu">
                {sortOptionen.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="menuitemradio"
                    aria-checked={k === sortKey}
                    className="menu-item"
                    onClick={() => sortiere(k)}
                  >
                    <span className="lbl">{label}</span>
                    {k === sortKey && (
                      <>
                        <span className="kurz">
                          {richtung === "auf" ? "aufsteigend" : "absteigend"}
                        </span>
                        <i className="ph-bold ph-check" aria-hidden />
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="seg" role="group" aria-label="Ansicht">
          <button
            type="button"
            className="seg-opt"
            aria-pressed={ansicht === "grid"}
            onClick={() => setze({ ansicht: null })}
          >
            <i className="ph ph-squares-four" aria-hidden />
            Grid
          </button>
          <button
            type="button"
            className="seg-opt"
            aria-pressed={ansicht === "liste"}
            onClick={() => setze({ ansicht: "liste" })}
          >
            <i className="ph ph-list" aria-hidden />
            Liste
          </button>
        </div>

        {/* F4-Review: Export auch in stroeme. — dieselbe Route und dieselben
            geteilten Filter-Parameter wie in auswertung., mit Art des Tabs
            als sicht und dem Scope der Ansicht. Rechts vom Ansichts-Schalter,
            nur als Icon (Review Eric, 24.09.2026); E36: Menü mit Modus. */}
        <ExportMenue exportParams={exportParams} kompakt />
      </div>
    </div>
  );
}
