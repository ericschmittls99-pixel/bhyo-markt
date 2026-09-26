import { DruckenKnopf } from "@/components/druck/DruckenKnopf";
import {
  BKG_VERMERK,
  EXPORT_SPALTEN,
  GRUPPE_LABEL,
  MODUS_SATZ,
  type ExportGruppe,
  type ExportKontext,
  metazeilen,
  zelleDruck,
  zellenWert,
} from "@/lib/export-modell";
import { fmtGeldGross, fmtMenge } from "@/lib/format";
import { potenzialEuroFeedstock, potenzialEuroOutput } from "@/lib/potenzial";
import type { Strom } from "@/lib/stroeme-modell";

/**
 * Druck-Abzug (F6 PR B): eigenes Print-Layout ohne Glaseffekte (Design-
 * System). Kopf und Fußzeile tragen dieselben Metazeilen wie die CSV; jede
 * Zelle kommt aus dem Exportmodell — Spalten, Einstufung und Zurückhalten
 * sind dieselben, nur die Zahlen laufen über lib/format.ts (E20). Keine
 * Karte (WebGL druckt nicht verlässlich). Je Strom ein Datenblatt in den
 * neun Gruppen des Modells statt einer 33-spaltigen Tabelle, die auf keine
 * Seite passt.
 */

const GRUPPEN: ExportGruppe[] = [
  "identitaet",
  "ort",
  "einordnung",
  "zeitraum",
  "mengen",
  "preise",
  "potenzial",
  "nachweis",
  "markt",
];

/** Kopfzeile ohne Einheiten-Klammer fürs Datenblatt; die Einheit steht am Wert. */
function kopfUndEinheit(kopf: string): { label: string; einheit: string | null; hinweis: string | null } {
  const m = kopf.match(/^(.*?)\s*(?:\[([^\]]+)\])?\s*(?:\(([^)]+)\))?$/);
  return { label: m?.[1]?.trim() ?? kopf, einheit: m?.[2] ?? null, hinweis: m?.[3] ?? null };
}

function summe(rows: Strom[], fn: (s: Strom) => number | null): { wert: number; n: number } {
  let wert = 0;
  let n = 0;
  for (const s of rows) {
    const v = fn(s);
    if (v != null) {
      wert += v;
      n++;
    }
  }
  return { wert, n };
}

export function DruckAbzug({ rows, kontext }: { rows: Strom[]; kontext: ExportKontext }) {
  const feed = rows.filter((s) => s.art === "biomasse");
  const out = rows.filter((s) => s.art === "output");
  const atro = summe(feed, (s) => s.mengeAtro);
  const potFeed = summe(feed, potenzialEuroFeedstock);
  const potOut = summe(out, potenzialEuroOutput);
  const geld = (v: number) => {
    const g = fmtGeldGross(v);
    return `${g.wert} ${g.einheit}`;
  };
  const meta = metazeilen(kontext);

  return (
    <main className={`druck druck--${kontext.modus}`}>
      <div className="druck-aktionen">
        <DruckenKnopf />
        <span className="c">Gedruckt wird aus dem Browser als PDF. Der Modus steht in Kopf und Fußzeile.</span>
      </div>

      <header className="druck-kopf">
        <h1>bhyo · Marktdaten</h1>
        <p className="druck-modus">{MODUS_SATZ[kontext.modus]}</p>
        <dl className="druck-meta">
          {meta
            .filter(([k]) => k !== "Modus")
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      </header>

      <section className="druck-summen" aria-label="Zusammenfassung">
        <div>
          <dt>Ströme</dt>
          <dd>{fmtMenge(rows.length)}</dd>
        </div>
        <div>
          <dt>davon Feedstock / Outputs</dt>
          <dd>
            {fmtMenge(feed.length)} / {fmtMenge(out.length)}
          </dd>
        </div>
        <div>
          <dt>Σ Menge Feedstock [t atro/a]</dt>
          <dd>{atro.n ? `${fmtMenge(atro.wert)} (${fmtMenge(atro.n)} mit Menge)` : "nicht erfasst"}</dd>
        </div>
        <div>
          <dt>Σ Potenzial Feedstock (positiv = Erlös für bhyo)</dt>
          <dd>{potFeed.n ? `${geld(potFeed.wert)} (${fmtMenge(potFeed.n)} mit Preis)` : "nicht erfasst"}</dd>
        </div>
        <div>
          <dt>Σ Potenzial Outputs (Erlös für bhyo)</dt>
          <dd>{potOut.n ? `${geld(potOut.wert)} (${fmtMenge(potOut.n)} mit Preis)` : "nicht erfasst"}</dd>
        </div>
      </section>

      {rows.length === 0 ? (
        <p className="druck-leer">Kein Strom entspricht Suche und Filtern.</p>
      ) : (
        <ol className="druck-liste">
          {rows.map((s) => (
            <li key={s.id} className="druck-blatt">
              <h2>
                {s.akteurName ?? s.bezeichnung ?? "–"}
                <span className="druck-blatt-sub">
                  {s.art === "biomasse" ? "Feedstock" : "Output"} · {(s.art === "biomasse" ? s.materialartLabel : s.produktLabel) ?? "–"}
                </span>
              </h2>
              <div className="druck-gruppen">
                {GRUPPEN.map((g) => (
                  <section key={g} className="druck-gruppe">
                    <h3>{GRUPPE_LABEL[g]}</h3>
                    <dl>
                      {EXPORT_SPALTEN.filter((sp) => sp.gruppe === g).map((sp) => {
                        const { label, einheit, hinweis } = kopfUndEinheit(sp.kopf);
                        const zelle = zellenWert(sp, s, kontext.modus);
                        const text = zelleDruck(zelle);
                        const mitEinheit = typeof zelle !== "string" && einheit ? `${text} ${einheit}` : text;
                        return (
                          <div key={sp.key} className={typeof zelle === "string" ? "zustand" : undefined}>
                            <dt>
                              {label}
                              {hinweis && <span className="c"> ({hinweis})</span>}
                            </dt>
                            <dd>{mitEinheit}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </section>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}

      <footer className="druck-fuss">
        <span>{MODUS_SATZ[kontext.modus]}</span>
        <span>Stand {kontext.stand} · {kontext.ansicht}</span>
        <span>Landkreis/Bundesland: {BKG_VERMERK}</span>
      </footer>
    </main>
  );
}
