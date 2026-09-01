"use client";

import { useState } from "react";

const MONATE = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/**
 * 12-Balken-Editor fuer die Saisonalitaet (Anteil je Monat in %). Die Werte
 * gehen als `saison_0` … `saison_11` mit ins Formular. „Gleichverteilung" setzt
 * alle Monate auf denselben Anteil. Kein KI-Vorschlag hier – das ist AP2.
 */
export function SaisonEditor() {
  const [werte, setWerte] = useState<number[]>(() => Array(12).fill(0));
  const max = Math.max(1, ...werte);

  function setMonat(i: number, v: number) {
    setWerte((w) => w.map((x, j) => (j === i ? v : x)));
  }

  function gleich() {
    const anteil = Math.round((100 / 12) * 10) / 10;
    setWerte(Array(12).fill(anteil));
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row">
        <span className="muted">Anteil je Monat (%)</span>
        <span className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={gleich}>
          Gleichverteilung
        </button>
      </div>
      <div className="saison">
        {werte.map((v, i) => (
          <div className="bar" key={i}>
            <div
              className="fill"
              style={{ height: `${(v / max) * 100}%` }}
              aria-hidden
            />
            <span className="m">{MONATE[i]}</span>
          </div>
        ))}
      </div>
      <div className="field-row" style={{ gridTemplateColumns: "repeat(12,1fr)" }}>
        {werte.map((v, i) => (
          <input
            key={i}
            type="number"
            name={`saison_${i}`}
            min={0}
            step={0.1}
            value={v}
            onChange={(e) => setMonat(i, Number(e.target.value) || 0)}
            aria-label={`Monat ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
