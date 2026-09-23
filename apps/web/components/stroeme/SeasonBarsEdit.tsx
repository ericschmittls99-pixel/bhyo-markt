"use client";

import { useRef, useState } from "react";

import { gleichverteilung, saisonWertSetzen } from "@/lib/formular-modell";

const MONATE = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONAT_LANG = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const BAR_HOEHE = 96;

/**
 * Ziehbare Saison-Balken (E10): Anteil je Monat in % der Jahresmenge, per
 * Maus/Pointer (Drag, auch quer ueber Spalten) und Tastatur (role="slider",
 * Pfeiltasten ±1, PageUp/Down ±10, Home/End) editierbar. Ersetzt die zwoelf
 * Zahlenfelder des alten SaisonEditors. "KI-Vorschlag laden" bleibt disabled
 * (Platzhalter fuer AP2).
 */
export function SeasonBarsEdit({
  werte,
  onWerte,
}: {
  werte: number[];
  onWerte: (w: number[]) => void;
}) {
  const flaeche = useRef<HTMLDivElement>(null);
  const [aktiv, setAktiv] = useState<number | null>(null);

  function wertAusPointer(clientX: number, clientY: number): [number, number] | null {
    const el = flaeche.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const spalte = Math.min(
      11,
      Math.max(0, Math.floor(((clientX - r.left) / r.width) * 12)),
    );
    const wert = (100 * (r.bottom - clientY)) / r.height;
    return [spalte, wert];
  }

  function ziehen(e: React.PointerEvent) {
    const p = wertAusPointer(e.clientX, e.clientY);
    if (!p) return;
    setAktiv(p[0]);
    onWerte(saisonWertSetzen(werte, p[0], p[1]));
  }

  function onKey(e: React.KeyboardEvent, i: number) {
    const delta =
      e.key === "ArrowUp" ? 1
      : e.key === "ArrowDown" ? -1
      : e.key === "PageUp" ? 10
      : e.key === "PageDown" ? -10
      : null;
    let neu: number | null = null;
    if (delta != null) neu = (werte[i] ?? 0) + delta;
    else if (e.key === "Home") neu = 0;
    else if (e.key === "End") neu = 100;
    if (neu == null) return;
    e.preventDefault();
    onWerte(saisonWertSetzen(werte, i, neu));
  }

  return (
    <div className="sbe">
      <div
        ref={flaeche}
        className="sbars sbe-flaeche"
        style={{ height: BAR_HOEHE }}
        onPointerDown={(e) => {
          // F0a Punkt 5: verhindert die Textauswahl beim Ziehen; die
          // Tastaturbedienung (onKeyDown an den Slots) bleibt unberuehrt.
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          ziehen(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) ziehen(e);
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      >
        {werte.map((v, i) => (
          <div className="sbar" key={i}>
            <div
              role="slider"
              tabIndex={0}
              aria-label={`Anteil ${MONAT_LANG[i]}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={v}
              aria-valuetext={`${v} %`}
              className="sbe-slot"
              onFocus={() => setAktiv(i)}
              onBlur={() => setAktiv((a) => (a === i ? null : a))}
              onKeyDown={(e) => onKey(e, i)}
            >
              {aktiv === i && (
                <span
                  className="sbe-wert"
                  // Ueber der Balkenspitze, aber in die Flaeche geclampt —
                  // sonst kollidiert das Label mit der Ueberschrift darueber.
                  style={{
                    bottom: `min(calc(100% - 16px), calc(${Math.max(3, v)}% + 4px))`,
                  }}
                >
                  {v} %
                </span>
              )}
              <div
                className="sbar-fill"
                style={{ height: `${Math.max(3, v)}%` }}
                aria-hidden
              />
            </div>
          </div>
        ))}
      </div>
      <div className="sbe-monate" aria-hidden>
        {MONATE.map((m, i) => (
          <span className="m" key={i}>{m}</span>
        ))}
      </div>
      <div className="sbe-aktionen">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => onWerte(gleichverteilung())}
        >
          Gleichverteilung
        </button>
        <button
          type="button"
          className="btn btn--sm"
          disabled
          title="Folgt mit der KI-Anreicherung (AP2)."
        >
          <i className="ph ph-sparkle" aria-hidden />
          KI-Vorschlag laden
        </button>
      </div>
    </div>
  );
}
