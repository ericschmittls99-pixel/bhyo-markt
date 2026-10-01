"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Avatar } from "@/components/Avatar";
import { inboxAblehnen, inboxAlleErledigen, inboxErledigen, inboxGelesen, inboxUngelesen, inboxVerwerfen, inboxWeitergeben } from "@/lib/inbox/actions";
import { AUFGABE_MAX, AUFGABE_VORGABE } from "@/lib/inbox/aufgabe";
import { stromZuweisen } from "@/lib/sperre-actions";
import { stromReverifizieren } from "@/lib/stroeme-actions";
import type { InboxZeile } from "@/lib/inbox/server";

export type Zeile = InboxZeile & { zeit: string };

const ZUSTAND_LABEL = { erledigt: "erledigt", verworfen: "verworfen" } as const;

/**
 * Liste der Mitteilungen (AP2.2). Öffnen setzt „gelesen" und zeigt das
 * Detail-Panel auf dieser Seite (?detail=<strom>&sicht=…). Erledigt und
 * Verwerfen wirken sofort; „Als ungelesen markieren" sitzt im Menü. Die
 * tragende Prüfung (nur der Empfänger) sitzt in den Aktionen.
 */
const HINWEIS_TYPEN: readonly string[] = ["verifikation_laeuft_ab", "verifikation_abgelaufen"];
/** PR c (D5): Eintraege, die sich als Aufgabe weitergeben lassen — dieselbe Liste wie in lib/inbox/actions.ts. */
const WEITERGEBBAR: readonly string[] = ["pruefauftrag", "verifikation_laeuft_ab", "verifikation_abgelaufen"];

export interface WeitergabeEmpfaenger {
  id: string;
  name: string | null;
  email: string;
}

