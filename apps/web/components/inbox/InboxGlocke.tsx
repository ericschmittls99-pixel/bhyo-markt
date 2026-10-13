"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { inboxGelesen } from "@/lib/inbox/actions";
import type { InboxZeile } from "@/lib/inbox/server";
import { zielFuerZeile } from "@/lib/inbox/ziel";

import { InboxKurztext } from "./InboxKurztext";

type KurzZeile = InboxZeile & { zeit: string };

/**
 * E77 R5: Das Tray-Icon der Kopfzeile oeffnet ein Pop-up mit den letzten fuenf
 * offenen Mitteilungen in Kurzform und dem Knopf „Zur Inbox". Die Zeilen
 * kommen erst beim Oeffnen (GET /api/inbox/kurz), nicht mit jedem Seitenaufruf.
 * Esc und Klick ausserhalb schliessen; der Fokus wandert beim Oeffnen in das
 * Pop-up und beim Schliessen per Esc zurueck auf das Icon. Ein Klick auf eine
 * Zeile setzt „gelesen" und fuehrt zum Objekt — dasselbe Ziel wie in inbox.
 */
export function InboxGlocke({ ungelesen = 0 }: { ungelesen?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [zeilen, setZeilen] = useState<KurzZeile[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [, starte] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const knopfRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!offen) return;
    let aktiv = true;
    setZeilen(null);
    setFehler(null);
    fetch("/api/inbox/kurz", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as { zeilen: KurzZeile[] };
      })
      .then((d) => {
        if (aktiv) setZeilen(d.zeilen);
      })
      .catch(() => {
        if (aktiv) setFehler("Mitteilungen konnten nicht geladen werden.");
      });
    return () => {
      aktiv = false;
    };
  }, [offen]);

  useEffect(() => {
    if (!offen) return;
    function onDown(ev: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node))
        setOffen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        setOffen(false);
        knopfRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [offen]);

  // Fokus in das Pop-up: solange es laedt, auf den Rahmen; danach auf die erste Zeile bzw. „Zur Inbox".
  useEffect(() => {
    if (!offen || !popRef.current) return;
    const erstes =
      zeilen === null
        ? popRef.current
        : (popRef.current.querySelector<HTMLElement>("button, a") ??
          popRef.current);
    erstes.focus();
  }, [offen, zeilen]);

  function oeffnen(z: KurzZeile) {
    const ziel = zielFuerZeile(z);
    setOffen(false);
    if (z.gelesen) {
      router.push(ziel, { scroll: false });
      return;
    }
    starte(async () => {
      await inboxGelesen(z.id);
      router.push(ziel, { scroll: false });
    });
  }

  return (
    <div
      className="pop-anchor"
      ref={wrapRef}
      onBlur={(ev) => {
        // Tab aus dem Pop-up hinaus schliesst es (kein Fokus-Gefaengnis, aber kein verwaistes Pop-up).
        if (
          offen &&
          ev.relatedTarget instanceof Node &&
          !wrapRef.current?.contains(ev.relatedTarget)
        )
          setOffen(false);
      }}
    >
      <button
        ref={knopfRef}
        type="button"
        className="icon-btn hdr-inbox"
        aria-haspopup="dialog"
        aria-expanded={offen}
        aria-label={ungelesen > 0 ? `Inbox, ${ungelesen} ungelesen` : "Inbox"}
        title="inbox."
        onClick={() => setOffen((v) => !v)}
      >
        <i
          className={`${pathname.startsWith("/inbox") ? "ph-fill" : "ph"} ph-tray`}
          aria-hidden
        />
        {ungelesen > 0 && (
          <span className="hdr-badge">
            {ungelesen > 99 ? "99+" : ungelesen}
          </span>
        )}
      </button>
      {offen && (
        <div
          role="dialog"
          aria-label="Inbox"
          className="pop ib-pop"
          ref={popRef}
          tabIndex={-1}
        >
          <div className="pop-head">
            <h2>inbox.</h2>
            <span className="ib-pop-zaehler">
              {ungelesen > 0 ? `${ungelesen} ungelesen` : "nichts Ungelesenes"}
            </span>
          </div>
          {fehler ? (
            <p className="ib-pop-hinweis" role="alert">
              {fehler}
            </p>
          ) : zeilen === null ? (
            <p className="ib-pop-hinweis" aria-busy>
              Lädt …
            </p>
          ) : zeilen.length === 0 ? (
            <p className="ib-pop-hinweis">Keine offenen Mitteilungen.</p>
          ) : (
            <ul className="ib-pop-liste">
              {zeilen.map((z) => (
                <li key={z.id}>
                  <button
                    type="button"
                    className={`ib-pop-zeile${!z.gelesen ? " ib-ungelesen" : ""}`}
                    title={z.text}
                    onClick={() => oeffnen(z)}
                  >
                    <span
                      className="ib-punkt"
                      aria-label={!z.gelesen ? "ungelesen" : undefined}
                    />
                    <InboxKurztext z={z} />
                    <time className="ib-zeit" dateTime={z.aktualisiertAm}>
                      {z.zeit}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="pop-divider" />
          <Link
            href="/inbox"
            className="btn btn--primary btn--sm ib-pop-zur"
            onClick={() => setOffen(false)}
          >
            <i className="ph ph-tray" aria-hidden />
            Zur Inbox
          </Link>
        </div>
      )}
    </div>
  );
}
