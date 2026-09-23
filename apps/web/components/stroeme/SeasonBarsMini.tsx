import { fmtAnteil } from "@/lib/format";
import { saisonAnteileProzent } from "@/lib/saison";

const MONATE = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** Saisonalitaets-Anzeige (V2): 12 Balken, Peak hervorgehoben, read-only. */
export function SeasonBarsMini({
  werte,
  hoehe = 56,
}: {
  werte: number[];
  hoehe?: number;
}) {
  const max = Math.max(1, ...werte);
  const peak = werte.indexOf(Math.max(...werte));
  // E20: Anteils-DARSTELLUNG ganzzahlig via Largest Remainder (Summe exakt
  // 100); die gespeicherten Werte (Index, Skala bedeutungslos) bleiben
  // unveraendert.
  const anteile = saisonAnteileProzent(werte);
  return (
    <div className="sbars" style={{ height: hoehe + 18 }}>
      {werte.map((v, i) => (
        <div className="sbar" key={i} title={`${MONATE[i]}: ${fmtAnteil(anteile[i]!)}`}>
          <div
            className={`sbar-fill${i === peak && v > 0 ? " peak" : ""}`}
            style={{ height: `${Math.max(3, (v / max) * hoehe)}px` }}
            aria-hidden
          />
          <span className="m">{MONATE[i]}</span>
        </div>
      ))}
    </div>
  );
}
