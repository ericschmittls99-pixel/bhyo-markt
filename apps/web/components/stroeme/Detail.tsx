"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState, useTransition } from "react";

import { ConversionChain } from "@/components/stroeme/ConversionChain";
import { Orb } from "@/components/stroeme/Orb";
import { KonfidenzPill } from "@/components/stroeme/Pillen";
import { SeasonBarsMini } from "@/components/stroeme/SeasonBarsMini";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { CLUSTER_LABEL } from "@/lib/farben";
import { fmtDatum, fmtPreis, fmtZahl, fmtZeitraum } from "@/lib/format";
import { ERLAUBTE_UEBERGAENGE, STATUS_LABEL, STATUS_PILL } from "@/lib/status";
import { statusSetzen, stromVerwerfen } from "@/lib/stroeme-actions";
import { BELEG_LABEL, KATEGORIE_LABEL, type Strom } from "@/lib/stroeme-modell";

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

function fmtKoordinaten(lng: number, lat: number): string {
  const f = (n: number) => n.toFixed(4).replace(".", ",");
  return `${f(lat)}° N · ${f(lng)}° O`;
}

/**
 * Detail von stroeme. (V2): aus dem Grid als Modal (680 px, Scrim mit Blur),
 * aus der Liste als Slide-in-Panel (520 px, ohne Scrim). Statuswechsel ueber
 * die klickbare StatusPill (E8), Verwerfen ueber Papierkorb + Modal (E2).
 * Bearbeiten kommt mit dem Formular-PR (PR 5) und ist bis dahin ein Toast.
 */
export function Detail({
  strom,
  historie,
  begruendung,
  verifizierung,
  modal,
  canEdit,
}: {
  strom: Strom;
  historie: { zeitpunkt: string; text: string }[];
  begruendung: string | null;
  verifizierung: string | null;
  modal: boolean;
  canEdit: boolean;
}) {
  const s = strom;
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
  const untertitel = [
    item,
    s.bezeichnung && s.bezeichnung !== item ? s.bezeichnung : null,
    fmtZeitraum(s.zeitraumVon, s.zeitraumBis),
  ]
    .filter(Boolean)
    .join(" · ");
  const pill = STATUS_PILL[s.status] ?? { text: `${s.status}.`, tone: "quiet" };
  const uebergaenge = ERLAUBTE_UEBERGAENGE[s.status] ?? [];

  const chain = feed
    ? [
        {
          label: "Rohmenge",
          wert: s.mengeFm != null ? fmtZahl(s.mengeFm) : "–",
          einheit: "t FM/a",
          quelle: "erfasst",
        },
        {
          label: "Trockensubstanz",
          wert: s.tsAnteil != null ? fmtZahl(s.tsAnteil) : "–",
          einheit: "%",
          quelle: "TS-Anteil",
        },
        {
          label: "Aschegehalt",
          wert: s.aschegehalt != null ? fmtZahl(s.aschegehalt) : "–",
          einheit: "%",
          quelle: "Anteil an TS",
        },
        {
          label: "Ergebnis",
          wert: s.mengeAtro != null ? fmtZahl(s.mengeAtro) : "–",
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
                <p>{untertitel}</p>
                <div className="ov-pillen">
                  <KonfidenzPill stufe={s.qualitaet} />
                  <span data-pop className="pop-anchor">
                    <button
                      type="button"
                      className={`spill spill--${pill.tone}${canEdit ? " klickbar" : ""}`}
                      aria-haspopup={canEdit ? "menu" : undefined}
                      aria-expanded={canEdit ? statusMenu : undefined}
                      disabled={pending}
                      onClick={() => canEdit && setStatusMenu((v) => !v)}
                      title={canEdit ? "Status ändern" : undefined}
                    >
                      {pill.text}
                      {canEdit && <i className="ph-bold ph-caret-down" aria-hidden />}
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
                                Auf „{STATUS_LABEL[ziel]}" setzen
                              </span>
                            </button>
                          ))}
                          {uebergaenge.length === 0 && (
                            <span className="menu-leer">Kein Wechsel vorgesehen.</span>
                          )}
                        </span>
                      </span>
                    )}
                  </span>
                  {s.beleg && (
                    <span className="pill">
                      {(BELEG_LABEL[s.beleg.typ] ?? s.beleg.typ).toLowerCase()}.
                    </span>
                  )}
                  <span className="pill pill--num">{s.vollstaendigkeit} % vollständig.</span>
                </div>
              </div>
            </div>
            <div className="ov-kopf-aktionen">
              {canEdit && (
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => zeigeToast("Bearbeiten folgt mit dem Formular-PR.")}
                >
                  <i className="ph ph-pencil-simple" aria-hidden />
                  Bearbeiten
                </button>
              )}
              {canEdit && s.status !== "verworfen" && (
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
                  wert={[s.akteurName, s.sektor].filter(Boolean).join(" · ") || "–"}
                />
                <Kv label="Bezeichnung" wert={s.bezeichnung ?? "–"} />
                <Kv label="Kontaktperson" wert={s.kontaktperson ?? "–"} />
                <Kv label="Ort" wert={s.ort ?? "–"} />
                <Kv label="Landkreis" wert={s.landkreis ?? "–"} />
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
                {s.lng != null && s.lat != null && (
                  <Link className="btn btn--sm" href={`/karte?detail=${s.id}`}>
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

            <section className="ov-sec">
              <h3>{feed ? "mengen." : "bedarfsmenge."}</h3>
              {feed ? (
                <ConversionChain schritte={chain} />
              ) : (
                <div className="metric">
                  <span className="wert">
                    {s.mengeWert != null ? fmtZahl(s.mengeWert) : "–"}
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
                        s.preisMin != null || s.preisMax != null
                          ? `${s.preisMin != null ? fmtPreis(s.preisMin) : "–"} – ${s.preisMax != null ? fmtPreis(s.preisMax) : "–"} €/t`
                          : "–"
                      }
                    />
                    <Kv
                      label="Mittel"
                      wert={s.preisMittel != null ? `${fmtPreis(s.preisMittel)} €/t` : "–"}
                    />
                  </>
                ) : (
                  <Kv
                    label="Preis"
                    wert={
                      s.preis != null
                        ? `${fmtPreis(s.preis)} ${s.preisEinheit ?? ""}`.trim()
                        : "–"
                    }
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
                  <Kv
                    label="Extern nachvollziehbar"
                    wert={s.beleg.externNachvollziehbar ? "ja, freigegeben" : "nein, intern"}
                  />
                  {s.beleg.amtlich != null && (
                    <Kv label="Amtliche Quelle" wert={s.beleg.amtlich ? "ja" : "nein"} />
                  )}
                  <Kv label="Gesprächsdatum" wert={s.beleg.gespraechsdatum} />
                  <Kv label="Gesprächspartner" wert={s.beleg.gespraechspartner} />
                  <Kv label="Kernnotiz" wert={s.beleg.kernnotiz} />
                  <Kv
                    label="Nächste Verifizierung"
                    wert={verifizierung ? fmtDatum(verifizierung) : "–"}
                  />
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
