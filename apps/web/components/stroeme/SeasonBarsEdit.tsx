"use client";

import { useRef, useState } from "react";

import {
  gleichverteilung,
  saisonWertDirekt,
  saisonWertSetzen,
} from "@/lib/formular-modell";
import { fmtAnteil } from "@/lib/format";
import { saisonAchse, saisonAnteileProzent, saisonStrecken } from "@/lib/saison";

const MONATE = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONAT_LANG = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const BAR_HOEHE = 96;
/** Harte Obergrenze fuer Ziehen UND Zahlenfeld (Review 23.09.2026). */
const ZIEH_MAX = 200;

/**
 * Zahlenfeld mit lokalem Text-Zustand: Leeren zeigt ein leeres Feld
 * (keine stehenbleibende 0, hinter die getippt wird); uebernommen wird
 * beim Tippen, auf Blur wird die Anzeige mit dem gekappten Wert
 * synchronisiert. Externe Aenderungen (Ziehen) laufen ueber value-Sync.
 */
function ZahlenFeld({
  wert,
  label,
  onWert,
}: {
  wert: number;
  label: string;
  onWert: (v: number) => void;
}) {
  const [text, setText] = useState(String(wert));
  const [fokus, setFokus] = useState(false);
  const anzeige = fokus ? text : String(wert);
  return (
    <input
      type="number"
      min={0}
      max={ZIEH_MAX}
      // Freies Raster: mit step=5 wies der Browser jeden Zwischenwert mit
      // "Please enter a nearest value" ab — die Fuenferschritte gehoeren an
      // die Pfeiltasten des Balkens, nicht an die Tastatureingabe.
      step="any"
      value={anzeige}
      aria-label={label}
      onFocus={(e) => {
        setText(String(wert));
        setFokus(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value !== "") onWert(Number(e.target.value));
      }}
      onBlur={() => {
        setFokus(false);
        if (text === "") onWert(0);
      }}
    />
  );
}

/**
 * Saison-INDEX-Editor (Umbau 23.09.2026): feste Achse 0-200 mit
 * Referenzlinie "100 %" (bewusst nicht "Durchschnitt" — ohne Normierung
 * ist der Mittelwert der zwoelf Werte beliebig). Ziehen UND Zahlenfeld kappen bei
 * 200 (Review 23.09.); extremere Profile entstehen ueber die Verhaeltnisse
 * (uebrige Monate senken). Die Achse springt nur noch fuer Altdaten mit
 * Werten ueber 200 (saisonAchse, defensiv). Unter dem Editor eine
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
          {/* Referenzlinie "100 %" — Referenzmarke, kein Durchschnitt. */}
          <div
            className="sbe-referenz"
            style={{ bottom: `${(100 / achse) * 100}%` }}
            aria-hidden
          >
            <span className="sbe-referenz-label">100 %</span>
          </div>
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
      {/* Zahlenfelder: praezise Eingabe, gleiche 200er-Kappe wie das Ziehen. */}
      <div className="sbe-zahlen">
        {werte.map((v, i) => (
          <ZahlenFeld
            key={i}
            wert={Math.round(v)}
            label={`Index ${MONAT_LANG[i]} (Zahlenfeld)`}
            onWert={(n) => onWerte(saisonWertDirekt(werte, i, n))}
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
        Abgeleitete Jahresanteile in % (Summe 100).
        <i
          className="ph ph-info sbe-info"
          title="Die abgeleitete Anteilszeile ist die fachliche Aussage — der Index darüber ist nur das Bedienmodell."
          aria-label="Die abgeleitete Anteilszeile ist die fachliche Aussage — der Index darüber ist nur das Bedienmodell."
          role="img"
        />
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
          title="Skaliert alle Monate so, dass der größte bei 200 % liegt — Form und Anteile bleiben identisch."
          onClick={() => onWerte(saisonStrecken(werte))}
        >
          Profil strecken
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
