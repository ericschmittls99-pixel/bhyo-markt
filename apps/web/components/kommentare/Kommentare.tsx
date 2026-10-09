"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Avatar, anzeigeName } from "@/components/Avatar";
import { fmtDatumZeit } from "@/lib/format";
import { enthaeltKontaktdaten } from "@/lib/import-zuordnung";
import { kommentarBearbeiten, kommentarErstellen, kommentarLoeschen } from "@/lib/kommentar-actions";
import {
  type Erwaehnbar,
  anzeige,
  erwaehnungsAbfrage,
  fuegeTokenEin,
  markerZuTokens,
  tokenFuer,
  tokensZuMarkern,
  vorschlaege,
} from "@/lib/kommentar-eingabe";
import { EHEMALIGER_NUTZER, KOMMENTAR_TEXT_MAX, kommentarSegmente, type ErwaehnterNutzer } from "@/lib/kommentar-marker";
import { KOMMENTAR_GELOESCHT, KOMMENTAR_HINWEIS, KONTAKTDATEN_WARNUNG, type Kommentar } from "@/lib/kommentar-modell";
import type { KommentarBezug } from "@/lib/kommentar-schreibweg";
import { darf, type Rolle } from "@/lib/rechte";

/**
 * AP2.6 PR b/c (E71): Abschnitt „kommentare." in Strom- und Akteur-Detail —
 * chronologisch, neuester unten, Zaehler in der Ueberschrift. Lesen alle
 * mit Zugang; schreiben ab bearbeiter (die Rechte kommen serverseitig aus der
 * Matrix und werden hier nur zum Ausblenden noch einmal gerechnet: eigene
 * Kommentare bearbeiten/loeschen, admin loescht fremde). Loeschen ist weich:
 * die Zeile bleibt als „Kommentar geloescht".
 *
 * PR c: @-Auswahl vollstaendig per Tastatur — „@" oeffnet die Liste der
 * erwaehnbaren Nutzer (aktiv, ab bearbeiter; nie Kontaktpersonen, E57),
 * Pfeile waehlen, Enter/Tab uebernehmen, Escape schliesst. Im Feld steht
 * „@Name", gespeichert wird der Marker @[nutzer:<uuid>] (lib/kommentar-
 * eingabe.ts); der Server leitet die Erwaehnungen aus dem Text ab. Unter dem
 * Feld der Hinweis zu Kontaktdaten Dritter; schlaegt das Muster des Imports
 * an, warnt die Oberflaeche vor dem Speichern, blockiert aber nicht. Ein
 * Inbox-Link #kommentar-<id> rollt zum Eintrag und hebt ihn kurz hervor.
 */
