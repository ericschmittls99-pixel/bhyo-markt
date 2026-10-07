"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Avatar, anzeigeName } from "@/components/Avatar";
import { fmtDatumZeit } from "@/lib/format";
import { enthaeltKontaktdaten } from "@/lib/import-zuordnung";
import { kommentarBearbeiten, kommentarErstellen, kommentarLoeschen } from "@/lib/kommentar-actions";
import { EHEMALIGER_NUTZER, KOMMENTAR_TEXT_MAX, kommentarSegmente, type ErwaehnterNutzer } from "@/lib/kommentar-marker";
import { KOMMENTAR_GELOESCHT, KOMMENTAR_HINWEIS, KONTAKTDATEN_WARNUNG, type Kommentar } from "@/lib/kommentar-modell";
import type { KommentarBezug } from "@/lib/kommentar-schreibweg";
import { darf, type Rolle } from "@/lib/rechte";

/**
 * AP2.6 PR b (E71): Abschnitt „kommentare." in Strom- und Akteur-Detail —
 * chronologisch, neuester unten, Zaehler in der Ueberschrift. Lesen alle
 * mit Zugang; schreiben ab bearbeiter (die Rechte kommen serverseitig aus der
 * Matrix und werden hier nur zum Ausblenden noch einmal gerechnet: eigene
 * Kommentare bearbeiten/loeschen, admin loescht fremde). Loeschen ist weich:
 * die Zeile bleibt als „Kommentar geloescht". Erwaehnungs-Marker werden mit
 * dem aktuellen Namen gezeigt, deaktivierte als „ehemaliger Nutzer"; die
 * @-Auswahl folgt in PR c. Unter dem Feld steht der Hinweis zu Kontaktdaten
 * Dritter; schlaegt das Muster des Imports an, warnt die Oberflaeche vor dem
 * Speichern, blockiert aber nicht.
 */
