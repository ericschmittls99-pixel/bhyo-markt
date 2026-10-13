"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AkteurKarte } from "@/components/akteure/AkteurKarte";
import { AkteurStammdaten } from "@/components/akteure/AkteurStammdaten";
import { Kontaktpersonen } from "@/components/akteure/Kontaktpersonen";
import { Kommentare } from "@/components/kommentare/Kommentare";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { AKTEUR_ZUSTAND_LABEL, zustaendeAus, type AkteurZeile } from "@/lib/akteure-modell";
import type { AkteurStrom } from "@/lib/akteure";
import { fmtDatum } from "@/lib/format";
import type { Kommentar } from "@/lib/kommentar-modell";
import type { Kontaktperson } from "@/lib/kontaktperson-modell";
import type { Erwaehnbar } from "@/lib/kommentar-eingabe";
import type { Rolle } from "@/lib/rechte";
import { STATUS_LABEL } from "@/lib/status";

/**
 * E77 R6: Der Akteur als Sidebar — dieselbe Huelle wie die Strom-Sidebar in
 * stroeme. (`ov ov--panel`, rechts, Esc und X schliessen ueber den
 * URL-Parameter `detail` — `akteur` ist in akteure. die Facette Sektor / Akteur). Aufbau: Kopf (Name, Sektor- und Zustands-Pillen),
 * stammdaten. (Bearbeiten/Loeschen wie bisher), sitz und standorte. (Karte,
 * die beim Bearbeiten ruht — eine MapLibre-Instanz, Sitz-Erfassung d),
 * kontaktpersonen., belege und stroeme., kommentare., verlauf. Deep-Link:
 * `/akteure?detail=<id>`, `&reiter=kontaktpersonen` rollt zum Abschnitt,
 * `#kommentar-<id>` zum Kommentar (Kommentare-Baustein). Die eigene Seite
 * `/akteure/<id>` leitet hierher um.
 */
