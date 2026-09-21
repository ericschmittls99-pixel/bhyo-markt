"use client";

import { useState } from "react";

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
  PreisStat,
  QualitaetsDaten,
  SaisonDaten,
  Sicht,
  SpannenUnterzeile,
  SpannenZeile,
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
 *
 * Die beiden Sichten ordnen dieselben Module unterschiedlich (Umbau Eric
 * 21.09.): Feedstock fliesst von Menge ueber Wert zu Belastbarkeit und endet
 * unten rechts mit der naechsten Verifizierung; Outputs behaelt das
 * urspruengliche PR-7-Layout.
 */
export function AuswertungAnsicht({
  kpis,
  auswahlText,
  anzahl,
  cluster,
  qualitaet,
  status,
  saison,
  belegtypen,
  jahre,
  preis,
  potenzial,
  preisKorridore,
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
  auswahlText: string | null;
  anzahl: number;
  cluster: ClusterZeile[];
  qualitaet: QualitaetsDaten;
  status: StatusZeile[];
  saison: SaisonDaten;
  belegtypen: BelegtypZeile[];
  jahre: JahresBalken[];
  preis: PreisStat[];
  potenzial: SpannenZeile[];
  preisKorridore: SpannenZeile[];
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
  const feedMode = sicht === "feedstock";
  const leer = anzahl === 0;
  // Akkordeon-Zustand je Modul+Cluster (rein clientseitig, nicht in der URL).
  const [offen, setOffen] = useState<Record<string, boolean>>({});
  const flip = (k: string) => setOffen((o) => ({ ...o, [k]: !o[k] }));
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

  /** Aufklapp-Pfeil des Akkordeons (eigener Knopf neben der Filter-Zeile). */
  const caretKnopf = (k: string, auf: boolean) => (
    <button
      type="button"
      className="aw-akk-caret"
      aria-expanded={auf}
      aria-label={auf ? "Materialarten verbergen" : "Materialarten anzeigen"}
      onClick={() => flip(k)}
    >
      <i className={`ph-bold ph-caret-${auf ? "up" : "down"}`} aria-hidden />
    </button>
  );

  /** Min–Max-Band mit ø-Punkt (Cluster- und Materialart-Zeilen). */
  const spannBand = (u: SpannenUnterzeile, farbe: string) => (
    <span className="aw-spannzeile-band">
      <span className="aw-caption">{u.minText}</span>
      <span className="aw-spannband">
        <span
          className="aw-spannband-fill"
          style={{
            left: `${u.vonPct}%`,
            width: `${Math.max(2, u.bisPct - u.vonPct)}%`,
            background: farbe,
          }}
        />
        <span className="aw-spannband-punkt" style={{ left: `${u.mittelPct}%` }} />
      </span>
      <span className="aw-caption">{u.maxText}</span>
    </span>
  );

  const kpiModule = kpis.map((k) => (
    <section className="aw-modul aw-kpi" key={k.label}>
      <p className="aw-kpi-wert">
        <strong>{k.wert}</strong>
        <span>{k.einheit}</span>
      </p>
      <p className="aw-kpi-label">{k.label}</p>
      <p className="aw-caption">{k.caption}</p>
    </section>
  ));

  const clusterModul = (
    <section className="aw-modul aw-modul--b2">
      <header className="aw-kopf">
        <h3 className="aw-kicker">
          {feedMode ? "feedstock je cluster." : "belege je output-gruppe."}
        </h3>
        <span className="aw-caption">
          {feedMode ? "t atro/a" : "Anzahl · Bedarf je Einheit"}
        </span>
      </header>
      <div className="aw-zeilen aw-zeilen--scroll">
        {cluster.map((z) => {
          const auf = !!offen[`feed:${z.key}`];
          return (
            <div className="aw-akk" key={z.key}>
              <div className={zeilenKlasse("aw-clusterzeile", clusterFacette, z.key)}>
                <button
                  type="button"
                  className="aw-akk-haupt"
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
                {z.unter.length > 0 && caretKnopf(`feed:${z.key}`, auf)}
              </div>
              {auf &&
                z.unter.map((u) => (
                  <button
                    type="button"
                    key={u.key || u.label}
                    className={
                      u.key
                        ? zeilenKlasse("aw-unterzeile", "materialart", u.key)
                        : "aw-unterzeile"
                    }
                    disabled={!u.key}
                    aria-pressed={u.key ? istAktiv("materialart", u.key) : undefined}
                    onClick={u.key ? () => toggle("materialart", u.key) : undefined}
                  >
                    <span className="lbl">{u.label}</span>
                    <span className="aw-balken aw-balken--fein">
                      <span
                        className="aw-balken-fill"
                        style={{ width: `${u.pct}%`, background: z.farbe }}
                      />
                    </span>
                    <span className="aw-caption">{u.meta}</span>
                    <span className="aw-zeilenwert aw-zeilenwert--sm">{u.wertText}</span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );

  /** Bandbreiten-Modul (Feedstock): eine Korridor-Zeile je Cluster, aufklappbar je Materialart. */
  const spannenModul = (
    modulKey: string,
    titel: string,
    caption: string,
    zeilen: SpannenZeile[],
  ) => (
    <section className="aw-modul aw-modul--b2">
      <header className="aw-kopf">
        <h3 className="aw-kicker">{titel}</h3>
        <span className="aw-caption">{caption}</span>
      </header>
      <div className="aw-zeilen aw-zeilen--scroll">
        {zeilen.map((z) => {
          const auf = !!offen[`${modulKey}:${z.key}`];
          return (
            <div className="aw-akk" key={z.key}>
              <div className={zeilenKlasse("aw-spannzeile", "cluster", z.key)}>
                <button
                  type="button"
                  className="aw-akk-haupt aw-akk-haupt--spalte"
                  aria-pressed={istAktiv("cluster", z.key)}
                  onClick={() => toggle("cluster", z.key)}
                >
                  <span className="aw-spannzeile-kopf">
                    <img className="aw-orb16" src={z.orb} alt="" aria-hidden />
                    <span className="lbl">{z.label}</span>
                    <span className="aw-zeilenwert">
                      {z.leer ? "–" : `ø ${z.mittelText}`}
                    </span>
                  </span>
                  {z.leer ? (
                    <span className="aw-caption">keine Preise im Cluster</span>
                  ) : (
                    spannBand(z, z.farbe)
                  )}
                </button>
                {z.unter.length > 0 && caretKnopf(`${modulKey}:${z.key}`, auf)}
              </div>
              {auf &&
                z.unter.map((u) => (
                  <button
                    type="button"
                    key={u.key || u.label}
                    className={`${
                      u.key
                        ? zeilenKlasse("aw-unterzeile", "materialart", u.key)
                        : "aw-unterzeile"
                    } aw-unterzeile--spann`}
                    disabled={!u.key}
                    aria-pressed={u.key ? istAktiv("materialart", u.key) : undefined}
                    onClick={u.key ? () => toggle("materialart", u.key) : undefined}
                  >
                    <span className="aw-spannzeile-kopf">
                      <span className="lbl">{u.label}</span>
                      <span className="aw-zeilenwert aw-zeilenwert--sm">
                        {u.leer ? "–" : `ø ${u.mittelText}`}
                      </span>
                    </span>
                    {u.leer ? (
                      <span className="aw-caption">keine Preise</span>
                    ) : (
                      spannBand(u, z.farbe)
                    )}
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );

  const qualitaetModul = (
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
            <span className="aw-zeilenwert">
              {q.anzahl}
              <span className="aw-caption"> · {q.pct} %</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  const statusModul = (
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
  );

  const saisonModul = (klasse: string) => (
    <section className={klasse}>
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
    </section>
  );

  const belegtypenModul = (
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
  );

  const jahreModul = (
    <section className="aw-modul aw-modul--w2">
      <header className="aw-kopf">
        <h3 className="aw-kicker">
          {feedMode ? "verfügbarer feedstock je jahr." : "aktive belege je jahr."}
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
  );

  const preisModul = (
    <section className="aw-modul aw-modul--w2">
      <h3 className="aw-kicker">preise · outputs.</h3>
      <div className="aw-preise">
        {preis.map((ps) => (
          <p className="aw-kpi-wert aw-kpi-wert--klein" key={ps.label}>
            <strong>{ps.wert}</strong>
            <span>{ps.einheit}</span>
            <em className="aw-caption">{ps.label}</em>
          </p>
        ))}
        {preis.length === 0 && (
          <p className="aw-caption">Keine Preise in der Auswahl.</p>
        )}
      </div>
    </section>
  );

  const verifModul = (
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
  );

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
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                // Wie das Toolbar-X: Facetten, Suche und Bereiche leeren,
                // sicht bleibt erhalten.
                const alleLeer: Record<string, null> = { q: null, vonAb: null, erstellt: null };
                for (const f of facetten) alleLeer[f.key] = null;
                setze(alleLeer);
              }}
            >
              Filter zurücksetzen
            </button>
          </EmptyState>
        ) : (
          <>
            {auswahlText && <p className="aw-auswahl aw-caption">{auswahlText}</p>}
            <div className="aw-grid">
              {feedMode ? (
                <>
                  {kpiModule}
                  {clusterModul}
                  {saisonModul("aw-modul aw-modul--w2")}
                  {jahreModul}
                  {spannenModul(
                    "pot",
                    "regionenpotenzial je cluster.",
                    "Preis × Menge, €/a",
                    potenzial,
                  )}
                  {spannenModul("kor", "preiskorridor je cluster.", "€/t", preisKorridore)}
                  {qualitaetModul}
                  {statusModul}
                  {belegtypenModul}
                  {verifModul}
                </>
              ) : (
                <>
                  {kpiModule}
                  {clusterModul}
                  {qualitaetModul}
                  {statusModul}
                  {saisonModul("aw-modul aw-modul--b2")}
                  {belegtypenModul}
                  {jahreModul}
                  {preisModul}
                  {verifModul}
                </>
              )}
            </div>
          </>
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
