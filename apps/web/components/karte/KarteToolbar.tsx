"use client";

import { useEffect, useRef, useState } from "react";

import {
  FacettenChips,
  type FacettenChipDef,
} from "@/components/stroeme/FacettenChips";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { farbeFuer } from "@/lib/farben";
import {
  sucheKarte,
  type KartePunkt,
  type KarteTreffer,
} from "@/lib/karte-modell";
import { updateUiCookie } from "@/lib/ui-state";


const TREFFER_META: Record<KarteTreffer["typ"], string> = {
  strom: "Strom",
  region: "Fokusregion",
  ort: "Ort",
};

/**
 * Glas-Toolbar von karte. (PR 6): Suche mit Treffer-Popover (Stroeme,
 * Fokusregionen, Orte — nur Geladenes, kein Geocoding), sicht-Umschalter
 * Alle/Feedstock/Outputs (Querystring, weil Datenfilter) und die
 * ausklappbare Facetten-Filterleiste (FacettenChips aus PR 3/6).
 */
export function KarteToolbar({
  punkte,
  regionen,
  facetten,
  auswahl,
  bereich,
  bereichKeys,
  zurueckgehalten,
  sicht,
  offenInitial,
  irgendeinFilter,
  onTreffer,
}: {
  punkte: KartePunkt[];
  regionen: { id: string; name: string }[];
  facetten: FacettenChipDef[];
  auswahl: Record<string, string[]>;
  bereich: Record<string, string>;
  /** Bereichs-, Monats- und Datumsparameter dieser Ansicht (aus dem Modell). */
  bereichKeys: readonly string[];
  /** E32: gesetzte Filter, die hier nicht gelten — Beschriftungen. */
  zurueckgehalten: string[];
  sicht: "alle" | "feedstock" | "outputs";
  offenInitial: boolean;
  irgendeinFilter: boolean;
  onTreffer: (t: KarteTreffer) => void;
}) {
  const { setze } = useUrlZustand();
  const [offen, setOffen] = useState(offenInitial);
  const [schliessSignal, setSchliessSignal] = useState(0);
  const [suche, setSuche] = useState("");
  const [sucheOffen, setSucheOffen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setSucheOffen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const treffer = sucheOffen ? sucheKarte(punkte, regionen, suche) : [];

  const facettenAnzahl =
    facetten.reduce((n, f) => n + (auswahl[f.key]?.length ?? 0), 0) +
    bereichKeys.filter((k) => (bereich[k] ?? "") !== "").length;

  function toggleLeiste() {
    const neu = !offen;
    setOffen(neu);
    setSchliessSignal((s) => s + 1);
    const aktuell = updateUiCookie({});
    updateUiCookie({ filterOffen: { ...aktuell.filterOffen, karte: neu } });
  }

  function zuruecksetzen() {
    const leer: Record<string, null> = { q: null };
    for (const f of facetten) leer[f.key] = null;
    for (const k of bereichKeys) leer[k] = null;
    setze(leer);
    setSchliessSignal((s) => s + 1);
  }

  function trefferIcon(t: KarteTreffer) {
    if (t.typ === "region") return <i className="ph ph-frame-corners" aria-hidden />;
    if (t.typ === "ort") return <i className="ph ph-map-pin" aria-hidden />;
    const p = punkte.find((x) => x.id === t.id);
    return (
      <span
        className="km-treffer-punkt"
        style={{ background: p ? farbeFuer(p.art, p.farbeKey) : "#b9c0bd" }}
        aria-hidden
      />
    );
  }

  return (
    <div className="km-toolbar-bereich">
      <div className="km-toolbar">
        <div className="km-suche" ref={boxRef}>
          <div className="search search--sm">
            <i className="ph ph-magnifying-glass" aria-hidden />
            <input
              type="search"
              value={suche}
              placeholder="Ort, Region, Quelle, Materialart suchen"
              aria-label="Karte durchsuchen"
              onFocus={() => setSucheOffen(true)}
              onChange={(e) => {
                setSuche(e.target.value);
                setSucheOffen(true);
              }}
            />
            {suche && (
              <button
                type="button"
                className="search-clear"
                aria-label="Suche leeren"
                onClick={() => setSuche("")}
              >
                <i className="ph-bold ph-x" aria-hidden />
              </button>
            )}
          </div>
          {sucheOffen && suche.trim() !== "" && (
            <div className="pop pop--links km-treffer" role="listbox">
              <div className="menu">
                {treffer.map((t, i) => (
                  <button
                    key={`${t.typ}-${t.id ?? t.label}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="menu-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSucheOffen(false);
                      setSuche("");
                      onTreffer(t);
                    }}
                  >
                    {trefferIcon(t)}
                    <span className="lbl">
                      {t.label}
                      {t.meta && t.typ === "strom" && (
                        <span className="km-treffer-meta"> · {t.meta}</span>
                      )}
                    </span>
                    <span className="kurz">{TREFFER_META[t.typ]}</span>
                  </button>
                ))}
                {treffer.length === 0 && <p className="menu-leer">keine treffer.</p>}
              </div>
            </div>
          )}
        </div>

        <div className="seg" role="group" aria-label="Feedstock oder Outputs">
          {(
            [
              ["alle", "Alle"],
              ["feedstock", "Feedstock"],
              ["outputs", "Outputs"],
            ] as const
          ).map(([wert, label]) => (
            <button
              key={wert}
              type="button"
              className="seg-opt"
              aria-pressed={sicht === wert}
              onClick={() => setze({ sicht: wert === "alle" ? null : wert })}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`fchip${offen || facettenAnzahl ? " aktiv" : ""}`}
          aria-expanded={offen}
          aria-controls="karte-filter"
          onClick={toggleLeiste}
        >
          Filter
          {facettenAnzahl > 0 && <span className="fchip-count">{facettenAnzahl}</span>}
        </button>
      </div>

      {offen && (
        <div id="karte-filter" className="km-toolbar km-filterleiste">
          <FacettenChips
            facetten={facetten}
            auswahl={auswahl}
            bereichKeys={bereichKeys}
            bereich={bereich}
            mitReset={irgendeinFilter}
            onReset={zuruecksetzen}
            schliessSignal={schliessSignal}
          />
        </div>
      )}
    </div>
  );
}

/** Glas-Steuerspalte rechts oben: Zoom, Alles zeigen, Zeichnen-Modus. */
export function KarteControls({
  onZoomIn,
  onZoomOut,
  onFitAlle,
  zeichnenAktiv,
  onZeichnen,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitAlle: () => void;
  zeichnenAktiv: boolean;
  onZeichnen: () => void;
}) {
  return (
    <div className="km-controls">
      <div className="km-controls-box">
        <button type="button" className="icon-btn" aria-label="Hineinzoomen" onClick={onZoomIn}>
          <i className="ph-bold ph-plus" aria-hidden />
        </button>
        <button type="button" className="icon-btn" aria-label="Herauszoomen" onClick={onZoomOut}>
          <i className="ph-bold ph-minus" aria-hidden />
        </button>
        <div className="km-controls-trenner" aria-hidden />
        <button
          type="button"
          className="icon-btn"
          aria-label="Alle sichtbaren Ströme zeigen"
          title="Alle sichtbaren Ströme zeigen"
          onClick={onFitAlle}
        >
          <i className="ph ph-corners-out" aria-hidden />
        </button>
      </div>
      <div className="km-controls-box">
        <button
          type="button"
          className={`icon-btn${zeichnenAktiv ? " km-zeichnen-aktiv" : ""}`}
          aria-label="Fokusregion zeichnen"
          title="Fokusregion zeichnen"
          aria-pressed={zeichnenAktiv}
          onClick={onZeichnen}
        >
          <i className="ph ph-selection-plus" aria-hidden />
        </button>
      </div>
    </div>
  );
}
