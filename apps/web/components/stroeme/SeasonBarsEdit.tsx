"use client";

import { useRef, useState } from "react";

import {
  gleichverteilung,
  saisonWertDirekt,
  saisonWertSetzen,
} from "@/lib/formular-modell";
import { fmtAnteil } from "@/lib/format";
import { saisonAchse, saisonAnteileProzent } from "@/lib/saison";

const MONATE = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONAT_LANG = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const BAR_HOEHE = 96;
/** Ziehen kappt bei 200 — Werte darueber nur per Zahlenfeld. */
const ZIEH_MAX = 200;

/**
 * Saison-INDEX-Editor (Umbau 23.09.2026): 100 = Durchschnittsmonat, feste
 * Achse 0-200 mit Referenzlinie bei 100. Ziehen (auch quer ueber Spalten)
 * kappt bei 200; je Monat erlaubt ein Zahlenfeld hoehere Indizes
 * (Stroh-Ernte ~240) — dann springt die Achse EINMALIG auf den naechsten
 * 50er-Schritt, sie waechst nie kontinuierlich mit. Unter dem Editor eine
 * schreibgeschuetzte Zeile mit den abgeleiteten Jahresanteilen (Largest
 * Remainder, Summe exakt 100): oben formen, unten ablesen. Tastatur:
 * Pfeiltasten ±5, PageUp/Down ±25, Home 0, End 100.
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
  const achse = saisonAchse(werte);
  const anteile = saisonAnteileProzent(werte);

  function wertAusPointer(clientX: number, clientY: number): [number, number] | null {
    const el = flaeche.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const spalte = Math.min(
      11,
      Math.max(0, Math.floor(((clientX - r.left) / r.width) * 12)),
    );
    // Die Flaeche bildet die aktuelle Achse ab; das Ziehen selbst kappt
    // trotzdem bei 200 (saisonWertSetzen) — die Achse laeuft nicht davon.
    const wert = (achse * (r.bottom - clientY)) / r.height;
    return [spalte, Math.min(ZIEH_MAX, wert)];
  }

  function ziehen(e: React.PointerEvent) {
    const p = wertAusPointer(e.clientX, e.clientY);
    if (!p) return;
    setAktiv(p[0]);
    onWerte(saisonWertSetzen(werte, p[0], p[1]));
  }

  function onKey(e: React.KeyboardEvent, i: number) {
    const delta =
      e.key === "ArrowUp" ? 5
      : e.key === "ArrowDown" ? -5
      : e.key === "PageUp" ? 25
      : e.key === "PageDown" ? -25
      : null;
    let neu: number | null = null;
    if (delta != null) neu = (werte[i] ?? 0) + delta;
    else if (e.key === "Home") neu = 0;
    else if (e.key === "End") neu = 100;
    if (neu == null) return;
    e.preventDefault();
    onWerte(saisonWertSetzen(werte, i, neu));
  }

  const hoehePct = (v: number) => Math.min(100, (v / achse) * 100);

  return (
    <div className="sbe">
      <div className="sbe-achse">
        <span className="sbe-achse-max">{achse} %</span>
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
          {/* Referenzlinie: 100 = Durchschnittsmonat. */}
          <div
            className="sbe-referenz"
            style={{ bottom: `${(100 / achse) * 100}%` }}
            aria-hidden
          />
          {werte.map((v, i) => (
            <div className="sbar" key={i}>
              <div
                role="slider"
                tabIndex={0}
                aria-label={`Index ${MONAT_LANG[i]}`}
                aria-valuemin={0}
                aria-valuemax={achse}
                aria-valuenow={v}
                aria-valuetext={`${v} % (Anteil ${anteile[i]} %)`}
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
                      bottom: `min(calc(100% - 16px), calc(${Math.max(3, hoehePct(v))}% + 4px))`,
                    }}
                  >
                    {Math.round(v)} %
                  </span>
                )}
                <div
                  className="sbar-fill"
                  style={{ height: `${Math.max(3, hoehePct(v))}%` }}
                  aria-hidden
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="sbe-monate" aria-hidden>
        {MONATE.map((m, i) => (
          <span className="m" key={i}>{m}</span>
        ))}
      </div>
      {/* Zahlenfelder: einziger Weg zu Indizes ueber 200. */}
      <div className="sbe-zahlen">
        {werte.map((v, i) => (
          <input
            key={i}
            type="number"
            min={0}
            step={5}
            value={Math.round(v)}
            aria-label={`Index ${MONAT_LANG[i]} (Zahlenfeld)`}
            onChange={(e) =>
              onWerte(saisonWertDirekt(werte, i, Number(e.target.value) || 0))
            }
          />
        ))}
      </div>
      {/* Schreibgeschuetzt: was der Index fuer die Menge bedeutet. */}
      <div className="sbe-anteile" aria-label="Abgeleitete Jahresanteile">
        {anteile.map((a, i) => (
          <span className="sbe-anteil" key={i} title={`${MONAT_LANG[i]}: ${fmtAnteil(a)} der Jahresmenge`}>
            {a}
          </span>
        ))}
      </div>
      <span className="c sbe-anteile-caption">
        Abgeleitete Jahresanteile in % (Summe 100) — 100 % Index = Durchschnittsmonat.
      </span>
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