export function AkteurDetail({
  akteur,
  sektoren,
  darfBearbeiten,
  darfLoeschen,
  standorte,
  stroeme,
  personen,
  kontaktRechte,
  verlauf,
  kommentare,
  kommentarZugang,
  darfKommentieren,
  erwaehnbare = [],
  fokus = null,
}: {
  akteur: AkteurZeile;
  sektoren: { code: string; label: string; aktiv: boolean }[];
  darfBearbeiten: boolean;
  darfLoeschen: boolean;
  standorte: { id: string; lng: number; lat: number; label: string }[];
  stroeme: AkteurStrom[];
  personen: Kontaktperson[];
  kontaktRechte: { schreiben: boolean; loeschen: boolean; auskunft: boolean };
  verlauf: { zeitpunkt: string; text: string; importLaufId: string | null }[];
  kommentare: Kommentar[];
  kommentarZugang: { id: string; rolle: Rolle } | null;
  darfKommentieren: boolean;
  erwaehnbare?: Erwaehnbar[];
  /** `?reiter=kontaktpersonen` (alte Links, Inbox): zum Abschnitt rollen. */
  fokus?: "kontaktpersonen" | null;
}) {
  const { setze } = useUrlZustand();
  const [bearbeiten, setBearbeiten] = useState(false);
  const kontaktRef = useRef<HTMLElement>(null);
  const schliessen = () => setze({ detail: null, reiter: null }, "push");

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== "Escape" || bearbeiten) return;
      schliessen();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (fokus === "kontaktpersonen") kontaktRef.current?.scrollIntoView({ block: "start" });
  }, [fokus]);

  const zustaende = zustaendeAus(akteur);
  const sitz = akteur.sitzLng != null && akteur.sitzLat != null ? { lng: akteur.sitzLng, lat: akteur.sitzLat } : null;

  return (
    <div className="ov ov--panel">
      <section role="dialog" aria-label="Akteurdetails" className="ov-flaeche ak-panel">
        <div className="ov-kopf">
          <div className="ov-kopf-links">
            <span className="ak-panel-icon" aria-hidden>
              <i className="ph ph-buildings" />
            </span>
            <div className="ov-kopf-text">
              <h2>{akteur.name}</h2>
              <div className="ov-pillen ak-pillen">
                <span className="pill pill--accent">{akteur.sektorLabel}</span>
                {zustaende.map((w) => (
                  <span key={w} className="pill pill--muted">
                    {AKTEUR_ZUSTAND_LABEL[w]}
                  </span>
                ))}
                {akteur.verwaistSeit && <span className="c">seit {fmtDatum(akteur.verwaistSeit)}</span>}
              </div>
            </div>
          </div>
          <div className="ov-kopf-aktionen">
            <button type="button" className="icon-btn" aria-label="Schließen" onClick={schliessen}>
              <i className="ph ph-x" aria-hidden />
            </button>
          </div>
        </div>

        <div className="ov-body">
          <section className="ov-sec">
            <h3>stammdaten.</h3>
            <AkteurStammdaten
              akteur={akteur}
              sektoren={sektoren}
              darfBearbeiten={darfBearbeiten}
              darfLoeschen={darfLoeschen}
              bearbeiten={bearbeiten}
              setBearbeiten={setBearbeiten}
            />
          </section>
          <section className="ov-sec">
            <h3>sitz und standorte.</h3>
            {bearbeiten ? (
              <div className="ak-karte ak-karte--ruht" aria-label="Karte ruht während der Bearbeitung">
                <span className="ak-karte-platzhalter">Karte ruht während der Bearbeitung — der Sitz-Pin steht im Formular.</span>
              </div>
            ) : (
              <AkteurKarte sitz={sitz} standorte={standorte} />
            )}
            <p className="ov-note">Grüner Pin: Sitz des Akteurs. Dunkle Pins: Standorte seiner Ströme (bleiben am Strom, F0a).</p>
          </section>
          <section className="ov-sec" id="kontaktpersonen" ref={kontaktRef}>
            <h3>kontaktpersonen.{personen.length ? ` (${personen.length})` : ""}</h3>
            <Kontaktpersonen
              akteurId={akteur.id}
              personen={personen}
              darfSchreiben={kontaktRechte.schreiben}
              darfLoeschen={kontaktRechte.loeschen}
              darfAuskunft={kontaktRechte.auskunft}
            />
          </section>
          <section className="ov-sec">
            <h3>belege und ströme.{stroeme.length ? ` (${stroeme.length})` : ""}</h3>
            {stroeme.length === 0 ? (
              <p className="ov-note">Kein Strom verweist auf diesen Akteur — er gilt als verwaist.</p>
            ) : (
              <div className="ak-panel-tabelle">
                <table className="einst-tabelle ak-tabelle">
                  <thead>
                    <tr>
                      <th>Beleg</th>
                      <th>Strom</th>
                      <th>Standort</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stroeme.map((s) => (
                      <tr key={s.id}>
                        <td>{s.belegNr ?? <span className="c">ohne Beleg</span>}</td>
                        <td>
                          <Link href={`/register?sicht=${s.art === "output" ? "outputs" : "feedstock"}&detail=${s.id}`} className="ak-link">
                            {s.bezeichnung ?? "–"}
                          </Link>
                          <div className="param-schluessel">{s.art === "biomasse" ? "Feedstock" : "Output"}</div>
                        </td>
                        <td>{s.ort ?? <span className="c">–</span>}</td>
                        <td>
                          <span className="pill pill--muted">{STATUS_LABEL[s.status] ?? s.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="ov-sec">
            {/* AP2.6 PR b (E71): Kommentare am Akteur — lesen alle, schreiben ab bearbeiter; der Baustein traegt seinen Titel selbst. */}
            <Kommentare bezug={{ art: "akteur", id: akteur.id }} kommentare={kommentare} zugang={kommentarZugang} darfErstellen={darfKommentieren} erwaehnbare={erwaehnbare} />
          </section>
          <section className="ov-sec">
            <h3>verlauf.</h3>
            {verlauf.length === 0 ? (
              <p className="ov-note">Noch keine Einträge.</p>
            ) : (
              <div className="historie2">
                {verlauf.map((h, i) => (
                  <div key={i} className="historie2-row">
                    <span className="z">{h.zeitpunkt}</span>
                    <span>
                      {h.text}
                      {h.importLaufId && (
                        <>
                          {" "}
                          <Link href={`/import/${h.importLaufId}`}>Import-Lauf</Link>
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

/** `?akteur=<id>` zeigt auf nichts (geloescht, nie da): die Sidebar sagt es, statt still zu fehlen. */
export function AkteurNichtGefunden() {
  const { setze } = useUrlZustand();
  const schliessen = () => setze({ detail: null, reiter: null }, "push");
  return (
    <div className="ov ov--panel">
      <section role="dialog" aria-label="Akteurdetails" className="ov-flaeche ak-panel">
        <div className="ov-kopf">
          <div className="ov-kopf-text">
            <h2>Akteur nicht gefunden.</h2>
          </div>
          <div className="ov-kopf-aktionen">
            <button type="button" className="icon-btn" aria-label="Schließen" onClick={schliessen}>
              <i className="ph ph-x" aria-hidden />
            </button>
          </div>
        </div>
        <div className="ov-body">
          <p className="ov-note">Unter dieser Kennung gibt es keinen Akteur — gelöscht oder nie angelegt.</p>
        </div>
      </section>
    </div>
  );
}
