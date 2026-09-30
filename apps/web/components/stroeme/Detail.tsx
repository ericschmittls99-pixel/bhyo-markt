"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState, useTransition } from "react";

import { ConversionChain } from "@/components/stroeme/ConversionChain";
import { Orb } from "@/components/stroeme/Orb";
import { KonfidenzPill, VerfuegbarkeitsPill } from "@/components/stroeme/Pillen";
import { SeasonBarsMini } from "@/components/stroeme/SeasonBarsMini";
import { fmtOutputPreis } from "@/lib/energie";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { CLUSTER_LABEL } from "@/lib/farben";
import {
  fmtFaktor,
  fmtDatum,
  fmtKoordinaten,
  fmtPreis,
  fmtMenge,
  fmtZahlungsstrom,
  fmtMonat,
  fmtZeitraum,
  formatSpanne,
} from "@/lib/format";
import { ERLAUBTE_UEBERGAENGE, PRUEF_AUSGANG, STATUS_LABEL, STATUS_PILL, UEBERGANG_LABEL } from "@/lib/status";
import { belegAbgelaufenAufheben, belegAbgelaufenMarkieren, statusSetzen, stromPruefen, stromVerwerfen } from "@/lib/stroeme-actions";
import { stromEntsperren, stromSperren, stromZuweisen, zugriffAnfragen, zuweisungEntfernen } from "@/lib/sperre-actions";
import { NOTIZ_MAX } from "@/lib/inbox/notiz";
import { Avatar, AvatarStapel, anzeigeName } from "@/components/Avatar";
import { fmtDatumZeit } from "@/lib/format";
import { BELEG_LABEL, KATEGORIE_LABEL, kreisAnzeige, landAnzeige, type SperrNutzer, type Strom } from "@/lib/stroeme-modell";
import { PreisKorridorEinzel } from "@/components/stroeme/PreisKorridorEinzel";
import type { PreisKorridorEinzel as PreisKorridorEinzelDaten } from "@/lib/preiskorridor-einzel";
import { GUELTIG_BIS_BESCHRIFTUNG, istBelegTyp } from "@/lib/qualitaet";
import { verifikationPill } from "@/lib/verifikation";
import {
  vergabeLabel,
  type VerfuegbarkeitsErgebnis,
  type VergabeDaten,
} from "@/lib/verfuegbarkeit";

const HERKUNFT_LABEL: Record<string, string> = {
  eigene_datenbank: "eigene Datenbank",
  marktdaten: "Marktdaten",
  schaetzung: "Schätzung",
};

function Kv({ label, wert }: { label: string; wert: ReactNode }) {
  if (wert == null || wert === "") return null;
  return (
    <>
      <span className="kv-k">{label}</span>
      <span className="kv-w">{wert}</span>
    </>
  );
}

/**
 * Detail von stroeme. (V2): aus dem Grid als Modal (680 px, Scrim mit Blur),
 * aus der Liste als Slide-in-Panel (520 px, ohne Scrim). Statuswechsel ueber
 * die klickbare StatusPill (E8), Verwerfen ueber Papierkorb + Modal (E2).
 * Bearbeiten oeffnet das Formular-Panel (?form=<id>, PR 5).
 *
 * karte. rendert DIESELBE Komponente lesend (canEdit=false) mit
 * `stroemeHref`: statt Bearbeiten/Papierkorb steht dann "In ströme. öffnen",
 * und der "Auf der Karte"-Link entfaellt (man IST auf der Karte) — eine
 * Detailansicht, zwei Einstiegspunkte (PR 6, Spec-Anpassung Eric).
 */
