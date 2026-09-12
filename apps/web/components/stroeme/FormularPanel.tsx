"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AkteurCombobox } from "@/components/AkteurCombobox";
import { ConversionChain } from "@/components/stroeme/ConversionChain";
import { SeasonBarsEdit } from "@/components/stroeme/SeasonBarsEdit";
import { SuchCombobox } from "@/components/stroeme/SuchCombobox";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { CLUSTER_LABEL, OUTPUT_LABEL } from "@/lib/farben";
import { fmtDatum, fmtZahl } from "@/lib/format";
import {
  clusterVonMaterialart,
  gruppeVonProdukt,
  materialartenImCluster,
  MENGE_EINHEITEN,
  PREIS_EINHEITEN,
  produkteInGruppe,
  type FormularWerte,
} from "@/lib/formular-modell";
import { stromSpeichern, type SpeichernErgebnis } from "@/lib/formular-actions";
import { deriveQualitaet, type BelegTyp } from "@/lib/qualitaet";
import type { MaterialartMitCluster, OutputProduktOption } from "@/lib/register";
import { BELEG_LABEL, KATEGORIE_LABEL, type StromArt } from "@/lib/stroeme-modell";
import { naechsteVerifizierung } from "@/lib/verifizierung";

const BELEG_TYPEN: BelegTyp[] = [
  "dokument_link",
  "gespraech",
  "angebot",
  "absichtserklaerung",
  "vertrag",
  "betriebsdaten",
];

/**
 * Formular-Panel von stroeme. (AP1i PR 5): Anlegen und Bearbeiten als
 * Slide-in-Panel ueber der Liste, gleicher Container wie das Detail. Inline-
 * Fehler kommen aus der Server-Action (erst nach Speichern-Versuch, wie im
 * Mockup); Qualitaet ist eine live abgeleitete, gesperrte Anzeige.
 */
