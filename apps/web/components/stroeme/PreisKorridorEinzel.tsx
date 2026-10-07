import { fmtPreis, formatSpanne } from "@/lib/format";
import { NICHT_VERGLEICHBAR } from "@/lib/preis-bezug";
import type { PreisKorridorEinzel as Korridor } from "@/lib/preiskorridor-einzel";

/**
 * E38: Bandbreitenzeile am Einzelstrom. Eine Skala, zwei Stufen: das Band
 * der Vergleichsgruppe (Cluster bzw. Produktgruppe) als helle Flaeche mit
 * Strich am Mittel, darueber der Strom selbst — Feedstock als Navy-Balken
 * (min–max) mit Lime-Punkt am Mittel, Output als einzelner Punkt. Skala
 * exakt vom kleinsten bis zum groessten Wert beider, ueber 0 hinaus, wenn
 * Annahmeentgelte im Spiel sind. Ohne Band steht der benannte Zustand
 * ("zu wenig Vergleichswerte", E24). Keine Ampelfarben; die Wertung steht
 * in Worten aus der Sicht bhyo.
 */
export function PreisKorridorEinzel({ k }: { k: Korridor }) {
  if (!k.eigen && !k.band) {
    // E69: ein nicht vergleichbarer Preis IST erfasst — nur der Zustand, kein „Kein Preis erfasst".
    if (k.zustand?.includes(NICHT_VERGLEICHBAR)) return <p className="pk-zustand">{k.zustand}</p>;
    return <p className="pk-zustand">Kein Preis erfasst · {k.zustand ?? "zu wenig Vergleichswerte"}</p>;
  }
  if (!k.band) {
    return (
      <div className="pk">
        <p className="pk-zustand">
          Vergleich {k.gruppe}: {k.zustand}
        </p>
      </div>
    );
  }
  const werte = [k.band.min, k.band.max, ...(k.eigen ? [k.eigen.min, k.eigen.max] : [])];
  const lo = Math.min(...werte);
  const hi = Math.max(...werte);
  const spanne = hi - lo || 1;
  const pct = (v: number) => `${Math.round(((v - lo) / spanne) * 1000) / 10}%`;
  const breite = (a: number, b: number) => `${Math.max(0.8, Math.round(((b - a) / spanne) * 1000) / 10)}%`;

  return (
    <div className="pk" aria-label={`Preiskorridor im Vergleich zu ${k.gruppe}`}>
      <div className="pk-skala">
        {lo < 0 && hi > 0 && <span className="pk-null" style={{ left: pct(0) }} aria-hidden />}
        <span className="pk-band" style={{ left: pct(k.band.min), width: breite(k.band.min, k.band.max) }} />
        <span className="pk-band-mittel" style={{ left: pct(k.band.mittel) }} />
        {k.eigen && k.art === "biomasse" && (
          <span className="pk-eigen" style={{ left: pct(k.eigen.min), width: breite(k.eigen.min, k.eigen.max) }} />
        )}
        {k.eigen && <span className="pk-punkt" style={{ left: pct(k.eigen.mittel) }} />}
      </div>
      <div className="pk-achse">
        <span>{fmtPreis(lo)}</span>
        <span>{k.einheit}</span>
        <span>{fmtPreis(hi)}</span>
      </div>
      <dl className="pk-legende">
        <div>
          <dt>
            <span className="pk-sym pk-sym--band" aria-hidden /> {k.gruppe}
          </dt>
          <dd>
            {formatSpanne(k.band.min, k.band.max, "")}, Mittel {fmtPreis(k.band.mittel)} {k.einheit} · {k.band.n} Vergleichswerte
            {k.band.zusatz ? ` ${k.band.zusatz}` : ""}
          </dd>
        </div>
        {k.eigen && (
          <div>
            <dt>
              <span className="pk-sym pk-sym--eigen" aria-hidden /> dieser Strom
            </dt>
            <dd>
              {k.art === "biomasse"
                ? `${formatSpanne(k.eigen.min, k.eigen.max, "")}, Mittel ${fmtPreis(k.eigen.mittel)} ${k.einheit}`
                : `${fmtPreis(k.eigen.mittel)} ${k.einheit}`}
            </dd>
          </div>
        )}
      </dl>
      {k.wertung && <p className="pk-wertung">{k.wertung}</p>}
      {!k.eigen && <p className="pk-zustand">Kein Preis erfasst — nur das Vergleichsband.</p>}
    </div>
  );
}
