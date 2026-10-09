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
import { AdresseBlock } from "@/components/stroeme/AdresseBlock";
import { ReserviertStempel } from "@/components/stroeme/Pillen";
import { ConversionChain } from "@/components/stroeme/ConversionChain";
import { SeasonBarsEdit } from "@/components/stroeme/SeasonBarsEdit";
import { SuchCombobox } from "@/components/stroeme/SuchCombobox";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { heuteBerlin } from "@/lib/datum";
import { CLUSTER_LABEL, OUTPUT_LABEL } from "@/lib/farben";
import { fmtFaktor, fmtDatum, fmtMonat, fmtMenge } from "@/lib/format";
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
import { saisonZuIndex } from "@/lib/saison";
import {
  leiteVerfuegbarkeitAb,
  verfuegbarkeitPill,
  vergabenZuWerten,
  type VergabeFormZeile,
} from "@/lib/verfuegbarkeit";
import { monatZuBis, monatZuVon } from "@/lib/formular-modell";
import {
  BELEG_TYPEN,
  GUELTIG_BIS_BESCHRIFTUNG,
  brauchtGueltigBis,
  deriveQualitaet,
  stufeObergrenzeOhneDatei,
  type BelegTyp,
} from "@/lib/qualitaet";
import type { MaterialartMitCluster, OutputProduktOption } from "@/lib/register";
import { BELEG_LABEL, KATEGORIE_LABEL, type StromArt } from "@/lib/stroeme-modell";
import { dezimalAnzeige, monatAnzeige, monatKanonisch } from "@/lib/eingabe-format";

/**
 * Formular-Panel von stroeme. (AP1i PR 5): Anlegen und Bearbeiten als
 * Slide-in-Panel ueber der Liste, gleicher Container wie das Detail. Inline-
 * Fehler kommen aus der Server-Action (erst nach Speichern-Versuch, wie im
 * Mockup); Qualitaet ist eine live abgeleitete, gesperrte Anzeige.
 */
/**
 * Monatsfeld als eigenes Textfeld (Review Eric, 24.09.2026).
 *
 * `type="month"` kennen Safari und Firefox nicht — dort fiel das Feld auf
 * ein nacktes Textfeld ohne jede Hilfe zurueck, waehrend das Erhebungsdatum
 * (`type="date"`) weiter funktionierte. Statt auf Browser-Verhalten zu
 * bauen, fragt das Formular jetzt ueberall gleich nach `MM/JJJJ`.
 *
 * Der getippte Text lebt lokal, der kanonische Wert geht an das Formular —
 * sonst wuerde sich das Feld beim Tippen der ersten Ziffer selbst leeren.
 * Abgeschickt wird der sichtbare Text; die Server-Action normalisiert ihn
 * mit derselben Funktion (`monatKanonisch`).
 */
function MonatFeld({
  name,
  wert,
  onWert,
  ungueltig,
  deaktiviert,
}: {
  name: string;
  wert: string;
  onWert: (kanonisch: string) => void;
  ungueltig?: boolean;
  /** E75: „unbefristet" sperrt den Bis-Monat. */
  deaktiviert?: boolean;
}) {
  const [text, setText] = useState(() => monatAnzeige(wert));
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="MM/JJJJ"
      maxLength={7}
      name={name}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onWert(monatKanonisch(e.target.value));
      }}
      // Aufraeumen erst beim Verlassen: "1/2027" wird zu "01/2027", ohne
      // waehrend des Tippens dazwischenzufunken.
      onBlur={() => {
        const k = monatKanonisch(text);
        if (k) setText(monatAnzeige(k));
      }}
      aria-invalid={ungueltig ? true : undefined}
      disabled={deaktiviert}
    />
  );
}

