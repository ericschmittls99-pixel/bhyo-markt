"use client";

import { useEffect, useState } from "react";

import { usePopoverLage } from "@/components/usePopoverLage";

export interface SortOption {
  key: string;
  label: string;
  /** Kurzer Zusatz rechts (z. B. „aufsteigend"), nur bei der aktiven Option. */
  kurz?: string;
}

/**
 * Sortier-Pille mit Menü — EINE Komponente für ströme. (FilterSortZeile) und
 * auswertung. (E39). Wer sortiert wird, entscheidet der Aufrufer über
 * `onWahl`; die Pille zeigt die aktive Option und klappt nach den geteilten
 * Popover-Regeln auf (nie über den rechten Rand).
 */
export function SortMenue({
  optionen,
  aktiv,
  onWahl,
  kompakt = false,
  schliessSignal = 0,
  onOffen,
}: {
  optionen: readonly SortOption[];
  aktiv: string;
  onWahl: (key: string) => void;
  /** Nur Icon (Platzmangel). */
  kompakt?: boolean;
  /** Erhöht der Parent den Zähler, schließt das Menü (z. B. Filter-Popover geöffnet). */
  schliessSignal?: number;
  onOffen?: () => void;
}) {
  const [offen, setOffen] = useState(false);
  const lage = usePopoverLage(offen);
  const label = optionen.find((o) => o.key === aktiv)?.label ?? optionen[0]?.label ?? "";

  useEffect(() => {
    function onDown(ev: MouseEvent) {
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.("[data-pop]")) return;
      setOffen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOffen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (schliessSignal > 0) setOffen(false);
  }, [schliessSignal]);

  return (
    <div data-pop className="pop-anchor">
      <button
        type="button"
        className="btn btn--sm st-sort"
        aria-haspopup="menu"
        aria-expanded={offen}
        aria-label={kompakt ? `Sortieren: ${label}` : undefined}
        onClick={() => {
          setOffen((v) => !v);
          if (!offen) onOffen?.();
        }}
      >
        <i className="ph ph-arrows-down-up" aria-hidden />
        {!kompakt && (
          <>
            {label}
            <i className="ph-bold ph-caret-down" aria-hidden />
          </>
        )}
      </button>
      {offen && (
        <div
          role="menu"
          aria-label="Sortieren"
          className="pop"
          ref={lage.popRef}
          style={{ width: 240, ...lage.popStil }}
        >
          <div className="menu">
            {optionen.map((o) => (
              <button
                key={o.key}
                type="button"
                role="menuitemradio"
                aria-checked={o.key === aktiv}
                className="menu-item"
                onClick={() => {
                  onWahl(o.key);
                  setOffen(false);
                }}
              >
                <span className="lbl">{o.label}</span>
                {o.key === aktiv && (
                  <>
                    {o.kurz && <span className="kurz">{o.kurz}</span>}
                    <i className="ph-bold ph-check" aria-hidden />
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
