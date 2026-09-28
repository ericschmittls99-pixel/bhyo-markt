"use client";

import { useEffect, useState } from "react";

import { usePopoverLage } from "@/components/usePopoverLage";
import {
  bereichVon,
  jahreImBereich,
  jahreParam,
  klemme,
  reglerGrenzen,
  uhrText,
} from "@/lib/jahr-regler";

/**
 * E39: Uhr-Pille mit der aktuellen Auswahl; Klick öffnet den Jahres-Regler
 * (ein Griff im Einzeljahr, zwei im Zeitraum). Native `input type=range`:
 * Pfeiltasten, ARIA-Slider und Fokus kommen vom Browser. Beim Zeitraum
 * liegen zwei Regler übereinander; nur die Griffe fangen den Zeiger. Die
 * Auswahl wird beim Loslassen (bzw. Tastenende) in die URL geschrieben —
 * die Jahres-Logik dahinter ist unverändert.
 */
export function JahrRegler({
  zeitmodus,
  jahre,
  achse,
  onJahre,
}: {
  zeitmodus: "einzeljahr" | "zeitraum";
  jahre: number[];
  achse: number[];
  onJahre: (jahreParam: string) => void;
}) {
  const { min, max } = reglerGrenzen(achse);
  const aktuell = bereichVon(jahre);
  const [offen, setOffen] = useState(false);
  const [von, setVon] = useState(aktuell.von);
  const [bis, setBis] = useState(aktuell.bis);
  const lage = usePopoverLage(offen);

  // URL-Änderung von außen (Moduswechsel, Zurücksetzen) in die Griffe spiegeln.
  useEffect(() => {
    setVon(aktuell.von);
    setBis(aktuell.bis);
  }, [aktuell.von, aktuell.bis]);

  useEffect(() => {
    if (!offen) return;
    function zu(ev: MouseEvent) {
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.("[data-pop='jahr']")) return;
      setOffen(false);
    }
    function esc(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOffen(false);
    }
    document.addEventListener("mousedown", zu);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", zu);
      document.removeEventListener("keydown", esc);
    };
  }, [offen]);

  const einzel = zeitmodus === "einzeljahr";
  const spanne = Math.max(1, max - min);
  const pos = (j: number) => `${((j - min) / spanne) * 100}%`;

  function uebernehmen(v: number, b: number) {
    const liste = einzel ? [klemme(b, min, max)] : jahreImBereich(klemme(v, min, max), klemme(b, min, max));
    const param = jahreParam(liste);
    if (param !== jahreParam(jahre)) onJahre(param);
  }
  const commitEvents = (v: number, b: number) => ({
    onMouseUp: () => uebernehmen(v, b),
    onTouchEnd: () => uebernehmen(v, b),
    onKeyUp: () => uebernehmen(v, b),
    onBlur: () => uebernehmen(v, b),
  });

  return (
    <div data-pop="jahr" className="pop-anchor">
      <button
        type="button"
        className={`fchip${offen ? " aktiv" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={offen}
        aria-label={`Jahr wählen, aktuell ${uhrText(zeitmodus, jahre)}`}
        onClick={() => setOffen((o) => !o)}
      >
        <i className="ph ph-clock" aria-hidden />
        {uhrText(zeitmodus, jahre)}
      </button>
      {offen && (
        <div
          role="dialog"
          aria-label={einzel ? "Jahr" : "Zeitraum"}
          className="pop pop--links jr-pop"
          ref={lage.popRef}
          style={{ width: 360, ...lage.popStil }}
        >
          <div className={`jr${einzel ? " jr--einzel" : ""}`}>
            <div className="jr-labels" aria-hidden>
              {!einzel && (
                <span className="jr-label" style={{ left: pos(Math.min(von, bis)) }}>
                  {Math.min(von, bis)}
                </span>
              )}
              <span className="jr-label" style={{ left: pos(einzel ? bis : Math.max(von, bis)) }}>
                {einzel ? bis : Math.max(von, bis)}
              </span>
            </div>
            <div className="jr-spur">
              <span
                className="jr-fuellung"
                style={
                  einzel
                    ? { left: pos(bis), width: 0 }
                    : { left: pos(Math.min(von, bis)), width: `calc(${pos(Math.max(von, bis))} - ${pos(Math.min(von, bis))})` }
                }
              />
              {!einzel && (
                <input
                  type="range"
                  className="jr-griff"
                  min={min}
                  max={max}
                  step={1}
                  value={von}
                  aria-label="Von Jahr"
                  aria-valuetext={String(von)}
                  onChange={(e) => setVon(Number(e.target.value))}
                  {...commitEvents(von, bis)}
                />
              )}
              <input
                type="range"
                className="jr-griff"
                min={min}
                max={max}
                step={1}
                value={bis}
                aria-label={einzel ? "Jahr" : "Bis Jahr"}
                aria-valuetext={String(bis)}
                onChange={(e) => setBis(Number(e.target.value))}
                {...commitEvents(von, bis)}
              />
            </div>
            <div className="jr-grenzen aw-caption" aria-hidden>
              <span>{min}</span>
              <span>{max}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
