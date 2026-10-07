"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";

import { importZeileBearbeiten, importZeileUeberspringen } from "@/lib/import-actions";
import { FEHLER_PREFIX, hinweise, zuordnungsFehlerListe, type Zielfeld } from "@/lib/import-zuordnung";
import type { CodeOptionen } from "./ZuordnungTabelle";

export interface NacharbeitZeile {
  id: string;
  zeilennummer: number;
  status: string;
  fehlergrund: string | null;
  felder: Record<string, string>;
}

/**
 * Nacharbeit (AP2.7 PR c, E67): Zeilen mit Fehler je Zeile korrigieren —
 * dieselben Zielfelder wie die Zuordnung, Code-Felder als Auswahl — oder
 * ueberspringen. Gespeichert wird nur, was sich geaendert hat; die Zeile
 * geht danach wieder durch Probelauf und Ausfuehren. PR f (B3): Fehler je
 * Feld stehen am Feld, Hinweise (Rundung, Umrechnung) an der Zeile; der
 * Server prueft die Eingabe nach denselben Regeln wie die Zuordnung.
 */
export function Nacharbeit({ laufId, zeilen, zielfelder, optionen }: { laufId: string; zeilen: NacharbeitZeile[]; zielfelder: Zielfeld[]; optionen: CodeOptionen }) {
  const router = useRouter();
  const [offen, setOffen] = useState<string | null>(null);
  const [werte, setWerte] = useState<Record<string, string>>({});
  const [meldung, setMeldung] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();
  const felder = zielfelder.filter((z) => z.typ !== "einheit");

  function oeffnen(z: NacharbeitZeile) {
    setOffen(z.id);
    setMeldung(null);
    setWerte(Object.fromEntries(felder.map((f) => [f.key, z.felder[f.key] ?? ""])));
  }

  function speichern(z: NacharbeitZeile) {
    const patch: Record<string, string> = {};
    // Ein Feld mit Fehler geht immer mit — auch unveraendert leer (B5: der Wert mit Kontaktdaten wurde nie uebernommen, „leer lassen" ist die Korrektur).
    for (const f of felder) if ((werte[f.key] ?? "") !== (z.felder[f.key] ?? "") || z.felder[`${FEHLER_PREFIX}${f.key}`]) patch[f.key] = werte[f.key] ?? "";
    starte(async () => {
      const erg = await importZeileBearbeiten(laufId, z.id, patch);
      if (erg.ok) {
        setOffen(null);
        router.refresh();
      } else setMeldung(erg.fehler ?? "Speichern fehlgeschlagen.");
    });
  }

  function ueberspringen(z: NacharbeitZeile) {
    starte(async () => {
      const erg = await importZeileUeberspringen(laufId, z.id);
      if (erg.ok) router.refresh();
      else setMeldung(erg.fehler ?? "Fehlgeschlagen.");
    });
  }

  if (zeilen.length === 0) return null;
  return (
    <section className="imp-akteure">
      <header className="einst-kopf">
        <h3>nacharbeit.</h3>
        <p className="c">
          {zeilen.length} Zeile(n) mit Fehler. Korrigieren und speichern — die Zeile geht dann erneut durch Probelauf und
          Ausführen — oder überspringen. Ändert sich der Akteur (Name, PLZ), wird er erneut aufgelöst.
        </p>
      </header>
      <table className="einst-tabelle imp-tabelle">
        <thead>
          <tr>
            <th>Zeile</th>
            <th>Akteur</th>
            <th>Fehler</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => (
            <Fragment key={z.id}>
              <tr className={offen === z.id ? "imp-nacharbeit-offen" : undefined}>
                <td className="kv--num">{z.zeilennummer}</td>
                <td>
                  {z.felder.akteur_name ?? "—"}
                  {z.felder.akteur_sitz_plz || z.felder.akteur_sitz_ort ? <span className="c"> · {[z.felder.akteur_sitz_plz, z.felder.akteur_sitz_ort].filter(Boolean).join(" ")}</span> : null}
                </td>
                <td className="c">
                  {(() => {
                    const liste = zuordnungsFehlerListe(z.felder);
                    const alle = liste.length > 0 ? liste : z.fehlergrund ? [z.fehlergrund] : [];
                    return alle.length > 0 ? alle.map((t, i) => <div key={i}>{t}</div>) : "—";
                  })()}
                  {hinweise(z.felder).map((h, i) => (
                    <div key={`h${i}`} className="imp-hinweis">
                      <i className="ph ph-info" aria-hidden /> {h}
                    </div>
                  ))}
                </td>
                <td>
                  {offen === z.id ? (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOffen(null)} disabled={laeuft}>
                      Abbrechen
                    </button>
                  ) : (
                    <span className="imp-aktionen">
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => oeffnen(z)} disabled={laeuft}>
                        Korrigieren
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => ueberspringen(z)} disabled={laeuft}>
                        Überspringen
                      </button>
                    </span>
                  )}
                </td>
              </tr>
              {offen === z.id && (
                <tr className="imp-nacharbeit-offen">
                  <td colSpan={4}>
                    <div className="imp-nacharbeit-form">
                      {felder.map((f) => (
                        <label key={f.key} className="pf">
                          <span>
                            {f.label}
                            {f.pflicht ? " *" : ""}
                            {z.felder[`${FEHLER_PREFIX}${f.key}`] && <span className="pf-fehler"> · {z.felder[`${FEHLER_PREFIX}${f.key}`]}</span>}
                          </span>
                          <span className="pf-feld">
                            {f.typ === "code" && f.werte ? (
                              <select value={werte[f.key] ?? ""} onChange={(e) => setWerte((alt) => ({ ...alt, [f.key]: e.target.value }))}>
                                <option value="">—</option>
                                {optionen[f.werte].map((o) => (
                                  <option key={o.code} value={o.code}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input type="text" value={werte[f.key] ?? ""} onChange={(e) => setWerte((alt) => ({ ...alt, [f.key]: e.target.value }))} />
                            )}
                          </span>
                        </label>
                      ))}
                      <div className="imp-aktionen">
                        <button type="button" className="btn btn--primary btn--sm" onClick={() => speichern(z)} disabled={laeuft}>
                          Speichern
                        </button>
                        {meldung && <span className="pf-fehler">{meldung}</span>}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}
