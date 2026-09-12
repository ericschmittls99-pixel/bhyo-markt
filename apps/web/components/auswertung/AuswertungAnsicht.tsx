"use client";

import Link from "next/link";

import { AuswertungToolbar } from "@/components/auswertung/AuswertungToolbar";
import { EmptyState } from "@/components/shell/EmptyState";
import { Detail } from "@/components/stroeme/Detail";
import type { FacettenChipDef } from "@/components/stroeme/FacettenChips";
import { KonfidenzPill, StatusPillV2 } from "@/components/stroeme/Pillen";
import { SeasonBarsMini } from "@/components/stroeme/SeasonBarsMini";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import type {
  BelegtypZeile,
  ClusterZeile,
  JahresBalken,
  KpiKarte,
  PreisDaten,
  QualitaetsDaten,
  SaisonDaten,
  Sicht,
  StatusZeile,
  VerifZeile,
} from "@/lib/auswertung-modell";
import type { Strom } from "@/lib/stroeme-modell";

/**
 * Bento-Dashboard von auswertung. (AP1i PR 7). Alle Kennzahlen kommen fertig
 * berechnet vom Server (lib/auswertung-modell, pur ueber Strom[]); hier lebt
 * nur Darstellung + Klick-Filter: jede Modulzeile schreibt ihre Facette in
 * den geteilten Querystring (Mockup rowSt: aktiv = selected-Flaeche, uebrige
 * Zeilen dimmen). Diagramme sind flaches HTML/CSS/SVG — Verlaeufe nur als
 * Identitaet ueber die Orb-Assets (>= 20 px), Qualitaet in der Navy-Rampe.
 */