export function Detail({
  strom,
  historie,
  begruendung,
  modal,
  canEdit,
  stroemeHref,
  verfuegbarkeit,
  vergaben,
  preisKorridor = null,
  sperrRechte = null,
  zuweisbare = [],
  anfrage = null,
}: {
  strom: Strom;
  historie: { zeitpunkt: string; text: string }[];
  begruendung: string | null;
  /** E38: Korridor des Stroms im Verhaeltnis zu seiner Vergleichsgruppe (serverseitig aus dem Pool). */
  preisKorridor?: PreisKorridorEinzelDaten | null;
  modal: boolean;
  canEdit: boolean;
  /** Gesetzt im karte.-Kontext: Ziel fuer "In ströme. öffnen". */
  stroemeHref?: string;
  /** AP1j, optional: karte./auswertung. reichen noch nichts durch (PR 3/4). */
  verfuegbarkeit?: VerfuegbarkeitsErgebnis | null;
  vergaben?: VergabeDaten[];
  /**
   * E44: serverseitig aus der Matrix berechnet (darf(zugang, aktion, sperre)) —
   * nur zum Ausblenden. null (karte./auswertung.): keine Sperr-Aktionen, nur Anzeige.
   */
  sperrRechte?: {
    bearbeiten: boolean;
    sperren: boolean;
    entsperren: boolean;
    zuweisen: boolean;
    /** PR c: Zugriff anfragen (gesperrt, weder Inhaber noch zugewiesen, Rolle >= bearbeiter). */
    anfragen?: boolean;
    /** E62 D4: „geprueft" setzen — pruefer/admin, an gesperrten Stroemen wie das Bearbeiten. */
    pruefen?: boolean;
    /** E62 D3: Beleg als abgelaufen markieren / Markierung aufheben — pruefer/admin. */
    abgelaufenMarkieren?: boolean;
  } | null;
  /** PR c: laufende Zugriffsanfrage des Betrachtenden — dann „Angefragt am …" statt Knopf. */
  anfrage?: { am: string } | null;
  /** E44: aktive Nutzer mit Rolle >= bearbeiter, an die zugewiesen werden kann. */
  zuweisbare?: SperrNutzer[];
}) {
  const s = strom;
  const [zuweisenOffen, setZuweisenOffen] = useState(false);
  // PR c: Zugriffsanfrage — Popover mit optionaler Notiz.
  const [anfrageOffen, setAnfrageOffen] = useState(false);
  const [notiz, setNotiz] = useState("");
  // E44: Bearbeiten nur, wenn Rolle UND Sperre es erlauben (die Wache prueft es serverseitig erneut).
  const darfBearbeiten = canEdit && (sperrRechte?.bearbeiten ?? true);
  const sperre = s.sperre ?? null;
  const zuweisungen = s.zuweisungen ?? [];
  const { setze } = useUrlZustand();
  const router = useRouter();
  const [statusMenu, setStatusMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schliessen = () => setze({ detail: null }, "push");

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== "Escape") return;
      if (confirm) return setConfirm(false);
      if (statusMenu) return setStatusMenu(false);
      if (zuweisenOffen) return setZuweisenOffen(false);
      if (anfrageOffen) return setAnfrageOffen(false);
      schliessen();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function zeigeToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  function wechsleStatus(neu: string) {
    setStatusMenu(false);
    startTransition(async () => {
      const erg = await statusSetzen(s.art, s.id, neu);
      if (erg.ok) {
        zeigeToast(`Status auf ${STATUS_LABEL[neu] ?? neu} gesetzt`);
        router.refresh();
      } else zeigeToast(erg.fehler ?? "Speichern fehlgeschlagen.");
    });
  }

  // E62 D4: „Geprueft" ist eine eigene Aktion (pruefer/admin), aus entwurf und in_pruefung.
  function pruefen() {
    setStatusMenu(false);
    startTransition(async () => {
      const erg = await stromPruefen(s.art, s.id);
      if (erg.ok) {
        zeigeToast("Als geprüft gesetzt");
        router.refresh();
      } else zeigeToast(erg.fehler ?? "Speichern fehlgeschlagen.");
    });
  }

  // E62 D3: Ablauf-Markierung des Belegs (nur Pruefer) — Zustand „abgelaufen", Qualitaet eine Stufe tiefer.
  function abgelaufen(markieren: boolean) {
    startTransition(async () => {
      const erg = markieren ? await belegAbgelaufenMarkieren(s.art, s.id) : await belegAbgelaufenAufheben(s.art, s.id);
      if (erg.ok) {
        zeigeToast(markieren ? "Beleg als abgelaufen markiert" : "Markierung aufgehoben");
        router.refresh();
      } else zeigeToast(erg.fehler ?? "Speichern fehlgeschlagen.");
    });
  }

  function sperrAktion(lauf: () => Promise<{ ok: boolean; fehler?: string }>, erfolg: string) {
    setZuweisenOffen(false);
    startTransition(async () => {
      const erg = await lauf();
      if (erg.ok) {
        zeigeToast(erfolg);
        router.refresh();
      } else zeigeToast(erg.fehler ?? "Aktion fehlgeschlagen.");
    });
  }

  function verwerfen() {
    startTransition(async () => {
      const erg = await stromVerwerfen(s.art, s.id);
      setConfirm(false);
      if (erg.ok) {
        zeigeToast("Strom verworfen – er verschwindet aus Auswahllisten.");
        schliessen();
        router.refresh();
      } else zeigeToast(erg.fehler ?? "Speichern fehlgeschlagen.");
    });
  }

  const feed = s.art === "biomasse";
  const item = feed ? s.materialartLabel : s.produktLabel;
  const titel = s.akteurName ?? s.bezeichnung ?? "–";
  // F4-Review (Eric, 24.09.2026): Die Zusammenfassung unter dem Titel nennt
  // Materialart/Produkt und die Verfuegbarkeit — die Bezeichnung steht
  // ohnehin unten unter "quelle." und doppelte den Kopf nur.
  const untertitel = [item, fmtZeitraum(s.zeitraumVon, s.zeitraumBis)]
    .filter(Boolean)
    .join(" · ");
  const pill = STATUS_PILL[s.status] ?? { text: `${s.status}.`, tone: "quiet" };
  const uebergaenge = ERLAUBTE_UEBERGAENGE[s.status] ?? [];
  const darfPruefen = darfBearbeiten && !!sperrRechte?.pruefen && PRUEF_AUSGANG.includes(s.status);
  // E62: Zustands-Pille aus strom_verifikation() — „gültig bis TT.MM.JJJJ" bzw. der benannte Zustand.
  const verifPill = s.verifikation ? verifikationPill(s.verifikation, fmtDatum) : null;

  const chain = feed
    ? [
        {
          label: "Rohmenge",
          wert: s.mengeFm != null ? fmtMenge(s.mengeFm) : "–",
          einheit: "t FM/a",
          quelle: "erfasst",
        },
        {
          label: "Trockensubstanz",
          wert: s.tsAnteil != null ? fmtFaktor(s.tsAnteil) : "–",
          einheit: "%",
          quelle: "TS-Anteil",
        },
        {
          label: "Aschegehalt",
          wert: s.aschegehalt != null ? fmtFaktor(s.aschegehalt) : "–",
          einheit: "%",
          quelle: "Anteil an TS",
        },
        {
          label: "Ergebnis",
          wert: s.mengeAtro != null ? fmtMenge(s.mengeAtro) : "–",
          einheit: "t atro/a",
          quelle: "Rohmenge × TS × (1 − Asche)",
          ergebnis: true,
        },
      ]
    : [];

  return (
    <>
      {modal && <div className="ov-scrim" onClick={schliessen} aria-hidden />}
      <div className={`ov ${modal ? "ov--modal" : "ov--panel"}`}>
        <section
          role="dialog"
          aria-modal={modal || undefined}
          aria-label="Stromdetails"
          className="ov-flaeche"
        >
          <div className="ov-kopf">
            <div className="ov-kopf-links">
              <Orb strom={s} size={44} />
              <div className="ov-kopf-text">
                <h2>{titel}</h2>
                {/* F4-Review: Reihenfolge Titel -> Nummer -> Abstand ->
                    Zusammenfassung -> Pillen -> Abstand -> quelle. */}
                {s.beleg && (
                  <button
                    type="button"
                    className="beleg-id"
                    title="Belegnummer kopieren"
                    onClick={() => {
                      void navigator.clipboard.writeText(s.beleg!.nr ?? s.beleg!.id);
                      zeigeToast("Belegnummer kopiert");
                    }}
                  >
                    {s.beleg.nr ?? s.beleg.id}
                    <i className="ph ph-copy" aria-hidden />
                  </button>
                )}
                <p className="ov-kopf-summe">{untertitel}</p>
                <div className="ov-pillen">
                  <KonfidenzPill stufe={s.qualitaet} />
                  <span data-pop className="pop-anchor">
                    <button
                      type="button"
                      className={`spill spill--${pill.tone}${darfBearbeiten ? " klickbar" : ""}`}
                      aria-haspopup={darfBearbeiten ? "menu" : undefined}
                      aria-expanded={darfBearbeiten ? statusMenu : undefined}
                      disabled={pending}
                      onClick={() => darfBearbeiten && setStatusMenu((v) => !v)}
                      title={darfBearbeiten ? "Status ändern" : undefined}
                    >
                      {pill.text}
                      {darfBearbeiten && <i className="ph-bold ph-caret-down" aria-hidden />}
                    </button>
                    {statusMenu && (
                      <span role="menu" aria-label="Status ändern" className="pop pop--links">
                        <span className="menu">
                          {uebergaenge.map((ziel) => (
                            <button
                              key={ziel}
                              type="button"
                              role="menuitem"
                              className="menu-item"
                              onClick={() => wechsleStatus(ziel)}
                            >
                              <span className="lbl">
                                {UEBERGANG_LABEL[`${s.status}>${ziel}`] ?? `Auf „${STATUS_LABEL[ziel]}" setzen`}
                              </span>
                            </button>
                          ))}
                          {/* E62 D4: nur Pruefer sehen „Geprueft" — serverseitig erneut geprueft (strom.pruefen). */}
                          {darfPruefen && (
                            <button type="button" role="menuitem" className="menu-item" onClick={pruefen}>
                              <span className="lbl">Geprüft</span>
                            </button>
                          )}
                          {uebergaenge.length === 0 && !darfPruefen && (
                            <span className="menu-leer">Kein Wechsel vorgesehen.</span>
                          )}
                        </span>
                      </span>
                    )}
                  </span>
                  {verifPill && (
                    <span className={`spill spill--${verifPill.tone}`} title="Verifikation">
                      {verifPill.text}
                    </span>
                  )}
                  {verfuegbarkeit && (
                    <VerfuegbarkeitsPill art={s.art} ergebnis={verfuegbarkeit} />
                  )}
                  {s.beleg && (
                    <span className="pill">
                      {(BELEG_LABEL[s.beleg.typ] ?? s.beleg.typ).toLowerCase()}.
                    </span>
                  )}
                  <span className="pill pill--num">{s.vollstaendigkeit} % vollständig.</span>
                </div>
                {/* E44: Sperre — Schloss, Avatar-Stapel (Inhaber zuerst), Hinweis fuer Nicht-Berechtigte. */}
                {sperre && (
                  <div className="ov-pillen">
                    <span className="ov-sperre">
                      <i className="ph-fill ph-lock" aria-hidden />
                      <AvatarStapel
                        inhaber={sperre.von}
                        zugewiesene={zuweisungen}
                        gesperrtSeit={fmtDatumZeit(sperre.am)}
                      />
                      {!darfBearbeiten && (
                        <span className="ov-sperre-hinweis">Gesperrt von {anzeigeName(sperre.von)}</span>
                      )}
                      {/* PR c: fremde Bearbeiter fragen Zugriff an; laeuft eine Anfrage, steht ihr Datum hier. */}
                      {!darfBearbeiten && anfrage && (
                        <span className="ov-sperre-hinweis ov-anfrage-stand">Angefragt am {fmtDatumZeit(anfrage.am)}</span>
                      )}
                      {!darfBearbeiten && !anfrage && sperrRechte?.anfragen && (
                        <span data-pop className="pop-anchor">
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-haspopup="dialog"
                            aria-expanded={anfrageOffen}
                            disabled={pending}
                            onClick={() => setAnfrageOffen((v) => !v)}
                          >
                            <i className="ph ph-hand-waving" aria-hidden />
                            Zugriff anfragen
                          </button>
                          {anfrageOffen && (
                            <div role="dialog" aria-label="Zugriff anfragen" className="pop ov-anfrage">
                              <label className="ov-anfrage-label" htmlFor="anfrage-notiz">
                                Notiz an {anzeigeName(sperre.von)} (optional)
                              </label>
                              <textarea
                                id="anfrage-notiz"
                                className="ov-anfrage-notiz"
                                rows={3}
                                maxLength={NOTIZ_MAX}
                                value={notiz}
                                onChange={(ev) => setNotiz(ev.target.value)}
                                placeholder="Warum brauchst du Zugriff?"
                              />
                              <div className="ov-anfrage-fuss">
                                <span className="c">{notiz.length}/{NOTIZ_MAX}</span>
                                <button
                                  type="button"
                                  className="btn btn--primary btn--sm"
                                  disabled={pending}
                                  onClick={() => {
                                    setAnfrageOffen(false);
                                    sperrAktion(() => zugriffAnfragen(s.art, s.id, notiz), "Zugriff angefragt");
                                  }}
                                >
                                  Anfragen
                                </button>
                              </div>
                            </div>
                          )}
                        </span>
                      )}
                      {sperrRechte?.zuweisen &&
                        zuweisungen.map((z) => (
                          <button
                            key={z.id}
                            type="button"
                            className="icon-btn"
                            style={{ width: 24, height: 24 }}
                            aria-label={`Zuweisung von ${anzeigeName(z)} entfernen`}
                            title={`Zuweisung von ${anzeigeName(z)} entfernen`}
                            disabled={pending}
                            onClick={() =>
                              sperrAktion(() => zuweisungEntfernen(s.art, s.id, z.id), `Zuweisung von ${anzeigeName(z)} entfernt`)
                            }
                          >
                            <i className="ph-bold ph-x" aria-hidden />
                          </button>
                        ))}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="ov-kopf-aktionen">
              {/* E44: Sperren / Entsperren / Zuweisen — nur fuer Berechtigte (Matrix), serverseitig erneut geprueft. */}
              {/* Icon-Knoepfe wie der Papierkorb (Kopfzeile bleibt einzeilig), Wortlaut als aria-label/Tooltip. */}
              {sperrRechte?.sperren && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Sperren"
                  title="Sperren"
                  disabled={pending}
                  onClick={() => sperrAktion(() => stromSperren(s.art, s.id), "Strom gesperrt")}
                >
                  <i className="ph ph-lock" aria-hidden />
                </button>
              )}
              {sperrRechte?.entsperren && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Entsperren"
                  title="Entsperren"
                  disabled={pending}
                  onClick={() => sperrAktion(() => stromEntsperren(s.art, s.id), "Strom entsperrt, Zuweisungen entfernt")}
                >
                  <i className="ph ph-lock-open" aria-hidden />
                </button>
              )}
              {sperrRechte?.zuweisen && (
                <span data-pop className="pop-anchor">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Zuweisen …"
                    title="Zuweisen …"
                    aria-haspopup="menu"
                    aria-expanded={zuweisenOffen}
                    disabled={pending}
                    onClick={() => setZuweisenOffen((v) => !v)}
                  >
                    <i className="ph ph-user-plus" aria-hidden />
                  </button>
                  {zuweisenOffen && (
                    <span role="menu" aria-label="Zuweisen an" className="pop">
                      <span className="zw-liste">
                        {zuweisbare
                          .filter((n) => n.id !== sperre?.von.id && !zuweisungen.some((z) => z.id === n.id))
                          .map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              role="menuitem"
                              className="zw-eintrag"
                              onClick={() =>
                                sperrAktion(() => stromZuweisen(s.art, s.id, n.id), `${anzeigeName(n)} zugewiesen`)
                              }
                            >
                              <Avatar nutzer={n} groesse="s" />
                              <span className="zw-name">{anzeigeName(n)}</span>
                            </button>
                          ))}
                        {zuweisbare.filter((n) => n.id !== sperre?.von.id && !zuweisungen.some((z) => z.id === n.id)).length === 0 && (
                          <span className="zw-leer">Niemand mehr zuzuweisen.</span>
                        )}
                      </span>
                    </span>
                  )}
                </span>
              )}
              {stroemeHref && (
                <Link className="btn btn--sm" href={stroemeHref}>
                  <i className="ph ph-arrow-square-out" aria-hidden />
                  In ströme. öffnen
                </Link>
              )}
              {!stroemeHref && darfBearbeiten && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setze({ form: s.id, detail: null }, "push")}
                >
                  <i className="ph ph-pencil-simple" aria-hidden />
                  Bearbeiten
                </button>
              )}
              {!stroemeHref && darfBearbeiten && s.status !== "verworfen" && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Strom verwerfen"
                  onClick={() => setConfirm(true)}
                >
                  <i className="ph ph-trash" aria-hidden />
                </button>
              )}
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

          <div className="ov-body">
            <section className="ov-sec">
              <h3>quelle.</h3>
              <div className="kv">
                <Kv
                  label="Akteur"
                  wert={[s.akteurName, s.sektorLabel ?? s.sektor].filter(Boolean).join(" · ") || "–"}
                />
                <Kv label="Bezeichnung" wert={s.bezeichnung ?? "–"} />
                <Kv label="Kontaktperson" wert={s.kontaktperson ?? "–"} />
                <Kv label="Ort" wert={s.ort ?? "–"} />
                {/* F0b: abgeleitet aus der Koordinate (VG250) — nicht editierbar. */}
                <Kv label="Landkreis" wert={`${kreisAnzeige(s)} · aus Koordinate`} />
                <Kv label="Bundesland" wert={`${landAnzeige(s)} · aus Koordinate`} />
                <Kv label="Regionen" wert={s.regionNamen.join(", ") || "–"} />
              </div>
              <div className="standort">
                <i className="ph ph-map-pin" aria-hidden />
                <span className="standort-text">
                  {s.lng != null && s.lat != null ? (
                    <>
                      <span className="t">Standort {s.ort ?? ""}</span>
                      <span className="c">{fmtKoordinaten(s.lng, s.lat)}</span>
                    </>
                  ) : (
                    <span className="c">
                      Kein Karten-Pin erfasst – der Strom erscheint nicht auf der Karte.
                    </span>
                  )}
                </span>
                {!stroemeHref && s.lng != null && s.lat != null && (
                  <Link
                    className="btn btn--sm"
                    href={`/karte?detail=${s.id}&art=${s.art}`}
                  >
                    <i className="ph ph-map-trifold" aria-hidden />
                    Auf der Karte
                  </Link>
                )}
              </div>
            </section>

            <section className="ov-sec">
              <h3>{feed ? "materialart & zeitraum." : "output & zeitraum."}</h3>
              <div className="kv">
                <Kv
                  label={feed ? "Cluster" : "Output-Gruppe"}
                  wert={
                    <span className="zelle-orb">
                      <Orb strom={s} size={16} />
                      {feed
                        ? s.cluster
                          ? (CLUSTER_LABEL[s.cluster] ?? s.cluster)
                          : "–"
                        : (s.gruppeLabel ?? "–")}
                    </span>
                  }
                />
                <Kv label={feed ? "Materialart" : "Output"} wert={item ?? "–"} />
                {!feed && (
                  <Kv
                    label="Kategorie"
                    wert={s.kategorie ? KATEGORIE_LABEL[s.kategorie] : "–"}
                  />
                )}
                <Kv label="Verfügbar" wert={fmtZeitraum(s.zeitraumVon, s.zeitraumBis)} />
              </div>
            </section>

            {verfuegbarkeit && (
              <section className="ov-sec">
                <h3>vergabe.</h3>
                {(vergaben ?? []).length ? (
                  <div className="kv">
                    {(vergaben ?? []).map((vz, i) => (
                      <Kv
                        key={i}
                        label={vz.anBhyo ? "an bhyo" : (vz.vergebenAn ?? "extern")}
                        wert={vergabeLabel(vz.vergebenVon, vz.vergebenBis)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="ov-note">Keine Vergabezeiträume erfasst.</p>
                )}
                {s.reserviertBhyo && (
                  <p className="ov-note">
                    Für bhyo reserviert (ohne Zeitraum)
                    {s.reserviertSeit ? `, seit ${fmtMonat(s.reserviertSeit)}` : ""}.
                  </p>
                )}
              </section>
            )}

            <section className="ov-sec">
              <h3>{feed ? "mengen." : "bedarfsmenge."}</h3>
              {feed ? (
                <ConversionChain schritte={chain} />
              ) : (
                <div className="metric">
                  <span className="wert">
                    {s.mengeWert != null ? fmtMenge(s.mengeWert) : "–"}
                    <em>{s.mengeEinheit ?? ""}</em>
                  </span>
                  <span className="lbl">bedarf pro jahr.</span>
                </div>
              )}
            </section>

            {s.saisonalitaet && (
              <section className="ov-sec">
                <h3>saisonalität.</h3>
                <SeasonBarsMini werte={s.saisonalitaet} />
                <p className="ov-note">Verteilung je Monat in % der Jahresmenge.</p>
              </section>
            )}

            <section className="ov-sec">
              <h3>preis.</h3>
              <div className="kv kv--num">
                {feed ? (
                  <>
                    <Kv
                      label="Korridor"
                      wert={
                        // Rueckmeldung 1: Spannen mit „bis" (formatSpanne); eine
                        // offene Seite wird als „ab"/„bis" benannt statt mit Strich.
                        s.preisMin != null && s.preisMax != null
                          ? formatSpanne(s.preisMin, s.preisMax, "€/t")
                          : s.preisMin != null
                            ? `ab ${fmtPreis(s.preisMin)} €/t`
                            : s.preisMax != null
                              ? `bis ${fmtPreis(s.preisMax)} €/t`
                              : "–"
                      }
                    />
                    <Kv
                      label="Mittel"
                      // E14: Label aus dem Vorzeichen (Einkaufspreis/Annahmeentgelt),
                      // ein roher negativer Wert wird nie als "Preis" gerendert.
                      wert={s.preisMittel != null ? fmtZahlungsstrom(s.preisMittel) : "–"}
                    />
                  </>
                ) : (
                  <Kv
                    label="Preis"
                    // E20: erfasste Einheit nicht roh anzeigen, sondern in die
                    // Anzeigeeinheit umrechnen (€/MWh energetisch, €/t stofflich).
                    wert={fmtOutputPreis(s.produktCode, s.preis, s.preisEinheit)}
                  />
                )}
                <Kv
                  label="Herkunft"
                  wert={
                    s.preisHerkunft
                      ? (HERKUNFT_LABEL[s.preisHerkunft] ?? s.preisHerkunft)
                      : feed
                        ? "–"
                        : null
                  }
                />
              </div>
              {/* E38: Korridor des Stroms gegen das Band seiner Vergleichsgruppe. */}
              {preisKorridor && <PreisKorridorEinzel k={preisKorridor} />}
            </section>

            <section className="ov-sec">
              <h3>beleg.</h3>
              {s.beleg ? (
                <div className="kv">
                  <Kv label="Belegtyp" wert={BELEG_LABEL[s.beleg.typ] ?? s.beleg.typ} />
                  <Kv
                    label="Quellenangabe"
                    wert={
                      s.beleg.href ? (
                        <a href={s.beleg.href} target="_blank" rel="noopener noreferrer">
                          {s.beleg.quellenangabe ?? "Beleg öffnen"}
                        </a>
                      ) : (
                        (s.beleg.quellenangabe ?? "–")
                      )
                    }
                  />
                  <Kv label="Erhebungsdatum" wert={fmtDatum(s.beleg.erhebungsdatum)} />
                  {/* E33: typabhaengige Beschriftung des einen Feldes gueltig_bis;
                      nur die oberen vier Typen tragen es. */}
                  {istBelegTyp(s.beleg.typ) && GUELTIG_BIS_BESCHRIFTUNG[s.beleg.typ] && (
                    <Kv
                      label={GUELTIG_BIS_BESCHRIFTUNG[s.beleg.typ]!}
                      wert={s.beleg.gueltigBis ? fmtDatum(s.beleg.gueltigBis) : "nicht gesetzt"}
                    />
                  )}
                  {/* E34: Freigabe, keine Nachweiskraft — wirkt ab F6 (PDF, CSV). */}
                  <Kv
                    label="Freigabe extern"
                    wert={s.beleg.externNachvollziehbar ? "ja, für externe Verwendung freigegeben" : "nein, nur intern"}
                  />
                  <Kv label="Kernnotiz" wert={s.beleg.kernnotiz} />
                  {/* E62: Verifikation — Zustand, Pruefzeitpunkt, verifiziert bis; D3-Markierung nur fuer Pruefer. */}
                  <Kv
                    label="Verifikation"
                    wert={
                      verifPill ? (
                        <span className="ov-verif">
                          <span className={`spill spill--${verifPill.tone}`}>{verifPill.text}</span>
                          {s.verifikation?.verifiziertAm && (
                            <span className="c"> geprüft am {fmtDatumZeit(s.verifikation.verifiziertAm)}</span>
                          )}
                          {s.beleg.abgelaufenAm && (
                            <span className="c"> · als abgelaufen markiert am {fmtDatum(s.beleg.abgelaufenAm)}</span>
                          )}
                        </span>
                      ) : null
                    }
                  />
                  {darfBearbeiten && sperrRechte?.abgelaufenMarkieren && (
                    <Kv
                      label=""
                      wert={
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={pending}
                          onClick={() => abgelaufen(!s.beleg!.abgelaufenAm)}
                        >
                          {s.beleg.abgelaufenAm ? "Markierung aufheben" : "Als abgelaufen markieren"}
                        </button>
                      }
                    />
                  )}
                </div>
              ) : (
                <p className="ov-note">Kein Beleg hinterlegt.</p>
              )}
            </section>

            {begruendung && (
              <section className="ov-sec">
                <h3>begründung.</h3>
                <p className="ov-text">{begruendung}</p>
              </section>
            )}

            <section className="ov-sec">
              <h3>änderungshistorie.</h3>
              {historie.length ? (
                <div className="historie2">
                  {historie.map((h, i) => (
                    <div key={i} className="historie2-row">
                      <span className="z">{h.zeitpunkt}</span>
                      <span>{h.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ov-note">Noch keine Einträge.</p>
              )}
            </section>
          </div>
        </section>
      </div>

      {confirm && (
        <div className="modal-scrim" role="presentation" onClick={() => setConfirm(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Strom verwerfen"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>strom verwerfen.</h2>
            <p>
              „{titel} – {s.bezeichnung ?? item ?? "–"}“ erhält den Status{" "}
              <strong>verworfen</strong> und verschwindet aus Auswahllisten. Beleg und
              Historie bleiben erhalten, gelöscht wird nichts.
            </p>
            <div className="modal-aktionen">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setConfirm(false)}
                disabled={pending}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="btn btn--sm btn--ink"
                onClick={verwerfen}
                disabled={pending}
              >
                Verwerfen
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <i className="ph ph-info" aria-hidden />
          {toast}
        </div>
      )}
    </>
  );
}