export function Kommentare({
  bezug,
  kommentare,
  zugang,
  darfErstellen,
}: {
  bezug: KommentarBezug;
  kommentare: Kommentar[];
  /** Wer liest — fuer die Objektregeln (eigener Kommentar) und Avatare; null = nur lesen. */
  zugang: { id: string; rolle: Rolle } | null;
  darfErstellen: boolean;
}) {
  const router = useRouter();
  const [offen, setOffen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [warnung, setWarnung] = useState<{ ziel: "neu" | string; fd: FormData } | null>(null);
  const [pending, start] = useTransition();

  function absenden(ziel: "neu" | string, fd: FormData, bestaetigt: boolean) {
    const text = String(fd.get("text") ?? "");
    if (!bestaetigt && enthaeltKontaktdaten(text)) {
      setWarnung({ ziel, fd });
      return;
    }
    setWarnung(null);
    start(async () => {
      const erg = ziel === "neu" ? await kommentarErstellen(bezug, fd) : await kommentarBearbeiten(ziel, fd);
      if (!erg.ok) {
        setFehler(erg.fehler ?? "Speichern fehlgeschlagen.");
        return;
      }
      setFehler(null);
      setOffen(null);
      router.refresh();
    });
  }
  function loeschen(id: string) {
    start(async () => {
      const erg = await kommentarLoeschen(id);
      setConfirm(null);
      if (!erg.ok) {
        setFehler(erg.fehler ?? "Löschen fehlgeschlagen.");
        return;
      }
      setFehler(null);
      router.refresh();
    });
  }

  const formular = (k: Kommentar | null) => {
    const ziel = k?.id ?? "neu";
    return (
      <form
        className="kom-formular"
        onSubmit={(e) => {
          e.preventDefault();
          absenden(ziel, new FormData(e.currentTarget), false);
        }}
      >
        <textarea
          className="kom-feld"
          name="text"
          rows={3}
          required
          maxLength={KOMMENTAR_TEXT_MAX}
          defaultValue={k?.text ?? ""}
          placeholder={k ? undefined : "Kommentar schreiben …"}
          aria-label={k ? "Kommentar bearbeiten" : "Neuer Kommentar"}
        />
        <span className="c kom-hinweis">{KOMMENTAR_HINWEIS}</span>
        {warnung && warnung.ziel === ziel && (
          <p className="kom-warnung" role="alert">
            <i className="ph ph-warning" aria-hidden />
            <span>{KONTAKTDATEN_WARNUNG}</span>
            <button type="button" className="btn btn--sm" disabled={pending} onClick={() => absenden(ziel, warnung.fd, true)}>
              Trotzdem speichern
            </button>
          </p>
        )}
        {fehler && (offen === ziel || (offen === null && ziel === "neu")) && (
          <p className="pf-fehler" role="alert">
            {fehler}
          </p>
        )}
        <div className="ak-aktionen kom-aktionen">
          <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>
            {k ? "Speichern" : "Kommentieren"}
          </button>
          {k && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => { setOffen(null); setFehler(null); setWarnung(null); }}>
              Abbrechen
            </button>
          )}
        </div>
      </form>
    );
  };

  return (
    <div className="kom">
      <h3 className="kom-titel">
        kommentare. <span className="kom-zaehler">({kommentare.length})</span>
      </h3>
      {kommentare.length === 0 ? (
        <p className="ov-note">Noch keine Kommentare.</p>
      ) : (
        <ol className="kom-liste">
          {kommentare.map((k) => {
            const nutzer = new Map<string, ErwaehnterNutzer>(k.erwaehnte.map((e) => [e.id, e]));
            const geloescht = k.geloeschtAm != null;
            const darfBearbeiten = !geloescht && !!zugang && darf(zugang, "kommentar.bearbeiten", { autorId: k.autor.id });
            const darfLoeschen = !geloescht && !!zugang && darf(zugang, "kommentar.loeschen", { autorId: k.autor.id });
            return (
              <li key={k.id} id={`kommentar-${k.id}`} className={`kom-eintrag${geloescht ? " kom-eintrag--geloescht" : ""}`}>
                <Avatar nutzer={k.autor} />
                <div className="kom-inhalt">
                  <div className="kom-kopf">
                    <span className="kom-autor">{k.autor.aktiv ? anzeigeName(k.autor) : EHEMALIGER_NUTZER}</span>
                    <span className="c kom-zeit">{fmtDatumZeit(k.erstelltAm)}</span>
                    {k.bearbeitetAm && !geloescht && (
                      <span className="pill pill--muted" title={`bearbeitet ${fmtDatumZeit(k.bearbeitetAm)}`}>
                        bearbeitet
                      </span>
                    )}
                  </div>
                  {offen === k.id ? (
                    formular(k)
                  ) : geloescht ? (
                    <p className="kom-text kom-text--geloescht">{KOMMENTAR_GELOESCHT}</p>
                  ) : (
                    <p className="kom-text">
                      {kommentarSegmente(k.text ?? "", nutzer).map((s, i) =>
                        s.art === "text" ? (
                          <span key={i}>{s.text}</span>
                        ) : (
                          <span key={i} className={`kom-erwaehnung${s.ehemalig ? " kom-erwaehnung--ehemalig" : ""}`}>
                            @{s.anzeige}
                          </span>
                        ),
                      )}
                    </p>
                  )}
                  {offen !== k.id && (darfBearbeiten || darfLoeschen) && (
                    <div className="kom-eintrag-aktionen">
                      {darfBearbeiten && (
                        <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => { setOffen(k.id); setFehler(null); setConfirm(null); }}>
                          Bearbeiten
                        </button>
                      )}
                      {darfLoeschen && confirm !== k.id && (
                        <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => setConfirm(k.id)}>
                          Löschen
                        </button>
                      )}
                      {darfLoeschen && confirm === k.id && (
                        <span className="ak-confirm">
                          <span>Kommentar löschen? Der Eintrag bleibt als „Kommentar gelöscht“ sichtbar.</span>
                          <button type="button" className="btn btn--primary btn--sm" disabled={pending} onClick={() => loeschen(k.id)}>
                            Ja, löschen
                          </button>
                          <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => setConfirm(null)}>
                            Abbrechen
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {darfErstellen && offen === null && formular(null)}
      {fehler && offen !== null && !kommentare.some((k) => k.id === offen) && (
        <p className="pf-fehler" role="alert">
          {fehler}
        </p>
      )}
    </div>
  );
}
