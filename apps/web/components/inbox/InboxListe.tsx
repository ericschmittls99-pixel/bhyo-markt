"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Avatar } from "@/components/Avatar";
import { inboxAblehnen, inboxAlleErledigen, inboxErledigen, inboxGelesen, inboxUngelesen, inboxVerwerfen } from "@/lib/inbox/actions";
import { stromZuweisen } from "@/lib/sperre-actions";
import type { InboxZeile } from "@/lib/inbox/server";

export type Zeile = InboxZeile & { zeit: string };

const ZUSTAND_LABEL = { erledigt: "erledigt", verworfen: "verworfen" } as const;

/**
 * Liste der Mitteilungen (AP2.2). Öffnen setzt „gelesen" und zeigt das
 * Detail-Panel auf dieser Seite (?detail=<strom>&sicht=…). Erledigt und
 * Verwerfen wirken sofort; „Als ungelesen markieren" sitzt im Menü. Die
 * tragende Prüfung (nur der Empfänger) sitzt in den Aktionen.
 */
export function InboxListe({ zeilen, zustand }: { zeilen: Zeile[]; zustand: "offen" | "erledigt" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [laeuft, starte] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  const [menue, setMenue] = useState<string | null>(null);
  const listeRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!menue) return;
    function onDown(ev: MouseEvent) {
      if (listeRef.current && !listeRef.current.contains(ev.target as Node)) setMenue(null);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setMenue(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menue]);

  function fuehreAus(aktion: () => Promise<{ ok: boolean; fehler?: string }>, danach?: () => void) {
    setMenue(null);
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
    const p = new URLSearchParams(searchParams.toString());
    p.set("detail", z.strom.id);
    p.set("sicht", z.strom.art === "output" ? "outputs" : "feedstock");
    const ziel = `/inbox?${p.toString()}`;
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
            <Avatar nutzer={z.ausloeser} groesse="s" />
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
              {z.zustand === "offen" && z.typ === "zugriffsanfrage" && (
                <>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={laeuft}
                    onClick={() => fuehreAus(() => stromZuweisen(z.strom.art, z.strom.id, z.ausloeser.id))}
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