export function InboxListe({
  zeilen,
  zustand,
  darfReverifizieren = false,
  darfWeitergeben = false,
  empfaenger = [],
  ichId,
}: {
  zeilen: Zeile[];
  zustand: "offen" | "erledigt";
  /** PR b: Rollenstufe strom.reverifizieren (pruefer/admin) — nur zum Einblenden, serverseitig erneut geprueft. */
  darfReverifizieren?: boolean;
  /** PR c: Rollenstufe inbox.weitergeben (ab bearbeiter) — nur zum Einblenden. */
  darfWeitergeben?: boolean;
  /** PR c: aktive Nutzer mit Rolle >= bearbeiter; die eigene Person wird ausgeblendet (Server weist sie ohnehin ab). */
  empfaenger?: WeitergabeEmpfaenger[];
  ichId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [laeuft, starte] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  const [menue, setMenue] = useState<string | null>(null);
  // PR c: Weitergeben-Popover je Zeile — Empfaenger und Aufgabentext (vorbefuellt, frei aenderbar).
  const [weiterOffen, setWeiterOffen] = useState<string | null>(null);
  const [weiterAn, setWeiterAn] = useState("");
  const [weiterText, setWeiterText] = useState(AUFGABE_VORGABE);
  const listeRef = useRef<HTMLUListElement>(null);
  const moeglicheEmpfaenger = empfaenger.filter((e) => e.id !== ichId);
  const weiterTextOk = weiterText.trim().length > 0 && weiterText.trim().length <= AUFGABE_MAX;

  function weiterOeffnen(id: string) {
    setMenue(null);
    setWeiterAn(moeglicheEmpfaenger[0]?.id ?? "");
    setWeiterText(AUFGABE_VORGABE);
    setWeiterOffen((w) => (w === id ? null : id));
  }

  useEffect(() => {
    if (!menue && !weiterOffen) return;
    function onDown(ev: MouseEvent) {
      if (listeRef.current && !listeRef.current.contains(ev.target as Node)) {
        setMenue(null);
        setWeiterOffen(null);
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        setMenue(null);
        setWeiterOffen(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menue, weiterOffen]);

  function fuehreAus(aktion: () => Promise<{ ok: boolean; fehler?: string }>, danach?: () => void) {
    setMenue(null);
    setWeiterOffen(null);
    starte(async () => {
      const erg = await aktion();
      if (!erg.ok) {
        setFehler(erg.fehler ?? "Aktion fehlgeschlagen.");
        return;
      }
      setFehler(null);
      if (danach) danach();
      else router.refresh();
    });
  }

  function oeffnen(z: Zeile) {
    // AP2.5: Hinweise zum Akteur oeffnen die Akteur-Seite; alles andere das Detail-Panel hier.
    const p = new URLSearchParams(searchParams.toString());
    if (z.strom) {
      p.set("detail", z.strom.id);
      p.set("sicht", z.strom.art === "output" ? "outputs" : "feedstock");
    }
    const ziel = z.strom ? `/inbox?${p.toString()}` : z.akteur ? `/akteure/${z.akteur.id}` : "/inbox";
    if (z.gelesen) {
      router.push(ziel, { scroll: false });
      return;
    }
    fuehreAus(() => inboxGelesen(z.id), () => router.push(ziel, { scroll: false }));
  }

  return (
    <div className="ib-inhalt">
      {fehler && (
        <p className="ib-fehler" role="alert">
          {fehler}
        </p>
      )}
      <ul className="ib-liste" ref={listeRef} aria-busy={laeuft}>
        {zeilen.map((z) => (
          <li key={z.id} className={`ib-zeile${!z.gelesen && z.zustand === "offen" ? " ib-ungelesen" : ""}`}>
            <span className="ib-punkt" aria-label={!z.gelesen && z.zustand === "offen" ? "ungelesen" : undefined} />
            {z.ausloeser ? (
              <Avatar nutzer={z.ausloeser} groesse="s" />
            ) : (
              // PR b: Hinweis des taeglichen Jobs — kein Urheber, Kalender-Zeichen statt Avatar.
              <span className="avatar avatar--s ib-system" aria-label="Täglicher Hinweis" title="Täglicher Hinweis">
                <i className="ph ph-calendar-check" aria-hidden />
              </span>
            )}
            <span className="ib-textblock">
              <button type="button" className="ib-text" onClick={() => oeffnen(z)}>
                {z.text}
              </button>
              {z.typ === "zugriffsanfrage" && z.notiz && <span className="ib-notiz">„{z.notiz}"</span>}
            </span>
            {zustand === "erledigt" && z.zustand !== "offen" && (
              <span className={`pill pill--muted ib-zustand ib-zustand--${z.zustand}`}>{ZUSTAND_LABEL[z.zustand]}</span>
            )}
            <time className="ib-zeit" dateTime={z.aktualisiertAm} title={z.aktualisiertAm}>
              {z.zeit}
            </time>
            <span className="ib-aktionen">
              <button type="button" className="icon-btn" aria-label="Öffnen" title="Öffnen" onClick={() => oeffnen(z)}>
                <i className="ph ph-arrow-square-out" aria-hidden />
              </button>
              {/* PR c: Zugriffsanfrage — Zuweisen (dieselbe Aktion strom.zuweisen) oder Ablehnen. */}
              {/* PR c (D5): Weitergeben als Aufgabe — ab bearbeiter, nie an sich selbst; Text nicht leer, max. 500 (Server und DB). */}
              {z.zustand === "offen" && WEITERGEBBAR.includes(z.typ) && darfWeitergeben && moeglicheEmpfaenger.length > 0 && (
                <span className="pop-anchor">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    aria-haspopup="dialog"
                    aria-expanded={weiterOffen === z.id}
                    disabled={laeuft}
                    onClick={() => weiterOeffnen(z.id)}
                  >
                    <i className="ph ph-arrow-bend-up-right" aria-hidden />
                    Weitergeben
                  </button>
                  {weiterOffen === z.id && (
                    <div role="dialog" aria-label="Weitergeben" className="pop ov-anfrage ib-weiter">
                      <label className="ov-anfrage-label" htmlFor={`weiter-an-${z.id}`}>
                        An
                      </label>
                      <select id={`weiter-an-${z.id}`} className="ib-weiter-an" value={weiterAn} onChange={(ev) => setWeiterAn(ev.target.value)}>
                        {moeglicheEmpfaenger.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name ?? e.email}
                          </option>
                        ))}
                      </select>
                      <label className="ov-anfrage-label" htmlFor={`weiter-text-${z.id}`}>
                        Aufgabe
                      </label>
                      <textarea
                        id={`weiter-text-${z.id}`}
                        className="ov-anfrage-notiz"
                        rows={3}
                        maxLength={AUFGABE_MAX}
                        value={weiterText}
                        onChange={(ev) => setWeiterText(ev.target.value)}
                      />
                      <div className="ov-anfrage-fuss">
                        <span className="c">
                          {weiterText.trim().length}/{AUFGABE_MAX}
                        </span>
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setWeiterOffen(null)}>
                          Abbrechen
                        </button>
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={laeuft || !weiterTextOk || !weiterAn}
                          onClick={() => fuehreAus(() => inboxWeitergeben(z.id, weiterAn, weiterText))}
                        >
                          Weitergeben
                        </button>
                      </div>
                    </div>
                  )}
                </span>
              )}
              {/* PR b: Ablauf-Hinweis — „Erneut verifizieren" (nur Pruefer; serverseitig strom.reverifizieren). */}
              {z.zustand === "offen" && z.strom && HINWEIS_TYPEN.includes(z.typ) && darfReverifizieren && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={laeuft}
                  onClick={() => fuehreAus(() => stromReverifizieren(z.strom!.art, z.strom!.id))}
                >
                  Erneut verifizieren
                </button>
              )}
              {z.zustand === "offen" && z.typ === "zugriffsanfrage" && z.ausloeser && z.strom && (
                <>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={laeuft}
                    onClick={() => fuehreAus(() => stromZuweisen(z.strom!.art, z.strom!.id, z.ausloeser!.id))}
                  >
                    Zuweisen
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={laeuft}
                    onClick={() => fuehreAus(() => inboxAblehnen(z.id))}
                  >
                    Ablehnen
                  </button>
                </>
              )}
              {z.zustand === "offen" && z.typ !== "zugriffsanfrage" && (
                <>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Erledigt"
                    title="Erledigt"
                    onClick={() => fuehreAus(() => inboxErledigen(z.id))}
                  >
                    <i className="ph ph-check" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Verwerfen"
                    title="Verwerfen"
                    onClick={() => fuehreAus(() => inboxVerwerfen(z.id))}
                  >
                    <i className="ph ph-x" aria-hidden />
                  </button>
                  <span className="pop-anchor">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Weitere Aktionen"
                      aria-haspopup="menu"
                      aria-expanded={menue === z.id}
                      onClick={() => setMenue((m) => (m === z.id ? null : z.id))}
                    >
                      <i className="ph ph-dots-three" aria-hidden />
                    </button>
                    {menue === z.id && (
                      <div role="menu" className="pop ib-menue">
                        <button
                          type="button"
                          role="menuitem"
                          className="pop-item"
                          disabled={!z.gelesen}
                          onClick={() => fuehreAus(() => inboxUngelesen(z.id))}
                        >
                          <i className="ph ph-envelope" aria-hidden />
                          <span className="lbl">Als ungelesen markieren</span>
                        </button>
                      </div>
                    )}
                  </span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * „Alle erledigt" in der Kopfzeile — nur für reine Hinweise, nur offene, nur
 * eigene. Eigener Export: Eine Eigenschaft an der Client-Komponente ist aus
 * einer Server-Komponente heraus nicht erreichbar (Client-Referenz).
 */
export function AlleErledigt({ anzahlOffen }: { anzahlOffen: number }) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      disabled={anzahlOffen === 0 || laeuft}
      onClick={() =>
        starte(async () => {
          const erg = await inboxAlleErledigen();
          if (erg.ok) router.refresh();
        })
      }
    >
      <i className="ph ph-checks" aria-hidden />
      Alle erledigt
    </button>
  );
}