export function FormularPanel({
  art,
  werte,
  materialarten,
  produkte,
  landkreise,
  zurueckHref,
}: {
  art: StromArt;
  werte: FormularWerte | null;
  materialarten: MaterialartMitCluster[];
  produkte: OutputProduktOption[];
  landkreise: string[];
  zurueckHref?: string;
}) {
  const feed = art === "biomasse";
  const neu = werte == null;
  const router = useRouter();
  const { setze } = useUrlZustand();
  const [state, formAction, pending] = useActionState<SpeichernErgebnis, FormData>(
    stromSpeichern.bind(null, art, werte?.id ?? null),
    {},
  );

  // Gekoppelte Auswahl (Cluster ↔ Materialart bzw. Gruppe ↔ Output).
  const [cluster, setCluster] = useState(werte?.cluster ?? "");
  const [materialartCode, setMaterialartCode] = useState(werte?.materialartCode ?? "");
  const [gruppe, setGruppe] = useState(
    werte?.produktCode ? gruppeVonProdukt(produkte, werte.produktCode) : "",
  );
  const [produktCode, setProduktCode] = useState(werte?.produktCode ?? "");
  const [landkreis, setLandkreis] = useState(werte?.landkreis ?? "");

  // Mengen fuer die Live-Umrechnungskette (nur Biomasse).
  const [roh, setRoh] = useState(werte?.mengeRohFm ?? "");
  const [ts, setTs] = useState(werte?.tsAnteilPct ?? "");
  const [asche, setAsche] = useState(werte?.aschegehaltPct ?? "");
  const [mengeEinheit, setMengeEinheit] = useState(werte?.mengeEinheit ?? "t/a");

  // Saisonalitaet (E10) + Beleg-Zustand fuer die Qualitaets-Ableitung.
  const [saison, setSaison] = useState<number[]>(
    () => werte?.saisonalitaet ?? Array(12).fill(0),
  );
  const b = werte?.beleg ?? null;
  const [typ, setTyp] = useState<BelegTyp | "">((b?.typ as BelegTyp) ?? "");
  const [quellenangabe, setQuellenangabe] = useState(b?.quellenangabe ?? "");
  const [erhebungsdatum, setErhebungsdatum] = useState(b?.erhebungsdatum ?? "");
  const [link, setLink] = useState(b?.linkUrl ?? "");
  const [gueltigBis, setGueltigBis] = useState(b?.gueltigBis ?? "");
  const [gespraechsdatum, setGespraechsdatum] = useState(b?.gespraechsdatum ?? "");
  const [gespraechspartner, setGespraechspartner] = useState(b?.gespraechspartner ?? "");
  const [extern, setExtern] = useState(b?.extern ?? false);
  const [amtlich, setAmtlich] = useState(b?.amtlich ?? false);
  const [dateiName, setDateiName] = useState("");
  const dateiRef = useRef<HTMLInputElement>(null);
  const bestehendeDatei = !neu && !!b?.dateiKey;

  const geschlossen = useRef(false);
  function schliessen() {
    if (geschlossen.current) return;
    geschlossen.current = true;
    if (zurueckHref) router.push(zurueckHref);
    else setze({ form: null }, "push");
  }

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") schliessen();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Erfolg: Toast der Seite ueberlassen waere Server-Sache — das Panel zeigt
  // ihn selbst kurz und schliesst dann (Mockup: "Strom angelegt – Status Entwurf").
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!state.ok) return;
    setToast(neu ? "Strom angelegt – Status Entwurf" : "Änderungen gespeichert");
    const t = setTimeout(() => {
      schliessen();
      router.refresh();
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  const f = state.feldFehler ?? {};

  const atro =
    roh && ts && asche
      ? Number(roh) * (Number(ts) / 100) * (1 - Number(asche) / 100)
      : null;
  const chain = [
    { label: "Rohmenge", wert: roh ? fmtZahl(Number(roh)) : "–", einheit: "t FM/a", quelle: "erfasst" },
    { label: "Trockensubstanz", wert: ts ? fmtZahl(Number(ts)) : "–", einheit: "%", quelle: "TS-Anteil" },
    { label: "Aschegehalt", wert: asche ? fmtZahl(Number(asche)) : "–", einheit: "%", quelle: "Anteil an TS" },
    {
      label: "Ergebnis",
      wert: atro != null && Number.isFinite(atro) ? fmtZahl(atro) : "–",
      einheit: "t atro/a",
      quelle: "Rohmenge × TS × (1 − Asche)",
      ergebnis: true,
    },
  ];

  const qualitaet = typ
    ? deriveQualitaet({
        typ,
        externNachvollziehbar: extern,
        erhebungsdatum: erhebungsdatum || null,
        dateiKey: dateiName || bestehendeDatei ? "x" : null,
        linkUrl: link || null,
        gueltigBis: typ === "angebot" ? gueltigBis || null : null,
        metadata: { amtlich, quellenangabe, gespraechsdatum, gespraechspartner },
      })
    : null;
  const verifizierung = typ
    ? naechsteVerifizierung({
        typ,
        gueltigBis: typ === "angebot" ? gueltigBis || null : null,
        erhebungsdatum: erhebungsdatum || null,
      })
    : null;

  const clusterOptionen = useMemo(() => {
    const vorhanden = [...new Set(materialarten.map((m) => m.cluster))];
    return vorhanden
      .map((c) => ({ wert: c, label: CLUSTER_LABEL[c] ?? c }))
      .sort((a, x) => a.label.localeCompare(x.label, "de"));
  }, [materialarten]);
  const gruppenOptionen = useMemo(() => {
    const vorhanden = [...new Set(produkte.map((p) => p.gruppe))];
    return vorhanden.map((g) => ({ wert: g, label: OUTPUT_LABEL[g] ?? g }));
  }, [produkte]);
  const produktGewaehlt = produkte.find((p) => p.code === produktCode);

  const mengeEinheiten = MENGE_EINHEITEN.includes(
    mengeEinheit as (typeof MENGE_EINHEITEN)[number],
  )
    ? [...MENGE_EINHEITEN]
    : [mengeEinheit, ...MENGE_EINHEITEN];

  const titel = neu
    ? feed
      ? "feedstock anlegen."
      : "output anlegen."
    : "strom bearbeiten.";
  const untertitel = feed
    ? "Ein Strom je Quelle × Materialart × Zeitraum."
    : "Ein Bedarf je Abnehmer × Output × Zeitraum.";

  return (
    <div className="ov ov--panel">
      <section role="dialog" aria-label={titel} className="ov-flaeche">
        <div className="ov-kopf">
          <div className="ov-kopf-text">
            <h2>{titel}</h2>
            <p>{untertitel}</p>
          </div>
          <div className="ov-kopf-aktionen">
            <button
              type="button"
              className="icon-btn"
              aria-label="Schließen"
              onClick={schliessen}
            >
              <i className="ph ph-x" aria-hidden />
            </button>
          </div>
        </div>

        <form action={formAction} className="ov-body fp">
          <section className="ov-sec">
            <h3>quelle.</h3>
            <AkteurCombobox
              name="akteur_id"
              fehler={f.akteur_id}
              initial={
                werte?.akteurId
                  ? {
                      id: werte.akteurId,
                      name: werte.akteurName,
                      sektor: werte.akteurSektor,
                    }
                  : null
              }
            />
            <label className="pf">
              <span>Bezeichnung</span>
              <span className="pf-feld">
                <input
                  type="text"
                  name="bezeichnung"
                  defaultValue={werte?.bezeichnung ?? ""}
                  placeholder={
                    feed
                      ? "z. B. Rindergülle Milchviehbetrieb"
                      : "z. B. Fernwärmenetz Speyer-Nord"
                  }
                />
              </span>
            </label>
            <div className="fp-zeile">
              <label className="pf">
                <span>Ort</span>
                <span className="pf-feld">
                  <input type="text" name="ort" defaultValue={werte?.ort ?? ""} />
                </span>
              </label>
              <SuchCombobox
                label="Landkreis"
                name="landkreis"
                wert={landkreis}
                onWert={setLandkreis}
                optionen={landkreise.map((l) => ({ wert: l, label: l }))}
                placeholder="Landkreis wählen"
                freitext
              />
            </div>
            <label className="pf">
              <span>
                Kontaktperson <em className="fp-optional">optional</em>
              </span>
              <span className="pf-feld">
                <input
                  type="text"
                  name="kontaktperson"
                  defaultValue={werte?.kontaktperson ?? ""}
                />
              </span>
            </label>
            <div className="hinweis-box">
              <i className="ph ph-map-pin" aria-hidden />
              <span>
                Karten-Pin setzen folgt – ohne Pin erscheint der Strom nicht auf
                der Karte.
              </span>
            </div>
          </section>

          <section className="ov-sec">
            <h3>{feed ? "materialart & zeitraum." : "output & zeitraum."}</h3>
            <div className="fp-zeile">
              {feed ? (
                <>
                  <SuchCombobox
                    label="Cluster"
                    name="cluster_anzeige"
                    wert={cluster}
                    onWert={(c) => {
                      setCluster(c);
                      if (
                        materialartCode &&
                        clusterVonMaterialart(materialarten, materialartCode) !== c
                      )
                        setMaterialartCode("");
                    }}
                    optionen={clusterOptionen}
                    placeholder="Cluster wählen"
                  />
                  <SuchCombobox
                    label="Materialart"
                    name="materialart_code"
                    pflicht
                    wert={materialartCode}
                    onWert={(code) => {
                      setMaterialartCode(code);
                      const c = clusterVonMaterialart(materialarten, code);
                      if (c) setCluster(c);
                    }}
                    optionen={materialartenImCluster(materialarten, cluster).map(
                      (m) => ({ wert: m.code, label: m.label }),
                    )}
                    placeholder="Materialart wählen"
                    fehler={f.materialart_code}
                  />
                </>
              ) : (
                <>
                  <SuchCombobox
                    label="Output-Gruppe"
                    name="gruppe_anzeige"
                    wert={gruppe}
                    onWert={(g) => {
                      setGruppe(g);
                      if (
                        produktCode &&
                        gruppeVonProdukt(produkte, produktCode) !== g
                      )
                        setProduktCode("");
                    }}
                    optionen={gruppenOptionen}
                    placeholder="Gruppe wählen"
                  />
                  <SuchCombobox
                    label="Output"
                    name="produkt_code"
                    pflicht
                    wert={produktCode}
                    onWert={(code) => {
                      setProduktCode(code);
                      const g = gruppeVonProdukt(produkte, code);
                      if (g) setGruppe(g);
                    }}
                    optionen={produkteInGruppe(produkte, gruppe).map((p) => ({
                      wert: p.code,
                      label: p.label,
                    }))}
                    placeholder="Output wählen"
                    fehler={f.produkt_code}
                  />
                </>
              )}
            </div>
            {!feed && produktGewaehlt && (
              <p className="fp-hinweis">
                Kategorie: {KATEGORIE_LABEL[produktGewaehlt.kategorie] ?? produktGewaehlt.kategorie}
              </p>
            )}
            <div className="fp-zeile">
              <label className="pf">
                <span>
                  Verfügbar ab<em className="pf-pflicht" aria-hidden> *</em>
                </span>
                <span className="pf-feld">
                  <input
                    type="month"
                    name="zeitraum_von"
                    defaultValue={werte?.vonMonat ?? ""}
                    aria-invalid={f.zeitraum_von ? true : undefined}
                  />
                </span>
                {f.zeitraum_von && <span className="pf-fehler">{f.zeitraum_von}</span>}
              </label>
              <label className="pf">
                <span>
                  Verfügbar bis<em className="pf-pflicht" aria-hidden> *</em>
                </span>
                <span className="pf-feld">
                  <input
                    type="month"
                    name="zeitraum_bis"
                    defaultValue={werte?.bisMonat ?? ""}
                    aria-invalid={f.zeitraum_bis ? true : undefined}
                  />
                </span>
                {f.zeitraum_bis && <span className="pf-fehler">{f.zeitraum_bis}</span>}
              </label>
            </div>
          </section>

          <section className="ov-sec">
            <h3>{feed ? "mengen." : "bedarfsmenge."}</h3>
            {feed ? (
              <>
                <div className="fp-zeile fp-zeile--3">
                  <label className="pf">
                    <span>
                      Rohmenge<em className="pf-pflicht" aria-hidden> *</em>
                    </span>
                    <span className="pf-feld">
                      <input
                        type="number"
                        name="menge_roh_fm"
                        step="0.01"
                        min="0"
                        value={roh}
                        onChange={(e) => setRoh(e.target.value)}
                        aria-invalid={f.menge_roh_fm ? true : undefined}
                      />
                      <em>t FM/a</em>
                    </span>
                    {f.menge_roh_fm && <span className="pf-fehler">{f.menge_roh_fm}</span>}
                  </label>
                  <label className="pf">
                    <span>
                      TS-Anteil<em className="pf-pflicht" aria-hidden> *</em>
                    </span>
                    <span className="pf-feld">
                      <input
                        type="number"
                        name="ts_anteil_pct"
                        step="0.1"
                        min="0"
                        max="100"
                        value={ts}
                        onChange={(e) => setTs(e.target.value)}
                        aria-invalid={f.ts_anteil_pct ? true : undefined}
                      />
                      <em>%</em>
                    </span>
                    {f.ts_anteil_pct && <span className="pf-fehler">{f.ts_anteil_pct}</span>}
                  </label>
                  <label className="pf">
                    <span>
                      Aschegehalt<em className="pf-pflicht" aria-hidden> *</em>
                    </span>
                    <span className="pf-feld">
                      <input
                        type="number"
                        name="aschegehalt_pct"
                        step="0.1"
                        min="0"
                        max="100"
                        value={asche}
                        onChange={(e) => setAsche(e.target.value)}
                        aria-invalid={f.aschegehalt_pct ? true : undefined}
                      />
                      <em>%</em>
                    </span>
                    {f.aschegehalt_pct && (
                      <span className="pf-fehler">{f.aschegehalt_pct}</span>
                    )}
                  </label>
                </div>
                <ConversionChain schritte={chain} />
              </>
            ) : (
              <div className="fp-zeile">
                <label className="pf">
                  <span>
                    Bedarfsmenge<em className="pf-pflicht" aria-hidden> *</em>
                  </span>
                  <span className="pf-feld">
                    <input
                      type="number"
                      name="menge_wert"
                      step="0.01"
                      min="0"
                      defaultValue={werte?.mengeWert ?? ""}
                      aria-invalid={f.menge_wert ? true : undefined}
                    />
                  </span>
                  {f.menge_wert && <span className="pf-fehler">{f.menge_wert}</span>}
                </label>
                <label className="pf">
                  <span>Einheit</span>
                  <span className="pf-feld">
                    <select
                      name="menge_einheit"
                      value={mengeEinheit}
                      onChange={(e) => setMengeEinheit(e.target.value)}
                    >
                      {mengeEinheiten.map((e) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                    <i className="ph-bold ph-caret-down scb-caret" aria-hidden />
                  </span>
                </label>
              </div>
            )}
          </section>

          <section className="ov-sec">
            <h3>saisonalität.</h3>
            <SeasonBarsEdit werte={saison} onWerte={setSaison} />
            {saison.map((v, i) => (
              <input key={i} type="hidden" name={`saison_${i}`} value={v} />
            ))}
            <p className="ov-note">Verteilung je Monat in % der Jahresmenge.</p>
          </section>

          <section className="ov-sec">
            <h3>preis.</h3>
            {feed ? (
              <div className="fp-zeile fp-zeile--3">
                <label className="pf">
                  <span>Min</span>
                  <span className="pf-feld">
                    <input
                      type="number"
                      name="preis_min"
                      step="0.01"
                      defaultValue={werte?.preisMin ?? ""}
                    />
                    <em>€/t</em>
                  </span>
                  {f.preis_min && <span className="pf-fehler">{f.preis_min}</span>}
                </label>
                <label className="pf">
                  <span>Mittel</span>
                  <span className="pf-feld">
                    <input
                      type="number"
                      name="preis_mittel"
                      step="0.01"
                      defaultValue={werte?.preisMittel ?? ""}
                    />
                    <em>€/t</em>
                  </span>
                  {f.preis_mittel && <span className="pf-fehler">{f.preis_mittel}</span>}
                </label>
                <label className="pf">
                  <span>Max</span>
                  <span className="pf-feld">
                    <input
                      type="number"
                      name="preis_max"
                      step="0.01"
                      defaultValue={werte?.preisMax ?? ""}
                    />
                    <em>€/t</em>
                  </span>
                  {f.preis_max && <span className="pf-fehler">{f.preis_max}</span>}
                </label>
              </div>
            ) : (
              <div className="fp-zeile">
                <label className="pf">
                  <span>Preis</span>
                  <span className="pf-feld">
                    <input
                      type="number"
                      name="preis"
                      step="0.01"
                      defaultValue={werte?.preis ?? ""}
                      aria-invalid={f.preis ? true : undefined}
                    />
                  </span>
                  {f.preis && <span className="pf-fehler">{f.preis}</span>}
                </label>
                <label className="pf">
                  <span>Preis-Einheit</span>
                  <span className="pf-feld">
                    <select
                      name="preis_einheit"
                      defaultValue={werte?.preisEinheit ?? ""}
                    >
                      <option value="">—</option>
                      {PREIS_EINHEITEN.map((e) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                      {werte?.preisEinheit &&
                        !PREIS_EINHEITEN.includes(
                          werte.preisEinheit as (typeof PREIS_EINHEITEN)[number],
                        ) && (
                          <option value={werte.preisEinheit}>
                            {werte.preisEinheit}
                          </option>
                        )}
                    </select>
                    <i className="ph-bold ph-caret-down scb-caret" aria-hidden />
                  </span>
                </label>
              </div>
            )}
            <label className="pf">
              <span>Herkunft</span>
              <span className="pf-feld">
                <select name="preis_herkunft" defaultValue={werte?.preisHerkunft ?? ""}>
                  <option value="">—</option>
                  <option value="eigene_datenbank">eigene Datenbank</option>
                  <option value="marktdaten">Marktdaten</option>
                  <option value="schaetzung">Schätzung</option>
                </select>
                <i className="ph-bold ph-caret-down scb-caret" aria-hidden />
              </span>
            </label>
            <p className="fp-hinweis">Eigener Wert setzt die Herkunft auf Schätzung.</p>
          </section>

          <section className="ov-sec">
            <h3>beleg.</h3>
            <input type="hidden" name="beleg_typ" value={typ} />
            <div className="fp-chips" role="radiogroup" aria-label="Belegtyp">
              {BELEG_TYPEN.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={typ === t}
                  className={`fchip${typ === t ? " aktiv" : ""}`}
                  onClick={() => setTyp(typ === t ? "" : t)}
                >
                  {BELEG_LABEL[t] ?? t}
                </button>
              ))}
            </div>

            {typ && (
              <>
                <label className="pf">
                  <span>
                    Quellenangabe<em className="pf-pflicht" aria-hidden> *</em>
                  </span>
                  <span className="pf-feld">
                    <input
                      type="text"
                      name="beleg_quellenangabe"
                      value={quellenangabe}
                      onChange={(e) => setQuellenangabe(e.target.value)}
                      placeholder="z. B. Liefervertrag 2024, S. 3"
                      aria-invalid={f.beleg_quellenangabe ? true : undefined}
                    />
                  </span>
                  {f.beleg_quellenangabe && (
                    <span className="pf-fehler">{f.beleg_quellenangabe}</span>
                  )}
                </label>
                <div className="fp-zeile">
                  <div className="pf">
                    <span>Datei oder Link</span>
                    <span className="fp-datei">
                      <input
                        ref={dateiRef}
                        type="file"
                        name="beleg_datei"
                        className="fp-datei-input"
                        onChange={(e) =>
                          setDateiName(e.target.files?.[0]?.name ?? "")
                        }
                      />
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => dateiRef.current?.click()}
                      >
                        <i className="ph ph-paperclip" aria-hidden />
                        Datei wählen
                      </button>
                      <span className="fp-datei-name">
                        {dateiName ||
                          (bestehendeDatei
                            ? "Bestehende Datei bleibt erhalten"
                            : "")}
                      </span>
                    </span>
                    {bestehendeDatei && !dateiName && (
                      <input type="hidden" name="beleg_datei_vorhanden" value="1" />
                    )}
                    {f.beleg_datei && (
                      <span className="pf-fehler">{f.beleg_datei}</span>
                    )}
                  </div>
                  <label className="pf">
                    <span>Link</span>
                    <span className="pf-feld">
                      <input
                        type="url"
                        name="beleg_link"
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                        placeholder="https://…"
                      />
                    </span>
                  </label>
                </div>
                <div className="fp-zeile">
                  <label className="pf">
                    <span>
                      Erhebungsdatum<em className="pf-pflicht" aria-hidden> *</em>
                    </span>
                    <span className="pf-feld">
                      <input
                        type="date"
                        name="beleg_erhebungsdatum"
                        value={erhebungsdatum}
                        onChange={(e) => setErhebungsdatum(e.target.value)}
                        aria-invalid={f.beleg_erhebungsdatum ? true : undefined}
                      />
                    </span>
                    {f.beleg_erhebungsdatum && (
                      <span className="pf-fehler">{f.beleg_erhebungsdatum}</span>
                    )}
                  </label>
                  {typ === "angebot" && (
                    <label className="pf">
                      <span>Angebot gültig bis</span>
                      <span className="pf-feld">
                        <input
                          type="date"
                          name="beleg_gueltig_bis"
                          value={gueltigBis}
                          onChange={(e) => setGueltigBis(e.target.value)}
                        />
                      </span>
                    </label>
                  )}
                  {typ === "gespraech" && (
                    <label className="pf">
                      <span>Gesprächsdatum</span>
                      <span className="pf-feld">
                        <input
                          type="date"
                          name="beleg_gespraechsdatum"
                          value={gespraechsdatum}
                          onChange={(e) => setGespraechsdatum(e.target.value)}
                        />
                      </span>
                    </label>
                  )}
                </div>
                {typ === "gespraech" && (
                  <>
                    <label className="pf">
                      <span>Gesprächspartner</span>
                      <span className="pf-feld">
                        <input
                          type="text"
                          name="beleg_gespraechspartner"
                          value={gespraechspartner}
                          onChange={(e) => setGespraechspartner(e.target.value)}
                        />
                      </span>
                    </label>
                    <label className="pf">
                      <span>Kernnotiz</span>
                      <span className="pf-feld">
                        <textarea
                          name="beleg_kernnotiz"
                          defaultValue={b?.kernnotiz ?? ""}
                        />
                      </span>
                    </label>
                  </>
                )}
                <label className="fp-toggle">
                  <input
                    type="checkbox"
                    name="beleg_extern"
                    checked={extern}
                    onChange={(e) => setExtern(e.target.checked)}
                  />
                  <span className="fp-toggle-text">
                    <span>Extern nachvollziehbar</span>
                    <span className="c">
                      {extern
                        ? "ja, freigegeben – die Quelle darf im Kommunen-PDF erscheinen."
                        : "nein, intern – die Quelle bleibt im Werkzeug."}
                    </span>
                  </span>
                </label>
                {typ === "dokument_link" && (
                  <label className="fp-toggle">
                    <input
                      type="checkbox"
                      name="beleg_amtlich"
                      checked={amtlich}
                      onChange={(e) => setAmtlich(e.target.checked)}
                    />
                    <span className="fp-toggle-text">
                      <span>Amtliche Quelle oder Betreiberdaten</span>
                    </span>
                  </label>
                )}
              </>
            )}

            <div className="qual-box">
              <span className="qual-label">Qualität (abgeleitet)</span>
              <span className="qual-pillen">
                {(["A", "B", "C", "D"] as const).map((stufe) => (
                  <span
                    key={stufe}
                    className={`konf konf--${stufe}${qualitaet === stufe ? "" : " gedimmt"}`}
                  >
                    {stufe}
                  </span>
                ))}
              </span>
              <span className="c">
                Aus Belegtyp und Nachvollziehbarkeit berechnet, nicht editierbar.
                {verifizierung
                  ? ` Nächste Verifizierung: ${fmtDatum(verifizierung)}`
                  : ""}
              </span>
            </div>
          </section>

          <section className="ov-sec">
            <h3>begründung.</h3>
            <label className="pf">
              <span>
                Begründung<em className="pf-pflicht" aria-hidden> *</em>
              </span>
              <span className="pf-feld">
                <textarea
                  name="begruendung"
                  placeholder="Warum dieser Wert, warum diese Quelle?"
                  aria-invalid={f.begruendung ? true : undefined}
                />
              </span>
              {f.begruendung && <span className="pf-fehler">{f.begruendung}</span>}
              <span className="fp-hinweis">
                Wird in der Änderungshistorie protokolliert.
              </span>
            </label>
          </section>

          <div className="ov-fuss">
            {state.fehler && <span className="pf-fehler">{state.fehler}</span>}
            {Object.keys(f).length > 0 && !state.fehler && (
              <span className="pf-fehler">
                Bitte die markierten Felder prüfen.
              </span>
            )}
            <span className="fp-fuss-aktionen">
              {zurueckHref ? (
                <Link
                  className="btn"
                  href={zurueckHref}
                  title="Zurück zum Register"
                >
                  Abbrechen
                </Link>
              ) : (
                <button type="button" className="btn" onClick={schliessen}>
                  Abbrechen
                </button>
              )}
              <button type="submit" className="btn btn--primary" disabled={pending}>
                {pending ? "Speichert…" : neu ? "Anlegen" : "Speichern"}
              </button>
            </span>
          </div>
        </form>
      </section>

      {toast && (
        <div className="toast" role="status">
          <i className="ph ph-check-circle" aria-hidden />
          {toast}
        </div>
      )}
    </div>
  );
}
