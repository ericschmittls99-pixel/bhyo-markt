"use client";

import { useState } from "react";
import type { PreisKorridorEinzel as PreisKorridorEinzelDaten } from "@/lib/preiskorridor-einzel";

import { AuswertungToolbar } from "@/components/auswertung/AuswertungToolbar";
import { JahrRegler } from "@/components/auswertung/JahrRegler";
import type { Sortierung } from "@/lib/auswertung-sortierung";
import { beimWechselZuEinzeljahr, beimWechselZuZeitraum, jahreParam } from "@/lib/jahr-regler";
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
  OutputListen,
  OutputZeile,
  QualitaetsDaten,
  SaisonDaten,
  Sicht,
  SpannenUnterzeile,
  SpannenZeile,
  StatusZeile,
  VerifZeile,
  Zusammensetzung,
  Zeitreihe,
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
  potenzial,
  preisKorridore,
  outMengen,
  outPotenzial,
  outPreise,
  outJahre,
  verif,
  facetten,
  auswahl,
  bereich,
  bereichKeys,
  ruecksetzParams,
  offenInitial,
  zurueckgehalten,
  hinweise,
  sicht,
  zeitmodus,
  agg,
  jahreAuswahl,
  poolAchse,
  sortierung,
  irgendeinFilter,
  detailStrom,
  historie,
  begruendung,
  preisKorridor = null,
}: {
  kpis: KpiKarte[];
  auswahlText: string | null;
  anzahl: number;
  cluster: Zusammensetzung<ClusterZeile> | null;
  qualitaet: QualitaetsDaten;
  status: Zusammensetzung<StatusZeile>;
  saison: SaisonDaten;
  belegtypen: Zusammensetzung<BelegtypZeile>;
  jahre: Zeitreihe | null;
  potenzial: SpannenZeile[];
  preisKorridore: SpannenZeile[];
  outMengen: OutputListen | null;
  outPotenzial: OutputListen | null;
  outPreise: OutputListen | null;
  outJahre: { energie: Zeitreihe; stofflich: Zeitreihe } | null;
  verif: VerifZeile[];
  facetten: FacettenChipDef[];
  auswahl: Record<string, string[]>;
  bereich: Record<string, string>;
  bereichKeys: readonly string[];
  ruecksetzParams: readonly string[];
  offenInitial: boolean;
  zurueckgehalten: string[];
  /** F5 PR B: nicht beruecksichtigte Stroeme, fertige Saetze (LeistenHinweise). */
  hinweise: string[];
  sicht: Sicht;
  /** Zeitbezug (AP1j PR 4): Fenster-Zustand aus der URL. */
  zeitmodus: "einzeljahr" | "zeitraum";
  agg: "oe" | "summe";
  jahreAuswahl: number[];
  poolAchse: number[];
  /** E39: Sortierung der Akkordeon-Eintraege. */
  sortierung: Sortierung;
  irgendeinFilter: boolean;
  detailStrom: Strom | null;
  historie: { zeitpunkt: string; text: string }[];
  begruendung: string | null;
  /** E38 */
  preisKorridor?: PreisKorridorEinzelDaten | null;
}) {
  const { setze } = useUrlZustand();
  const feedMode = sicht === "feedstock";
  const leer = anzahl === 0;
  // Akkordeon-Zustand je Modul+Cluster (rein clientseitig, nicht in der URL).
  const [offen, setOffen] = useState<Record<string, boolean>>({});
  const flip = (k: string) => setOffen((o) => ({ ...o, [k]: !o[k] }));
  // Outputs (E13): Saisonalitaet und Jahres-Bedarfe schalten zwischen
  // Energie (Targets, MWh) und Stofflichem (CO2 & Asche, t).
  const [saisonStofflich, setSaisonStofflich] = useState(false);
  const [jahreStofflich, setJahreStofflich] = useState(false);
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
  const caretKnopf = (k: string, auf: boolean, begriff = "Materialarten") => (
    <button
      type="button"
      className="aw-akk-caret"
      aria-expanded={auf}
      aria-label={auf ? `${begriff} verbergen` : `${begriff} anzeigen`}
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

  /** Energie/Stofflich-Umschalter der Output-Module. */
  const miniSwitch = (stofflich: boolean, setze: (v: boolean) => void) => (
    <span className="aw-mini-switch">
      <button
        type="button"
        className={stofflich ? "" : "aktiv"}
        aria-pressed={!stofflich}
        onClick={() => setze(false)}
      >
        energie
      </button>
      <button
        type="button"
        className={stofflich ? "aktiv" : ""}
        aria-pressed={stofflich}
        onClick={() => setze(true)}
      >
        CO₂ &amp; Asche
      </button>
    </span>
  );

  /** Output-Zeilen mit Balken und Produkt-Akkordeon (Mengen/Potenzial/Preise). */
  const outputZeilenListe = (zeilen: OutputZeile[], modulKey: string) =>
    zeilen.map((z) => {
      const auf = !!offen[`${modulKey}:${z.key}`];
      return (
        <div className="aw-akk" key={z.key}>
          {/* Fall C (keine Menge im Bezugsjahr): Zeile gedimmt, Hinweis als Popover. */}
          <div className={`${zeilenKlasse("aw-clusterzeile", z.facette, z.key)}${z.stumm ? " stumm" : ""}`}>
            <button
              type="button"
              className="aw-akk-haupt aw-akk-haupt--spalte"
              aria-pressed={istAktiv(z.facette, z.key)}
              onClick={() => toggle(z.facette, z.key)}
              title={z.hinweis ?? undefined}
            >
              <span className="aw-spannzeile-kopf">
                <img className="aw-orb32" src={z.orb} alt="" aria-hidden />
                <span className="lbl">{z.label}</span>
                <span className="aw-caption">{z.hinweis && z.stumm ? z.hinweis : z.meta}</span>
                <span className="aw-zeilenwert">
                  {z.wertText}
                  {z.zusatz ? ` ${z.zusatz}` : ""}
                </span>
              </span>
              <span className="aw-balken">
                <span
                  className="aw-balken-fill"
                  style={{ width: `${z.pct}%`, background: z.farbe }}
                />
              </span>
            </button>
            {z.unter.length > 0 && caretKnopf(`${modulKey}:${z.key}`, auf, "Produkte")}
          </div>
          {auf &&
            z.unter.map((u) => (
              <button
                type="button"
                key={u.key || u.label}
                className={`${
                  u.key
                    ? zeilenKlasse("aw-unterzeile", "produkt", u.key)
                    : "aw-unterzeile"
                }${u.stumm ? " stumm" : ""}`}
                disabled={!u.key}
                aria-pressed={u.key ? istAktiv("produkt", u.key) : undefined}
                onClick={u.key ? () => toggle("produkt", u.key) : undefined}
                title={u.hinweis ?? undefined}
              >
                <span className="aw-spannzeile-kopf">
                  <span className="lbl">{u.label}</span>
                  <span className="aw-caption">{u.hinweis && u.stumm ? u.hinweis : u.meta}</span>
                  <span className="aw-zeilenwert aw-zeilenwert--sm">
                    {u.wertText}
                    {u.zusatz ? ` ${u.zusatz}` : ""}
                  </span>
                </span>
                <span className="aw-balken aw-balken--fein">
                  <span
                    className="aw-balken-fill"
                    style={{ width: `${u.pct}%`, background: z.farbe }}
                  />
                </span>
              </button>
            ))}
        </div>
      );
    });

  /** Zweigeteiltes Output-Modul (energetisch / stofflich) mit Sektions-Captions. */
  const outputListenModul = (
    modulKey: string,
    titel: string,
    listen: OutputListen,
    captionEnergetisch: string,
    captionStofflich: string,
  ) => (
    <section className="aw-modul aw-modul--b2">
      <h3 className="aw-kicker">{titel}</h3>
      <div className="aw-zeilen aw-zeilen--scroll">
        {listen.energetisch.length > 0 && (
          <p className="aw-caption aw-sektion">{captionEnergetisch}</p>
        )}
        {outputZeilenListe(listen.energetisch, modulKey)}
        {listen.stofflich.length > 0 && (
          <p className="aw-caption aw-sektion">{captionStofflich}</p>
        )}
        {outputZeilenListe(listen.stofflich, modulKey)}
      </div>
    </section>
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
        {/* E26: Bezugsgroesse sichtbar — ein voller Balken ist 100 %. */}
        <span className="aw-caption">{cluster?.basisText}</span>
      </header>
      <div className="aw-zeilen aw-zeilen--scroll">
        {(cluster?.zeilen ?? []).map((z) => {
          const auf = !!offen[`feed:${z.key}`];
          return (
            <div className="aw-akk" key={z.key}>
              <div
                className={`${zeilenKlasse("aw-clusterzeile", clusterFacette, z.key)}${z.null0 ? " stumm" : ""}`}
              >
                <button
                  type="button"
                  className="aw-akk-haupt aw-akk-haupt--spalte"
                  aria-pressed={istAktiv(clusterFacette, z.key)}
                  onClick={() => toggle(clusterFacette, z.key)}
                >
                  <span className="aw-spannzeile-kopf">
                    <img className="aw-orb32" src={z.orb} alt="" aria-hidden />
                    <span className="lbl">{z.label}</span>
                    <span className="aw-caption">{z.meta}</span>
                    <span className="aw-zeilenwert">{z.wertText}</span>
                  </span>
                  <span className="aw-balken">
                    <span
                      className="aw-balken-fill"
                      style={{ width: `${z.pct}%`, background: z.farbe }}
                    />
                  </span>
                </button>
                {z.unter.length > 0 && caretKnopf(`feed:${z.key}`, auf)}
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
                    }${u.null0 ? " stumm" : ""}`}
                    disabled={!u.key}
                    aria-pressed={u.key ? istAktiv("materialart", u.key) : undefined}
                    onClick={u.key ? () => toggle("materialart", u.key) : undefined}
                  >
                    <span className="aw-spannzeile-kopf">
                      <span className="lbl">{u.label}</span>
                      <span className="aw-caption">{u.meta}</span>
                      <span className="aw-zeilenwert aw-zeilenwert--sm">{u.wertText}</span>
                    </span>
                    <span className="aw-balken aw-balken--fein">
                      <span
                        className="aw-balken-fill"
                        style={{ width: `${u.pct}%`, background: z.farbe }}
                      />
                    </span>
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
              {/* Fall C (keine Menge im Bezugsjahr): Zeile gedimmt, Hinweis statt Spanne. */}
              <div
                className={`${zeilenKlasse("aw-spannzeile", "cluster", z.key)}${z.leer && z.hinweis ? " stumm" : ""}`}
              >
                <button
                  type="button"
                  className="aw-akk-haupt aw-akk-haupt--spalte"
                  aria-pressed={istAktiv("cluster", z.key)}
                  onClick={() => toggle("cluster", z.key)}
                  title={z.hinweis ?? undefined}
                >
                  <span className="aw-spannzeile-kopf">
                    <img className="aw-orb16" src={z.orb} alt="" aria-hidden />
                    <span className="lbl">{z.label}</span>
                    <span className="aw-zeilenwert">
                      {z.leer ? "–" : `ø ${z.mittelText}${z.zusatz ? ` ${z.zusatz}` : ""}`}
                    </span>
                  </span>
                  {z.leer ? (
                    <span className="aw-caption">{z.hinweis ?? "keine Preise im Cluster"}</span>
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
                        : "aw-unterzeile"}${u.leer && u.hinweis ? " stumm" : ""}`}
                    disabled={!u.key}
                    aria-pressed={u.key ? istAktiv("materialart", u.key) : undefined}
                    onClick={u.key ? () => toggle("materialart", u.key) : undefined}
                    title={u.hinweis ?? undefined}
                  >
                    <span className="aw-spannzeile-kopf">
                      <span className="lbl">{u.label}</span>
                      <span className="aw-zeilenwert aw-zeilenwert--sm">
                        {u.leer ? "–" : `ø ${u.mittelText}${u.zusatz ? ` ${u.zusatz}` : ""}`}
                      </span>
                    </span>
                    {u.leer ? (
                      <span className="aw-caption">{u.hinweis ?? "keine Preise"}</span>
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
          {/* Rückmeldung 2 (Eric, 28.09.2026): nur „x % A + B", ohne
              Basiszeile — bewusste Ausnahme von E26 für den Donut. */}
          <span className="aw-caption">A + B</span>
        </div>
      </div>
      <div className="aw-zeilen">
        {qualitaet.zeilen.map((q) => (
          <button
            type="button"
            key={q.stufe}
            className={`${zeilenKlasse("aw-qualzeile", "qualitaet", q.stufe)}${q.null0 ? " stumm" : ""}`}
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
      <header className="aw-kopf">
        <h3 className="aw-kicker">status.</h3>
        {/* E26: jede %-Angabe nennt ihre Basis. */}
        <span className="aw-caption">von {status.basisText}</span>
      </header>
      <div className="aw-zeilen aw-zeilen--status">
        {status.zeilen.map((st) => (
          <button
            type="button"
            key={st.key}
            className={`${zeilenKlasse("aw-statuszeile", "status", st.key)}${st.anzahl === 0 ? " stumm" : ""}`}
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

  const saisonModul = (
    <section className="aw-modul aw-modul--w2">
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
    </section>
  );

  const outSaisonWerte = saisonStofflich ? saison.outStofflich : saison.outEnergie;
  const outSaisonModul = (
    <section className="aw-modul aw-modul--w2">
      <header className="aw-kopf">
        <h3 className="aw-kicker">saisonalität.</h3>
        {miniSwitch(saisonStofflich, setSaisonStofflich)}
      </header>
      {outSaisonWerte ? (
        <div className="aw-saison">
          <span className="aw-caption">
            {saisonStofflich
              ? "bedarf · CO₂ & Asche, gewichtet nach t/a"
              : "bedarf · target-outputs, gewichtet nach kWh"}
          </span>
          <SeasonBarsMini werte={outSaisonWerte} hoehe={64} />
        </div>
      ) : (
        <p className="aw-caption">Keine Belege in der Auswahl.</p>
      )}
    </section>
  );

  const belegtypenModul = (
    <section className="aw-modul aw-modul--w2">
      <header className="aw-kopf">
        <h3 className="aw-kicker">belegtypen.</h3>
        <span className="aw-caption">{belegtypen.basisText}</span>
      </header>
      <div className="aw-belegtypen">
        {belegtypen.zeilen.map((bt) => (
          <button
            type="button"
            key={bt.key}
            className={`${zeilenKlasse("aw-belegzeile", "belegtyp", bt.key)}${bt.null0 ? " stumm" : ""}`}
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
            <span className="aw-zeilenwert">
              {bt.pct}
              <span className="aw-caption"> % · {bt.anzahl}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );

  const jahresBalkenListe = (reihe: Zeitreihe) => (
    <div className="aw-jahre">
      {reihe.balken.map((j) => (
        <div
          className={`aw-jahr${j.vergangen ? " vergangen" : ""}`}
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
          <span className="aw-caption">
            {j.jahr}
          </span>
        </div>
      ))}
    </div>
  );

  const jahreModul = (
    <section className="aw-modul aw-modul--w2">
      <header className="aw-kopf">
        <h3 className="aw-kicker">verfügbarer feedstock je jahr.</h3>
        {/* E26: absolute Zeitreihe — die Skala steht sichtbar in der Kachel. */}
        <span className="aw-caption">{jahre?.skalaText}</span>
      </header>
      {jahre && jahresBalkenListe(jahre)}
    </section>
  );

  const outJahreModul = outJahre && (
    <section className="aw-modul aw-modul--w2">
      <header className="aw-kopf">
        <h3 className="aw-kicker">bedarfe je jahr.</h3>
        {miniSwitch(jahreStofflich, setJahreStofflich)}
      </header>
      <p className="aw-caption">
        {jahreStofflich ? "CO₂ & Asche" : "target-outputs"} ·{" "}
        {/* E26: eine Skala je Einheit — Beschriftung zieht mit dem Umschalter. */}
        {(jahreStofflich ? outJahre.stofflich : outJahre.energie).skalaText}
      </p>
      {jahresBalkenListe(jahreStofflich ? outJahre.stofflich : outJahre.energie)}
    </section>
  );

  const verifModul = (
    <section className="aw-modul aw-modul--w2">
      <h3 className="aw-kicker">nächste verifikation.</h3>
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
            {v.ueberfaellig && <span className="pill-wert">abgelaufen.</span>}
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
        bereichKeys={bereichKeys}
        ruecksetzParams={ruecksetzParams}
        offenInitial={offenInitial}
        zurueckgehalten={zurueckgehalten}
        hinweise={hinweise}
        sicht={sicht}
        irgendeinFilter={irgendeinFilter}
        countText={`${anzahl} ${anzahl === 1 ? "Beleg" : "Belege"}`}
        sortierung={sortierung}
      />

      {/* Zeitbezug (AP1j PR 4, Bedienung E39): Schalter Einzeljahr/Zeitraum in
          der Groesse des Feedstock/Outputs-Schalters, daneben die Uhr mit der
          Auswahl — Klick oeffnet den Jahres-Regler (ersetzt die Jahr-Pillen).
          Die Jahres-Logik (Achse, Rueckfaelle, Fenster) ist unveraendert;
          Wechsel Zeitraum -> Einzeljahr nimmt das Endjahr, zurueck [Jahr, Jahr]. */}
      <div className="aw-zeit" role="group" aria-label="Zeitbezug">
        <div className="seg" role="group" aria-label="Einzeljahr oder Zeitraum">
          <button
            type="button"
            className="seg-opt"
            aria-pressed={zeitmodus === "einzeljahr"}
            onClick={() =>
              setze({
                zeitmodus: null,
                jahre: String(beimWechselZuEinzeljahr(jahreAuswahl)),
                agg: null,
              })
            }
          >
            Einzeljahr
          </button>
          <button
            type="button"
            className="seg-opt"
            aria-pressed={zeitmodus === "zeitraum"}
            onClick={() =>
              setze({
                zeitmodus: "zeitraum",
                jahre: jahreParam(
                  zeitmodus === "einzeljahr"
                    ? beimWechselZuZeitraum(jahreAuswahl[0]!)
                    : jahreAuswahl,
                ),
              })
            }
          >
            Zeitraum
          </button>
        </div>
        <JahrRegler
          zeitmodus={zeitmodus}
          jahre={jahreAuswahl}
          achse={poolAchse}
          onJahre={(param) => setze({ jahre: param })}
        />
        {zeitmodus === "zeitraum" && (
          <span className="aw-mini-switch">
            <button
              type="button"
              className={agg === "oe" ? "aktiv" : ""}
              aria-pressed={agg === "oe"}
              onClick={() => setze({ agg: null })}
            >
              ø pro Jahr
            </button>
            <button
              type="button"
              className={agg === "summe" ? "aktiv" : ""}
              aria-pressed={agg === "summe"}
              onClick={() => setze({ agg: "summe" })}
            >
              Summe im Zeitraum
            </button>
          </span>
        )}
      </div>

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
                  {saisonModul}
                  {jahreModul}
                  {spannenModul(
                    "pot",
                    "feedstock-potenzial je cluster.",
                    "€/a · Min/Max je Position, mengengewichtet",
                    potenzial,
                  )}
                  {spannenModul(
                    "kor",
                    "preiskorridor je cluster.",
                    "€/t · mengengewichtet · − = Annahmeentgelt",
                    preisKorridore,
                  )}
                  {qualitaetModul}
                  {statusModul}
                  {belegtypenModul}
                  {verifModul}
                </>
              ) : (
                <>
                  {kpiModule}
                  {outMengen &&
                    outputListenModul(
                      "menge",
                      "bedarf je gruppe.",
                      outMengen,
                      // E26: je Liste eine eigene Anteilsbasis — MWh und t
                      // teilen sich nie eine Skala.
                      `energetisch · ${outMengen.basisEnergetisch}`,
                      `stofflich · ${outMengen.basisStofflich}`,
                    )}
                  {outSaisonModul}
                  {outJahreModul}
                  {outPotenzial &&
                    outputListenModul(
                      "pot",
                      "erlöspotenzial je gruppe.",
                      outPotenzial,
                      "energetisch · Preis × Menge, €/a",
                      "stofflich · Preis × Menge, €/a",
                    )}
                  {outPreise &&
                    outputListenModul(
                      "preis",
                      "preise je gruppe.",
                      outPreise,
                      "energetisch · €/MWh",
                      "stofflich · €/t",
                    )}
                  {qualitaetModul}
                  {statusModul}
                  {belegtypenModul}
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
          preisKorridor={preisKorridor}
          modal={false}
          canEdit={false}
          stroemeHref={`/register?tab=${detailStrom.art === "biomasse" ? "biomasse" : "output"}&detail=${detailStrom.id}`}
        />
      )}
    </div>
  );
}
