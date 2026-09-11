export interface ChainSchritt {
  label: string;
  wert: string;
  einheit: string;
  quelle?: string;
  ergebnis?: boolean;
}

/**
 * ConversionChain (V2): gestapelte Zeilen Rohmenge -> TS -> Asche -> t atro,
 * die Ergebniszeile in Tinte. Reine Anzeige, die Rechnung passiert im Server.
 */
export function ConversionChain({ schritte }: { schritte: ChainSchritt[] }) {
  return (
    <div className="chain">
      {schritte.map((s) => (
        <div key={s.label} className={`chain-row${s.ergebnis ? " ergebnis" : ""}`}>
          <span className="chain-txt">
            <span className="l">{s.label}</span>
            {s.quelle && <span className="q">{s.quelle}</span>}
          </span>
          <span className="chain-wert">
            {s.wert}
            {s.einheit ? ` ${s.einheit}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