export function Kommentare({
  bezug,
  kommentare,
  zugang,
  darfErstellen,
  erwaehnbare = [],
}: {
  bezug: KommentarBezug;
  kommentare: Kommentar[];
  /** Wer liest — fuer die Objektregeln (eigener Kommentar); null = nur lesen. */
  zugang: { id: string; rolle: Rolle } | null;
  darfErstellen: boolean;
  /** PR c: erwaehnbare Nutzer (wie ladeZuweisbare) — leer = keine @-Auswahl. */
  erwaehnbare?: Erwaehnbar[];
}) {
  const router = useRouter();
  const [offen, setOffen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [warnung, setWarnung] = useState<{ ziel: "neu" | string; markerText: string } | null>(null);
  const [pending, start] = useTransition();
  // Genau ein Feld ist offen (neu ODER ein Eintrag) — ein Entwurf reicht.
  const [text, setText] = useState("");
  const [tokens, setTokens] = useState<Map<string, string>>(new Map());
  const [abfrage, setAbfrage] = useState<{ start: number; abfrage: string } | null>(null);
  const [aktiv, setAktiv] = useState(0);
  const [cursorZiel, setCursorZiel] = useState<number | null>(null);
  const [ziel, setZiel] = useState<string | null>(null);
  const feldRef = useRef<HTMLTextAreaElement>(null);

  // Inbox-Link (#kommentar-<id>): hinrollen und hervorheben.
  useEffect(() => {
    const h = typeof window === "undefined" ? "" : window.location.hash;
    if (!h.startsWith("#kommentar-")) return;
    const el = document.getElementById(h.slice(1));
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    setZiel(h.slice("#kommentar-".length));
  }, [kommentare]);

  // Cursor nach dem Einfuegen eines Tokens hinter das Token setzen.
  useEffect(() => {
    if (cursorZiel == null || !feldRef.current) return;
    feldRef.current.focus();
    feldRef.current.setSelectionRange(cursorZiel, cursorZiel);
    setCursorZiel(null);
  }, [cursorZiel]);

  const treffer = abfrage ? vorschlaege(erwaehnbare, abfrage.abfrage) : [];

  function feldOeffnen(k: Kommentar | null) {
    if (k) {
      const r = markerZuTokens(k.text ?? "", new Map<string, ErwaehnterNutzer>(k.erwaehnte.map((e) => [e.id, e])));
      setText(r.text);
      setTokens(r.tokens);
    } else {
      setText("");
      setTokens(new Map());
    }
    setAbfrage(null);
    setWarnung(null);
    setFehler(null);
    setConfirm(null);
    setOffen(k?.id ?? null);
  }

  function waehle(n: Erwaehnbar) {
    if (!abfrage || !feldRef.current) return;
    const token = tokenFuer(n, tokens);
    const neu = new Map(tokens);
    neu.set(token, n.id);
    const r = fuegeTokenEin(text, abfrage.start, feldRef.current.selectionStart ?? text.length, token);
    setTokens(neu);
    setText(r.text);
    setAbfrage(null);
    setAktiv(0);
    setCursorZiel(r.cursor);
  }

  function onFeldChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setText(v);
    const a = erwaehnbare.length ? erwaehnungsAbfrage(v, e.target.selectionStart ?? v.length) : null;
    setAbfrage(a);
    if (!a) setAktiv(0);
  }

  function onFeldKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!abfrage || treffer.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAktiv((i) => (i + 1) % treffer.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAktiv((i) => (i - 1 + treffer.length) % treffer.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      waehle(treffer[Math.min(aktiv, treffer.length - 1)]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setAbfrage(null);
    }
  }

  // Text ist React-Zustand und wird nach Erfolg geleert; der Speichern-Knopf ist
  // waehrend `pending` gesperrt. Beides zusammen verhindert das doppelte Anlegen,
  // das PR b auf der Preview mit dem unkontrollierten Feld zeigte (§45).
  function absenden(zielId: "neu" | string, markerText: string, bestaetigt: boolean) {
    if (!bestaetigt && enthaeltKontaktdaten(markerText)) {
      setWarnung({ ziel: zielId, markerText });
      return;
    }
    setWarnung(null);
    const fd = new FormData();
    fd.set("text", markerText);
    start(async () => {
      const erg = zielId === "neu" ? await kommentarErstellen(bezug, fd) : await kommentarBearbeiten(zielId, fd);
      if (!erg.ok) {
        setFehler(erg.fehler ?? "Speichern fehlgeschlagen.");
        return;
      }
      setFehler(null);
      setOffen(null);
      setText("");
      setTokens(new Map());
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
    const zielId = k?.id ?? "neu";
    const listeId = `kom-vorschlaege-${zielId}`;
    return (
      <form
        className="kom-formular"
        onSubmit={(e) => {
          e.preventDefault();
          absenden(zielId, tokensZuMarkern(text, tokens), false);
        }}
      >
        <div className="kom-feld-huelle">
          <textarea
            ref={feldRef}
            className="kom-feld"
            name="text"
            rows={3}
            required
            maxLength={KOMMENTAR_TEXT_MAX}
            value={text}
            onChange={onFeldChange}
            onKeyDown={onFeldKey}
            onBlur={() => setTimeout(() => setAbfrage(null), 120)}
            placeholder={k ? undefined : "Kommentar schreiben … (@ erwähnt eine Kollegin oder einen Kollegen)"}
            aria-label={k ? "Kommentar bearbeiten" : "Neuer Kommentar"}
            aria-autocomplete={erwaehnbare.length ? "list" : undefined}
            aria-expanded={erwaehnbare.length ? !!abfrage && treffer.length > 0 : undefined}
            aria-controls={erwaehnbare.length ? listeId : undefined}
            aria-activedescendant={abfrage && treffer.length ? `${listeId}-${Math.min(aktiv, treffer.length - 1)}` : undefined}
          />
          {abfrage && treffer.length > 0 && (
            <ul className="kom-vorschlaege" role="listbox" id={listeId} aria-label="Erwähnbare Nutzer">
              {treffer.map((n, i) => (
                <li
                  key={n.id}
                  id={`${listeId}-${i}`}
                  role="option"
                  aria-selected={i === Math.min(aktiv, treffer.length - 1)}
                  className="kom-vorschlag"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    waehle(n);
                  }}
                  onMouseEnter={() => setAktiv(i)}
                >
                  <Avatar nutzer={n} />
                  <span className="kom-vorschlag-name">{anzeige(n)}</span>
                  <span className="c">{n.email}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="c kom-hinweis">{KOMMENTAR_HINWEIS}</span>
        {warnung && warnung.ziel === zielId && (
          <p className="kom-warnung" role="alert">
            <i className="ph ph-warning" aria-hidden />
            <span>{KONTAKTDATEN_WARNUNG}</span>
            <button type="button" className="btn btn--sm" disabled={pending} onClick={() => absenden(zielId, warnung.markerText, true)}>
              Trotzdem speichern
            </button>
          </p>
        )}
        {fehler && (offen === zielId || (offen === null && zielId === "neu")) && (
          <p className="pf-fehler" role="alert">
            {fehler}
          </p>
        )}
        <div className="ak-aktionen kom-aktionen">
          <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>
            {k ? "Speichern" : "Kommentieren"}
          </button>
          {k && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => feldOeffnen(null)}>
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
              <li
                key={k.id}
                id={`kommentar-${k.id}`}
                className={`kom-eintrag${geloescht ? " kom-eintrag--geloescht" : ""}${ziel === k.id ? " kom-eintrag--ziel" : ""}`}
              >
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
                        <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => feldOeffnen(k)}>
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
