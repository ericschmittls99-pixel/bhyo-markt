"use client";

import {
  GRUPPE_FARBE,
  GRUPPE_LABEL,
  QUALITAET_RING,
  VEKTOR_FARBE,
  VEKTOR_LABEL,
} from "@/lib/farben";
import type { RegionUmriss } from "@/lib/register";

/**
 * Kartenlegende: Fuellfarbe = Gruppe/Vektor, Rand = Qualitaet. Optionaler
 * Abschnitt „Regionen" mit Sichtbarkeits-Toggle je Fokusregion (nur Umriss ein-/
 * ausblenden – unabhaengig vom Region-Filter, der die Datenpunkte bestimmt).
 */
export function MapLegende({
  regionen,
  versteckt,
  onToggle,
}: {
  regionen?: RegionUmriss[];
  versteckt?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  return (
    <div className="card">
      <div className="card-title">Legende</div>
      <div className="legende">
        <div className="legende-grp">
          <strong>Biomasse · Gruppe</strong>
          {Object.entries(GRUPPE_FARBE).map(([k, c]) => (
            <span className="leg" key={k}>
              <i style={{ background: c }} />
              {GRUPPE_LABEL[k]}
            </span>
          ))}
        </div>
        <div className="legende-grp">
          <strong>Output · Vektor</strong>
          {Object.entries(VEKTOR_FARBE).map(([k, c]) => (
            <span className="leg" key={k}>
              <i style={{ background: c }} />
              {VEKTOR_LABEL[k]}
            </span>
          ))}
        </div>
        <div className="legende-grp">
          <strong>Rand · Qualität</strong>
          {Object.entries(QUALITAET_RING).map(([k, c]) => (
            <span className="leg" key={k}>
              <i style={{ background: "transparent", border: `3px solid ${c}` }} />
              {k}
            </span>
          ))}
        </div>
        {regionen && regionen.length > 0 && onToggle && (
          <div className="legende-grp">
            <strong>Regionen</strong>
            {regionen.map((r) => {
              const sichtbar = !versteckt?.has(r.id);
              return (
                <button
                  type="button"
                  key={r.id}
                  className={`leg leg-toggle${sichtbar ? "" : " aus"}`}
                  aria-pressed={sichtbar}
                  onClick={() => onToggle(r.id)}
                  title={sichtbar ? "Umriss ausblenden" : "Umriss einblenden"}
                >
                  <i
                    style={{
                      background: "transparent",
                      border: "2px solid #1F2E38",
                      opacity: sichtbar ? 1 : 0.3,
                    }}
                  />
                  {r.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <p className="hint">
        Größe ~ Menge (t atro bzw. Bedarfsmenge). Datensätze ohne Standort-Pin
        erscheinen nicht auf der Karte.
      </p>
    </div>
  );
}