export function AuswertungAnsicht({
  kpis,
  cluster,
  clusterFuss,
  qualitaet,
  status,
  saison,
  belegtypen,
  jahre,
  preis,
  verif,
  facetten,
  auswahl,
  bereich,
  sicht,
  irgendeinFilter,
  detailStrom,
  historie,
  begruendung,
  verifizierung,
}: {
  kpis: KpiKarte[];
  cluster: ClusterZeile[];
  clusterFuss: string | null;
  qualitaet: QualitaetsDaten;
  status: StatusZeile[];
  saison: SaisonDaten;
  belegtypen: BelegtypZeile[];
  jahre: JahresBalken[];
  preis: PreisDaten;
  verif: VerifZeile[];
  facetten: FacettenChipDef[];
  auswahl: Record<string, string[]>;
  bereich: Record<string, string>;
  sicht: Sicht;
  irgendeinFilter: boolean;
  detailStrom: Strom | null;
  historie: { zeitpunkt: string; text: string }[];
  begruendung: string | null;
  verifizierung: string | null;
}) {
  const { setze } = useUrlZustand();
  const feedMode = sicht !== "outputs";
  const leer = kpis[0]?.wert === "0";
  // Cluster-Zeilen togglen die Facette ihrer Art (wie die karte.-Legende):
  // Feedstock-Cluster -> cluster (filtert Biomasse), Output-Gruppen -> gruppe.
  const clusterFacette = feedMode ? "cluster" : "gruppe";

  function toggle(key: string, wert: string) {
    const sel = auswahl[key] ?? [];
    const neu = sel.includes(wert) ? sel.filter((v) => v !== wert) : [...sel, wert];
    setze({ [key]: neu });
  }

  /** Zeilenzustand wie im Mockup: aktiv hebt hervor, andere dimmen. */
  function zeilenKlasse(basis: string, key: string, wert: string) {
    const sel = auswahl[key] ?? [];
    const aktiv = sel.includes(wert);
    return `${basis}${aktiv ? " aktiv" : ""}${sel.length && !aktiv ? " gedimmt" : ""}`;
  }
  const istAktiv = (key: string, wert: string) =>
    (auswahl[key] ?? []).includes(wert);

  const UMFANG = 2 * Math.PI * 56;
  let donutAcc = 0;
  const donutSegs = qualitaet.segmente.map((s) => {
    const seg = {
      stufe: s.stufe,
      dash: `${(s.anteil * UMFANG).toFixed(2)} ${UMFANG.toFixed(2)}`,
      offset: (-donutAcc * UMFANG).toFixed(2),
      gedimmt:
        (auswahl.qualitaet?.length ?? 0) > 0 && !istAktiv("qualitaet", s.stufe),
    };
    donutAcc += s.anteil;
    return seg;
  });

  return (
    <div className="aw-seite">
      <AuswertungToolbar
        facetten={facetten}
        auswahl={auswahl}
        bereich={bereich}
        sicht={sicht}
        irgendeinFilter={irgendeinFilter}
      />

      <div className="aw-inhalt">
        {leer ? (
          <EmptyState
            icon="chart-bar"
            titel="keine belege."
            beschreibung="Kein Beleg entspricht der aktuellen Auswahl."
          >
            <Link className="btn btn--sm" href="/auswertung">
              Filter zurücksetzen
            </Link>
          </EmptyState>
        ) : (
          <div className="aw-grid">
            {kpis.map((k) => (
              <section className="aw-modul aw-kpi" key={k.label}>
                <p className="aw-kpi-wert">
                  <strong>{k.wert}</strong>
                  <span>{k.einheit}</span>
                </p>
                <p className="aw-kpi-label">{k.label}</p>
                <p className="aw-caption">{k.caption}</p>
              </section>
            ))}

            <section className="aw-modul aw-modul--b2">
              <header className="aw-kopf">
                <h3 className="aw-kicker">
                  {feedMode ? "biomasse je cluster." : "belege je output-gruppe."}
                </h3>
                <span className="aw-caption">
                  {feedMode ? "t atro/a" : "Anzahl · Bedarf je Einheit"}
                </span>
              </header>
              <div className="aw-zeilen aw-zeilen--scroll">
                {cluster.map((z) => (
                  <button
                    type="button"
                    key={z.key}
                    className={zeilenKlasse("aw-clusterzeile", clusterFacette, z.key)}
                    aria-pressed={istAktiv(clusterFacette, z.key)}
                    onClick={() => toggle(clusterFacette, z.key)}
                  >
                    <img className="aw-orb32" src={z.orb} alt="" aria-hidden />
                    <span className="aw-clusterzeile-mitte">
                      <span className="aw-clusterzeile-kopf">
                        <span className="lbl">{z.label}</span>
                        <span className="aw-caption">{z.meta}</span>
                      </span>
                      <span className="aw-balken">
                        <span
                          className="aw-balken-fill"
                          style={{ width: `${z.pct}%`, background: z.farbe }}
                        />
                      </span>
                    </span>
                    <span className="aw-zeilenwert">{z.wertText}</span>
                  </button>
                ))}
              </div>
              {clusterFuss && <p className="aw-caption aw-fuss">{clusterFuss}</p>}
            </section>

            <section className="aw-modul aw-modul--h2">
              <h3 className="aw-kicker">qualität der belege.</h3>
              <div className="aw-donut">
                <svg
                  width="132"
                  height="132"
                  viewBox="0 0 132 132"
                  role="img"
                  aria-label="Verteilung der Qualitätsstufen"
                >
                  <circle cx="66" cy="66" r="56" className="aw-donut-track" strokeWidth="14" />
                  {donutSegs.map((s) => (
                    <circle
                      key={s.stufe}
                      cx="66"
                      cy="66"
                      r="56"
                      className={`aw-donut-seg aw-donut-seg--${s.stufe}${s.gedimmt ? " gedimmt" : ""}`}
                      strokeWidth="14"
                      strokeDasharray={s.dash}
                      strokeDashoffset={s.offset}
                    />
                  ))}
                </svg>
                <div className="aw-donut-mitte" aria-hidden>
                  <strong>
                    {qualitaet.abProzent}
                    <span> %</span>
                  </strong>
                  <span className="aw-caption">A + B</span>
                </div>
              </div>
              <div className="aw-zeilen">
                {qualitaet.zeilen.map((q) => (
                  <button
                    type="button"
                    key={q.stufe}
                    className={zeilenKlasse("aw-qualzeile", "qualitaet", q.stufe)}
                    aria-pressed={istAktiv("qualitaet", q.stufe)}
                    onClick={() => toggle("qualitaet", q.stufe)}
                  >
                    <KonfidenzPill stufe={q.stufe} />
                    <span className="aw-caption lbl">{q.label}</span>
                    <span className="aw-zeilenwert">{q.anzahl}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="aw-modul aw-modul--h2">
              <h3 className="aw-kicker">status.</h3>
              <div className="aw-zeilen aw-zeilen--status">
                {status.map((st) => (
                  <button
                    type="button"
                    key={st.key}
                    className={zeilenKlasse("aw-statuszeile", "status", st.key)}
                    aria-pressed={istAktiv("status", st.key)}
                    onClick={() => toggle("status", st.key)}
                  >
                    <span className="aw-statuszeile-kopf">
                      <StatusPillV2 status={st.key} />
                      <span className="aw-zeilenwert">
                        {st.anzahl}
                        <span className="aw-caption"> · {st.pct} %</span>
                      </span>
                    </span>
                    <span className="aw-balken aw-balken--fein">
                      <span
                        className="aw-balken-fill aw-balken-fill--ink"
                        style={{ width: `${st.pct}%` }}
                      />
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="aw-modul aw-modul--b2">
              <header className="aw-kopf">
                <h3 className="aw-kicker">saisonalität.</h3>
                <span className="aw-caption">Monatsindex, 100 % = Jahresmittel</span>
              </header>
              {saison.feed && (
                <div className="aw-saison">
                  <span className="aw-caption">
                    angebot · feedstock, gewichtet nach t atro/a
                  </span>
                  <SeasonBarsMini werte={saison.feed} hoehe={64} />
                </div>
              )}
              {saison.out && (
                <div className="aw-saison">
                  <span className="aw-caption">bedarf · outputs, gleichgewichtet</span>
                  <SeasonBarsMini werte={saison.out} hoehe={64} />
                </div>
              )}
              {saison.notiz && <p className="aw-caption aw-fuss">{saison.notiz}</p>}
            </section>

            <section className="aw-modul aw-modul--w2">
              <h3 className="aw-kicker">belegtypen.</h3>
              <div className="aw-belegtypen">
                {belegtypen.map((bt) => (
                  <button
                    type="button"
                    key={bt.key}
                    className={zeilenKlasse("aw-belegzeile", "belegtyp", bt.key)}
                    aria-pressed={istAktiv("belegtyp", bt.key)}
                    onClick={() => toggle("belegtyp", bt.key)}
                  >
                    <span className="lbl">{bt.label}</span>
                    <span className="aw-balken aw-balken--fein">
                      <span
                        className="aw-balken-fill aw-balken-fill--ink"
                        style={{ width: `${bt.pct}%` }}
                      />
                    </span>
                    <span className="aw-zeilenwert">{bt.anzahl}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="aw-modul aw-modul--w2">
              <header className="aw-kopf">
                <h3 className="aw-kicker">
                  {feedMode ? "verfügbare biomasse je jahr." : "aktive belege je jahr."}
                </h3>
                <span className="aw-caption">{feedMode ? "t atro/a" : "Belege"}</span>
              </header>
              <div className="aw-jahre">
                {jahre.map((j) => (
                  <div
                    className="aw-jahr"
                    key={j.jahr}
                    title={`${j.jahr}: ${j.wertText}`}
                  >
                    <span className="aw-caption">{j.wertText}</span>
                    <span className="aw-jahr-track">
                      <span
                        className={`aw-jahr-fill${j.aktuell ? " aktuell" : ""}`}
                        style={{ height: `${j.pct}%` }}
                      />
                    </span>
                    <span className="aw-caption">{j.jahr}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="aw-modul aw-modul--w2">
              <h3 className="aw-kicker">
                {feedMode ? "preiskorridor · feedstock." : "preise · outputs."}
              </h3>
              <div className="aw-preise">
                {preis.stats.map((ps) => (
                  <p className="aw-kpi-wert aw-kpi-wert--klein" key={ps.label}>
                    <strong>{ps.wert}</strong>
                    <span>{ps.einheit}</span>
                    <em className="aw-caption">{ps.label}</em>
                  </p>
                ))}
                {preis.stats.length === 0 && (
                  <p className="aw-caption">Keine Preise in der Auswahl.</p>
                )}
              </div>
              {preis.korridor && (
                <div className="aw-korridor">
                  <span className="aw-korridor-track">
                    <span
                      className="aw-korridor-punkt"
                      style={{ left: `${preis.korridor.pos}%` }}
                      aria-hidden
                    />
                  </span>
                  <span className="aw-korridor-enden aw-caption">
                    <span>min {preis.korridor.minText} €/t</span>
                    <span>max {preis.korridor.maxText} €/t</span>
                  </span>
                </div>
              )}
            </section>

            <section className="aw-modul aw-modul--w2">
              <h3 className="aw-kicker">nächste verifizierung.</h3>
              <div className="aw-zeilen">
                {verif.map((v) => (
                  <button
                    type="button"
                    key={v.id}
                    className="aw-verifzeile"
                    onClick={() => setze({ detail: v.id }, "push")}
                  >
                    <img className="aw-orb16" src={v.orb} alt="" aria-hidden />
                    <span className="lbl">
                      {v.titel} <span className="aw-caption">· {v.sub}</span>
                    </span>
                    {v.ueberfaellig && <span className="pill-wert">fällig.</span>}
                    <span className="aw-caption aw-verifdatum">{v.datum}</span>
                  </button>
                ))}
                {verif.length === 0 && (
                  <p className="aw-caption">Keine Fristen in der Auswahl.</p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      {detailStrom && (
        <Detail
          strom={detailStrom}
          historie={historie}
          begruendung={begruendung}
          verifizierung={verifizierung}
          modal={false}
          canEdit={false}
          stroemeHref={`/register?tab=${detailStrom.art === "biomasse" ? "biomasse" : "output"}&detail=${detailStrom.id}`}
        />
      )}
    </div>
  );
}
