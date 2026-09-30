"use client";

/**
 * E56: Segment-Schalter „Alle | Für mich" — dieselbe Huelle wie der
 * Feedstock/Outputs-Schalter, in stroeme. und karte. Der Zustand lebt in der
 * URL (fuer=mich) wie jeder andere Filter (E32); die Filterlogik steht in
 * lib/fuer-mich.ts.
 */
export function FuerMichSchalter({ aktiv, onWahl }: { aktiv: boolean; onWahl: (mich: boolean) => void }) {
  return (
    <div className="seg" role="group" aria-label="Alle oder nur für mich">
      <button type="button" className="seg-opt" aria-pressed={!aktiv} onClick={() => onWahl(false)}>
        Alle
      </button>
      <button type="button" className="seg-opt" aria-pressed={aktiv} onClick={() => onWahl(true)} title="Von mir gesperrt, mir zugewiesen oder mit meiner Beteiligung">
        Für mich
      </button>
    </div>
  );
}
