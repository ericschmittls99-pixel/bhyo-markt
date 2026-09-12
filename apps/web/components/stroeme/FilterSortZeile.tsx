"use client";

import { useEffect, useRef, useState } from "react";

import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import type { FacettenOption } from "@/lib/stroeme-modell";
import { updateUiCookie } from "@/lib/ui-state";

export interface FacettenChip {
  key: string;
  label: string;
  optionen: FacettenOption[];
}

const BEREICH_KEYS = [
  "mengeMin",
  "mengeMax",
  "preisMin",
  "preisMax",
  "vonAb",
  "erstellt",
] as const;

/**
 * Zeile 2 von stroeme. (V2): links Zaehltext bzw. ausgeklappte Facetten-Chips,
 * rechts Filter-Toggle, Sortier-Menue und Grid/Liste. Auf-/Zuklappen der
 * Filterleiste lebt im Cookie bhyo_ui (Bedienzustand), die Filter selbst im
 * Querystring. Bei Platzmangel weicht erst „Weitere Filter" auf ein Plus-Icon,
 * dann der Sortier-Button auf Icon-only aus (wie im Mockup).
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
  ansicht,
  offenInitial,
  irgendeinFilter,
}: {
  art: "biomasse" | "output";
  countText: string;
  facetten: FacettenChip[];
  auswahl: Record<string, string[]>;
  bereich: Record<(typeof BEREICH_KEYS)[number], string>;
  sortKey: string;
  richtung: "auf" | "ab";
  sortOptionen: [string, string][];
  ansicht: "grid" | "liste";
  offenInitial: boolean;
  irgendeinFilter: boolean;
}) {
  const { setze } = useUrlZustand();
  const [offen, setOffen] = useState(offenInitial);
  const [offeneFacette, setOffeneFacette] = useState<string | null>(null);
  const [facettenSuche, setFacettenSuche] = useState("");
  const [bereichOffen, setBereichOffen] = useState(false);
  const [sortOffen, setSortOffen] = useState(false);
  const [zeilenBreite, setZeilenBreite] = useState(0);
  const zeileRef = useRef<HTMLDivElement>(null);
  const sucheRef = useRef<HTMLInputElement>(null);

  // Popover schliessen bei Klick ausserhalb / Escape.
  useEffect(() => {
    function onDown(ev: MouseEvent) {
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.("[data-pop]")) return;
      setOffeneFacette(null);
      setBereichOffen(false);
      setSortOffen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== "Escape") return;
      setOffeneFacette(null);
      setBereichOffen(false);
      setSortOffen(false);
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

  useEffect(() => {
    if (offeneFacette) sucheRef.current?.focus();
  }, [offeneFacette]);

  const bereichAnzahl = BEREICH_KEYS.filter((k) => bereich[k] !== "").length;
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
    setOffeneFacette(null);
    setBereichOffen(false);
    const aktuell = updateUiCookie({});
    updateUiCookie({ filterOffen: { ...aktuell.filterOffen, stroeme: neu } });
  }

  function toggleWert(key: string, wert: string) {
    const sel = auswahl[key] ?? [];
    const neu = sel.includes(wert) ? sel.filter((v) => v !== wert) : [...sel, wert];
    setze({ [key]: neu });
  }

  function zuruecksetzen() {
    const leer: Record<string, null> = { q: null };
    for (const f of facetten) leer[f.key] = null;
    for (const k of BEREICH_KEYS) leer[k] = null;
    setze(leer);
    setOffeneFacette(null);
    setBereichOffen(false);
  }

  function sortiere(key: string) {
    const neueRichtung =
      key === sortKey ? (richtung === "auf" ? "ab" : "auf") : "auf";
    setze({ sort: key, richtung: neueRichtung });
    setSortOffen(false);
  }

  const einheit = art === "biomasse" ? "t FM/a" : "Menge";

  return (
    <div className="st-filterzeile" ref={zeileRef}>
      {!offen && <span className="st-count">{countText}</span>}

      {offen && (
        <div id="strom-filter" className="st-chips">
          {facetten.map((f) => {
            const sel = auswahl[f.key] ?? [];
            const istOffen = offeneFacette === f.key;
            const fq = facettenSuche.trim().toLowerCase();
            const optionen = istOffen
              ? f.optionen.filter((o) => !fq || o.label.toLowerCase().includes(fq))
              : [];
            return (
              <div key={f.key} data-pop className="pop-anchor">
                <button
                  type="button"
                  className={`fchip${sel.length || istOffen ? " aktiv" : ""}`}
                  aria-haspopup="menu"
                  aria-expanded={istOffen}
                  onClick={() => {
                    setOffeneFacette(istOffen ? null : f.key);
                    setFacettenSuche("");
                    setBereichOffen(false);
                    setSortOffen(false);
                  }}
                >
                  {f.label}
                  {sel.length > 0 && <span className="fchip-count">{sel.length}</span>}
                </button>
                {istOffen && (
                  <div role="dialog" aria-label={f.label} className="pop pop--links" style={{ width: 280 }}>
                    <div className="pop-suche">
                      <div className="search search--sm">
                        <i className="ph ph-magnifying-glass" aria-hidden />
                        <input
                          ref={sucheRef}
                          type="search"
                          value={facettenSuche}
                          onChange={(e) => setFacettenSuche(e.target.value)}
                          placeholder={`${f.label} suchen`}
                          aria-label={`${f.label} suchen`}
                        />
                      </div>
                    </div>
                    <div className="menu" role="menu">
                      {sel.length > 0 && optionen.length > 0 && (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            className="menu-item"
                            onClick={() => setze({ [f.key]: null })}
                          >
                            <i className="ph-bold ph-x" aria-hidden />
                            <span className="lbl">Auswahl aufheben</span>
                          </button>
                          <div className="pop-divider" />
                        </>
                      )}
                      {optionen.map((o) => (
                        <button
                          key={o.wert}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={sel.includes(o.wert)}
                          className="menu-item"
                          onClick={() => toggleWert(f.key, o.wert)}
                        >
                          <span className={`check${sel.includes(o.wert) ? " an" : ""}`} aria-hidden>
                            {sel.includes(o.wert) && <i className="ph-bold ph-check" />}
                          </span>
                          <span className="lbl">{o.label}</span>
                        </button>
                      ))}
                      {optionen.length === 0 && <p className="menu-leer">keine treffer.</p>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div data-pop className="pop-anchor">
            <button
              type="button"
              className={`fchip${bereichAnzahl || bereichOffen ? " aktiv" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={bereichOffen}
              aria-label="Weitere Filter"
              onClick={() => {
                setBereichOffen((v) => !v);
                setOffeneFacette(null);
                setSortOffen(false);
              }}
            >
              {bereichKompakt ? <i className="ph-bold ph-plus" aria-hidden /> : "Weitere Filter"}
              {bereichAnzahl > 0 && <span className="fchip-count">{bereichAnzahl}</span>}
            </button>
            {bereichOffen && (
              <div role="dialog" aria-label="Weitere Filter" className="pop pop--links pop--form" style={{ width: 400 }}>
                <label className="pf">
                  <span>Menge min</span>
                  <span className="pf-feld">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={bereich.mengeMin}
                      onChange={(e) => setze({ mengeMin: e.target.value })}
                    />
                    <em>{einheit}</em>
                  </span>
                </label>
                <label className="pf">
                  <span>Menge max</span>
                  <span className="pf-feld">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={bereich.mengeMax}
                      onChange={(e) => setze({ mengeMax: e.target.value })}
                    />
                    <em>{einheit}</em>
                  </span>
                </label>
                <label className="pf">
                  <span>{art === "biomasse" ? "Preiskorridor (Mittel)" : "Preis"}</span>
                  <span className="pf-feld">
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="min"
                      value={bereich.preisMin}
                      onChange={(e) => setze({ preisMin: e.target.value })}
                    />
                    <em>€</em>
                  </span>
                </label>
                <label className="pf">
                  <span aria-hidden>&nbsp;</span>
                  <span className="pf-feld">
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="max"
                      value={bereich.preisMax}
                      onChange={(e) => setze({ preisMax: e.target.value })}
                    />
                    <em>€</em>
                  </span>
                </label>
                <label className="pf">
                  <span>Verfügbar ab</span>
                  <span className="pf-feld">
                    <input
                      type="month"
                      value={bereich.vonAb}
                      onChange={(e) => setze({ vonAb: e.target.value })}
                    />
                  </span>
                </label>
                <label className="pf">
                  <span>Erstellt am</span>
                  <span className="pf-feld">
                    <input
                      type="date"
                      value={bereich.erstellt}
                      onChange={(e) => setze({ erstellt: e.target.value })}
                    />
                  </span>
                </label>
              </div>
            )}
          </div>

          {irgendeinFilter && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Filter zurücksetzen"
              onClick={zuruecksetzen}
            >
              <i className="ph-bold ph-x" aria-hidden />
            </button>
          )}
        </div>
      )}

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
              setOffeneFacette(null);
              setBereichOffen(false);
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
      </div>
    </div>
  );
}