export function FormularPanel({
  art,
  werte,
  materialarten,
  produkte,
  zurueckHref,
  modal,
}: {
  art: StromArt;
  werte: FormularWerte | null;
  materialarten: MaterialartMitCluster[];
  produkte: OutputProduktOption[];
  zurueckHref?: string;
  /** true im Grid-Kontext: zentrales Modal wie das Detail, sonst Slide-in-Panel. */
  modal?: boolean;
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
  // F0a: Akteurwahl steuert den "Adresse uebernehmen"-Knopf im Ort-Block.
  const [akteurId, setAkteurId] = useState<string | null>(werte?.akteurId || null);

  // Mengen fuer die Live-Umrechnungskette (nur Biomasse).
  const [roh, setRoh] = useState(dezimalAnzeige(werte?.mengeRohFm));
  const [ts, setTs] = useState(dezimalAnzeige(werte?.tsAnteilPct));
  const [asche, setAsche] = useState(dezimalAnzeige(werte?.aschegehaltPct));
  const [mengeEinheit, setMengeEinheit] = useState(werte?.mengeEinheit ?? "t/a");

  // Vergabe (AP1j): Zeitraum-Inputs kontrolliert, damit die Live-Pille auf
  // sie reagiert; Zeilen und Reservierung als lokaler Zustand.
  const [vonMonat, setVonMonat] = useState(werte?.vonMonat ?? "");
  const [bisMonat, setBisMonat] = useState(werte?.bisMonat ?? "");
  // E75: offenes Ende — das Kaestchen ersetzt den Bis-Monat.
  const [unbefristet, setUnbefristet] = useState(werte?.unbefristet ?? false);
  const [reserviert, setReserviert] = useState(werte?.reserviertBhyo ?? false);
  const [vergaben, setVergaben] = useState<VergabeFormZeile[]>(
    () => werte?.vergaben ?? [],
  );

  // Saisonalitaet (E10) + Beleg-Zustand fuer die Qualitaets-Ableitung.
  // Editor-Ansicht in Index-Normierung (Mittel = 100); die Verhaeltnisse
  // des Bestands bleiben exakt erhalten (lib/saison).
  const [saison, setSaison] = useState<number[]>(() =>
    werte?.saisonalitaet ? saisonZuIndex(werte.saisonalitaet) : Array(12).fill(0),
  );
  const b = werte?.beleg ?? null;
  const [typ, setTyp] = useState<BelegTyp | "">((b?.typ as BelegTyp) ?? "");
  const [quellenangabe, setQuellenangabe] = useState(b?.quellenangabe ?? "");
  const [erhebungsdatum, setErhebungsdatum] = useState(b?.erhebungsdatum ?? "");
  const [link, setLink] = useState(b?.linkUrl ?? "");
  const [gueltigBis, setGueltigBis] = useState(b?.gueltigBis ?? "");
  const [extern, setExtern] = useState(b?.extern ?? false);
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
    { label: "Rohmenge", wert: roh ? fmtMenge(Number(roh)) : "–", einheit: "t FM/a", quelle: "erfasst" },
    { label: "Trockensubstanz", wert: ts ? fmtFaktor(Number(ts)) : "–", einheit: "%", quelle: "TS-Anteil" },
    { label: "Aschegehalt", wert: asche ? fmtFaktor(Number(asche)) : "–", einheit: "%", quelle: "Anteil an TS" },
    {
      label: "Ergebnis",
      wert: atro != null && Number.isFinite(atro) ? fmtMenge(atro) : "–",
      einheit: "t atro/a",
      quelle: "Rohmenge × TS × (1 − Asche)",
      ergebnis: true,
    },
  ];

  const setzeVergabe = (i: number, patch: Partial<VergabeFormZeile>) =>
    setVergaben((v) =>
      v.map((zeile, j) => (j === i ? { ...zeile, ...patch } : zeile)),
    );
  const entferneVergabe = (i: number) =>
    setVergaben((v) => v.filter((_, j) => j !== i));

  // Live-Ableitung wie die Qualitaets-Box: reine Anzeige, heute vom Client
  // (Kalendertag Europe/Berlin, wie der Server-Stichtag).
  const heute = heuteBerlin();
  const verfuegbarkeit =
    vonMonat && (bisMonat || unbefristet)
      ? leiteVerfuegbarkeitAb(
          heute,
          {
            zeitraumVon: monatZuVon(vonMonat),
            zeitraumBis: unbefristet ? null : monatZuBis(bisMonat),
            reserviertBhyo: reserviert,
          },
          vergabenZuWerten(vergaben),
        )
      : null;

  // E34: Die Stufe haengt nur noch an Typ und Nachweis (Datei bzw. Link).
  const qualitaet = typ
    ? deriveQualitaet({
        typ,
        dateiKey: dateiName || bestehendeDatei ? "x" : null,
        linkUrl: link || null,
      })
    : null;
  // F7: Der Erfasser sieht den Preis der Entscheidung im Moment der
  // Entscheidung — ohne Datei/Link nur die niedrigere Stufe (Matrix
  // unveraendert). Gezeigt wird die OBERGRENZE des Typs ohne Datei
  // (sonst hypothetisch vollstaendig), und nur bei Typen, bei denen
  // eine Datei die Stufe ueberhaupt hoebe (beim Gespraech nicht).
  const ohneDateiUndLink = !!typ && !dateiName && !bestehendeDatei && !link.trim();
  const dateiHinweis =
    ohneDateiUndLink && typ ? stufeObergrenzeOhneDatei(typ) : null;

  // E33/E62: obere vier Typen -> gueltig_bis (= verifiziert bis); untere drei
  // -> Typ-Frist ab dem Prueftag, erst nach dem Pruefen bekannt.
  const gueltigBisFeld = typ ? brauchtGueltigBis(typ) : false;

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
    <>
      {/* Scrim ohne Klick-Schliessen: ein Fehlklick darf keine Eingaben verwerfen. */}
      {modal && <div className="ov-scrim" aria-hidden />}
      <div className={`ov ${modal ? "ov--modal" : "ov--panel"}`}>
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
              onGewaehlt={(a) => setAkteurId(a?.id ?? null)}
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
            {/* F0a: Adressblock mit Suche, Uebernahme und Pin. Der Landkreis
                steht bewusst nicht mehr im Formular (bleibt Attribut am
                Datensatz; ab F0b raeumlich abgeleitet). */}
            <AdresseBlock
              initial={werte}
              initialGenauigkeit={werte?.genauigkeit}
              akteurId={akteurId}
              fehler={f.standort}
            />
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
                  <MonatFeld
                    name="zeitraum_von"
                    wert={vonMonat}
                    onWert={setVonMonat}
                    ungueltig={!!f.zeitraum_von}
                  />
                </span>
                {f.zeitraum_von && <span className="pf-fehler">{f.zeitraum_von}</span>}
              </label>
              <label className="pf">
                <span>
                  Verfügbar bis{!unbefristet && <em className="pf-pflicht" aria-hidden> *</em>}
                </span>
                <span className="pf-feld">
                  <MonatFeld
                    // E75: beim Ankreuzen neu aufbauen, damit das gesperrte Feld leer ist statt den alten Monat zu zeigen.
                    key={unbefristet ? "bis-unbefristet" : "bis-monat"}
                    name="zeitraum_bis"
                    wert={unbefristet ? "" : bisMonat}
                    onWert={setBisMonat}
                    ungueltig={!!f.zeitraum_bis}
                    deaktiviert={unbefristet}
                  />
                </span>
                {f.zeitraum_bis && <span className="pf-fehler">{f.zeitraum_bis}</span>}
              </label>
              <label className="fp-toggle">
                <input type="checkbox" name="unbefristet" checked={unbefristet} onChange={(e) => setUnbefristet(e.target.checked)} />
                <span className="fp-toggle-text">
                  <span>unbefristet</span>
                  <span className="c">Kein Ende — der Strom zählt in jedem Jahr ab Beginn (E75).</span>
                </span>
              </label>
            </div>
          </section>

          <section className="ov-sec">
            <h3>vergabe.</h3>
            {vergaben.map((zeile, i) => (
              <div key={i} className="fp-vergabe">
                <input type="hidden" name={`vergabe_${i}_marker`} value="1" />
                <div className="fp-vergabe-zeile">
                  <label className="pf">
                    <span>Vergeben ab</span>
                    <span className="pf-feld">
                      <MonatFeld
                        name={`vergabe_${i}_von`}
                        wert={zeile.vonMonat}
                        onWert={(k) => setzeVergabe(i, { vonMonat: k })}
                        ungueltig={!!f[`vergabe_${i}_von`]}
                      />
                    </span>
                  </label>
                  <label className="pf">
                    <span>Vergeben bis</span>
                    <span className="pf-feld">
                      <MonatFeld
                        name={`vergabe_${i}_bis`}
                        wert={zeile.bisMonat}
                        onWert={(k) => setzeVergabe(i, { bisMonat: k })}
                        ungueltig={!!f[`vergabe_${i}_bis`]}
                      />
                    </span>
                  </label>
                  <label className={`pf${zeile.anBhyo ? " pf--aus" : ""}`}>
                    <span>Vergeben an</span>
                    <span className="pf-feld">
                      <input
                        type="text"
                        name={`vergabe_${i}_an`}
                        value={zeile.anBhyo ? "" : zeile.an}
                        onChange={(e) => setzeVergabe(i, { an: e.target.value })}
                        // An bhyo vergeben heisst: der Empfaenger steht fest.
                        disabled={zeile.anBhyo}
                        placeholder={zeile.anBhyo ? "bhyo" : "z. B. Stadtwerke"}
                      />
                    </span>
                  </label>
                  <label className="fp-toggle fp-vergabe-bhyo">
                    <input
                      type="checkbox"
                      name={`vergabe_${i}_bhyo`}
                      checked={zeile.anBhyo}
                      onChange={(e) =>
                        setzeVergabe(i, { anBhyo: e.target.checked })
                      }
                    />
                    <span className="fp-toggle-text">
                      <span>an bhyo</span>
                    </span>
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Vergabezeitraum entfernen"
                    onClick={() => entferneVergabe(i)}
                  >
                    <i className="ph ph-x" aria-hidden />
                  </button>
                </div>
                {(f[`vergabe_${i}_von`] || f[`vergabe_${i}_bis`]) && (
                  <span className="pf-fehler">
                    {f[`vergabe_${i}_von`] ?? f[`vergabe_${i}_bis`]}
                  </span>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn btn--sm"
              onClick={() =>
                setVergaben((v) => [
                  ...v,
                  { vonMonat: "", bisMonat: "", an: "", anBhyo: false },
                ])
              }
            >
              <i className="ph ph-plus" aria-hidden />
              Vergabezeitraum
            </button>
            <p className="fp-hinweis">
              Leer gelassene Enden gelten ab Verfügbarkeitsbeginn bzw.
              unbefristet (bis Verfügbarkeitsende); eine Zeile ganz ohne Datum
              wird nicht gespeichert.
            </p>

            <label className="fp-toggle">
              <input
                type="checkbox"
                name="reserviert_bhyo"
                checked={reserviert}
                onChange={(e) => setReserviert(e.target.checked)}
              />
              <span className="fp-toggle-text">
                <span>Für bhyo reserviert</span>
                <span className="c">
                  {reserviert && werte?.reserviertSeit
                    ? `Reserviert seit ${fmtMonat(werte.reserviertSeit)}. `
                    : ""}
                  Weiche Markierung ohne Zeitraum – unabhängig von den
                  Vergabezeiträumen.
                </span>
              </span>
            </label>

            <div className="qual-box">
              <span className="qual-label">Verfügbarkeit (abgeleitet)</span>
              <span className="qual-pillen">
                {verfuegbarkeit ? (
                  <>
                    <span
                      className={`spill spill--${verfuegbarkeitPill(art, verfuegbarkeit.status).tone}`}
                    >
                      {verfuegbarkeitPill(art, verfuegbarkeit.status).text}
                    </span>
                    {verfuegbarkeit.reserviertZusatz && <ReserviertStempel />}
                  </>
                ) : (
                  <span className="konf konf--leer">–</span>
                )}
              </span>
              <span className="c">
                Aus Zeitraum, Vergaben und Reservierung berechnet, nicht
                editierbar.
              </span>
            </div>
          </section>

          <section className="ov-sec">
            <h3>{feed ? "mengen." : "bedarfsmenge."}</h3>
            {feed ? (
              <>
                {/* step ist ein Eingaberaster, keine Rundung: mit step="0.1"
                    wies der Browser einen TS-Anteil von 33,333 % ab („nearest
                    value"). Alle Zahlenfelder nehmen deshalb jeden Wert an;
                    gerundet wird beim Rechnen und an der Ausgabegrenze.
                    Gesichert in lib/formular-zahlenfelder.test.ts. */}
                <div className="fp-zeile fp-zeile--3">
                  <label className="pf">
                    <span>
                      Rohmenge<em className="pf-pflicht" aria-hidden> *</em>
                    </span>
                    <span className="pf-feld">
                      <input
                        type="text"
                        inputMode="decimal"
                        name="menge_roh_fm"
                        value={roh}
                        onChange={(e) => setRoh(e.target.value)}
                        aria-invalid={f.menge_roh_fm ? true : undefined}
                      />
                      <em>t FM/a</em>
                    </span>
                    {f.menge_roh_fm && <span className="pf-fehler">{f.menge_roh_fm}</span>}
                  </label>
                  <label className="pf">
                    <span>TS-Anteil (leer = unbekannt)</span>
                    <span className="pf-feld">
                      <input
                        type="text"
                        inputMode="decimal"
                        name="ts_anteil_pct"
                        value={ts}
                        onChange={(e) => setTs(e.target.value)}
                        aria-invalid={f.ts_anteil_pct ? true : undefined}
                      />
                      <em>%</em>
                    </span>
                    {f.ts_anteil_pct && <span className="pf-fehler">{f.ts_anteil_pct}</span>}
                  </label>
                  <label className="pf">
                    <span>Aschegehalt (leer = unbekannt)</span>
                    <span className="pf-feld">
                      <input
                        type="text"
                        inputMode="decimal"
                        name="aschegehalt_pct"
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
                      type="text"
                      inputMode="decimal"
                      name="menge_wert"
                      defaultValue={dezimalAnzeige(werte?.mengeWert)}
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
            {f.saison && <span className="pf-fehler">{f.saison}</span>}
            {saison.map((v, i) => (
              <input key={i} type="hidden" name={`saison_${i}`} value={v} />
            ))}
            <p className="ov-note">Verteilung je Monat in % der Jahresmenge.</p>
          </section>

          <section className="ov-sec">
            <h3>preis.</h3>
            {feed ? (
              <div className="fp-zeile fp-zeile--4">
                <label className="pf">
                  <span>Min</span>
                  <span className="pf-feld">
                    <input
                      type="text"
                      inputMode="decimal"
                      name="preis_min"
                      defaultValue={dezimalAnzeige(werte?.preisMin)}
                    />
                    <em>€/t</em>
                  </span>
                  {f.preis_min && <span className="pf-fehler">{f.preis_min}</span>}
                </label>
                <label className="pf">
                  <span>Mittel</span>
                  <span className="pf-feld">
                    <input
                      type="text"
                      inputMode="decimal"
                      name="preis_mittel"
                      defaultValue={dezimalAnzeige(werte?.preisMittel)}
                    />
                    <em>€/t</em>
                  </span>
                  {f.preis_mittel && <span className="pf-fehler">{f.preis_mittel}</span>}
                </label>
                <label className="pf">
                  <span>Max</span>
                  <span className="pf-feld">
                    <input
                      type="text"
                      inputMode="decimal"
                      name="preis_max"
                      defaultValue={dezimalAnzeige(werte?.preisMax)}
                    />
                    <em>€/t</em>
                  </span>
                  {f.preis_max && <span className="pf-fehler">{f.preis_max}</span>}
                </label>
                <label className="pf">
                  <span>Bezug</span>
                  <span className="pf-feld">
                    {/* E69: ein Bezug fuer Min/Mittel/Max; „unbekannt" (Altbestand) ist nicht
                        waehlbar — wer speichert, entscheidet. Neu: fm vorbelegt. */}
                    <select name="preis_bezug" defaultValue={neu ? "fm" : (werte?.preisBezug ?? "")} aria-invalid={f.preis_bezug ? true : undefined}>
                      {!neu && !werte?.preisBezug && <option value="">— (Bezug unbekannt)</option>}
                      <option value="fm">€/t FM</option>
                      <option value="atro">€/t atro</option>
                    </select>
                    <i className="ph-bold ph-caret-down scb-caret" aria-hidden />
                  </span>
                  {f.preis_bezug && <span className="pf-fehler">{f.preis_bezug}</span>}
                </label>
              </div>
            ) : (
              <div className="fp-zeile">
                <label className="pf">
                  <span>Preis</span>
                  <span className="pf-feld">
                    <input
                      type="text"
                      inputMode="decimal"
                      name="preis"
                      defaultValue={dezimalAnzeige(werte?.preis)}
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
                {/* Neuanlage: "Schätzung" nur als VORAUSWAHL — der Server
                    speichert exakt den Formularstand, kein Nachtragen (Review
                    #29). Bearbeiten behaelt den gespeicherten Wert, auch leer. */}
                <select
                  name="preis_herkunft"
                  defaultValue={neu ? "schaetzung" : werte.preisHerkunft}
                >
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
                    <span>
                      Link
                      {/* E34: Formularpflicht bei Webrecherche — keine Stufenbedingung. */}
                      {typ === "webrecherche" && <em className="pf-pflicht" aria-hidden> *</em>}
                    </span>
                    <span className="pf-feld">
                      <input
                        // type="text": bei type="url" verlangt der Browser
                        // das Schema. "www.beispiel.de" genuegt jetzt — das
                        // https:// ergaenzt normalisiereUrl beim Speichern.
                        type="text"
                        inputMode="url"
                        name="beleg_link"
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                        placeholder="www.beispiel.de oder https://…"
                        aria-invalid={f.beleg_link ? true : undefined}
                      />
                    </span>
                    {f.beleg_link && <span className="pf-fehler">{f.beleg_link}</span>}
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
                  {/* E33: EIN Feld gueltig_bis, typabhaengig beschriftet, Pflicht
                      bei den oberen vier Typen (CHECK folgt in Schritt 3). Die
                      unteren drei haben kein Enddatum — fuer sie gilt die
                      Typ-Frist ab Erhebungsdatum. */}
                  {gueltigBisFeld && typ && (
                    <label className="pf">
                      <span>
                        {GUELTIG_BIS_BESCHRIFTUNG[typ]}
                        <em className="pf-pflicht" aria-hidden> *</em>
                      </span>
                      <span className="pf-feld">
                        <input
                          type="date"
                          name="beleg_gueltig_bis"
                          value={gueltigBis}
                          onChange={(e) => setGueltigBis(e.target.value)}
                          aria-invalid={f.beleg_gueltig_bis ? true : undefined}
                        />
                      </span>
                      {f.beleg_gueltig_bis && (
                        <span className="pf-fehler">{f.beleg_gueltig_bis}</span>
                      )}
                    </label>
                  )}
                </div>
                {typ === "gespraech" && (
                  <label className="pf">
                    <span>Kernnotiz</span>
                    <span className="pf-feld">
                      <textarea
                        name="beleg_kernnotiz"
                        defaultValue={b?.kernnotiz ?? ""}
                      />
                    </span>
                  </label>
                )}
                <label className="fp-toggle">
                  <input
                    type="checkbox"
                    name="beleg_extern"
                    checked={extern}
                    onChange={(e) => setExtern(e.target.checked)}
                  />
                  <span className="fp-toggle-text">
                    <span>Freigabe zur externen Verwendung</span>
                    {/* E34 (25.09.2026): Das Feld ist eine FREIGABE, keine
                        Aussage ueber die Nachweiskraft. Es beeinflusst die
                        Qualitaetsstufe nicht mehr; wirksam wird es mit F6
                        (Kommunen-PDF, CSV-Export) — bis dahin beauftragt,
                        aber ohne Wirkung. Der Text sagt genau das, damit
                        weder eine springende Stufe noch ein Versprechen
                        entsteht, das nichts einloest. */}
                    <span className="c">
                      {extern
                        ? "ja – dieser Beleg darf extern verwendet werden (Kommunen-PDF, CSV-Export ab F6). Auf die Qualitätsstufe hat das keinen Einfluss."
                        : "nein – nur intern verwenden. Auf die Qualitätsstufe hat das keinen Einfluss."}
                    </span>
                  </span>
                </label>
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
                Aus Belegtyp und Nachweis (Datei bzw. Link) berechnet, nicht editierbar.
                {gueltigBisFeld
                  ? " Verifiziert bis: das Datum oben, sobald ein Prüfer den Eintrag geprüft hat."
                  : typ
                    ? " Verifiziert bis: Prüftag plus Typ-Frist, sobald ein Prüfer den Eintrag geprüft hat."
                    : ""}
              </span>
              {dateiHinweis && (
                <span className="c qual-hinweis">
                  Ohne Datei oder Link erreicht dieser Beleg nur Stufe {dateiHinweis}.
                </span>
              )}
              {typ === "webrecherche" && (
                <span className="c qual-hinweis">
                  Webrecherche ist immer Stufe D. Der Link ist Pflicht im Formular, er ändert die Stufe nicht.
                </span>
              )}
            </div>
          </section>

          {/* Review 23.09.2026: Begruendung nur beim BEARBEITEN — sie ist die
              Je-Aenderungs-Begruendung der Historie ("warum korrigiert").
              Beim Anlegen entfaellt sie (Historie erhaelt "Ersterfassung");
              auf die Qualitaets-Ableitung hat sie keinerlei Einfluss. */}
          {!neu && (
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
          )}

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
    </>
  );
}
