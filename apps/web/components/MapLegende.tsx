import {
  GRUPPE_FARBE,
  GRUPPE_LABEL,
  QUALITAET_RING,
  VEKTOR_FARBE,
  VEKTOR_LABEL,
} from "@/lib/farben";

/** Statische Kartenlegende: Fuellfarbe = Gruppe/Vektor, Rand = Qualitaet. */
export function MapLegende() {
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
      </div>
      <p className="hint">
        Größe ~ Menge (t atro bzw. Bedarfsmenge). Datensätze ohne Standort-Pin
        erscheinen nicht auf der Karte.
      </p>
    </div>
  );
}
