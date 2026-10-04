"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { updateUiCookie } from "@/lib/ui-state";
import { ROLLE_LABEL, type Rolle } from "@/lib/rechte";

const TITEL: [string, string][] = [
  ["/register", "ströme."],
  ["/karte", "karte."],
  ["/auswertung", "auswertung."],
  ["/bewertung", "planer."],
  ["/akteure", "akteure."],
  ["/import", "import."],
  ["/inbox", "inbox."],
  ["/einstellungen", "einstellungen."],
];

function initialen(email: string | null): string {
  if (!email) return "?";
  const name = email.split("@")[0] ?? "";
  const teile = name.split(/[._-]+/).filter(Boolean);
  const buchstaben = teile.slice(0, 2).map((t) => t[0]!.toUpperCase());
  return buchstaben.join("") || name.slice(0, 2).toUpperCase() || "?";
}

/**
 * Kopfzeile laut V2-Mockup: Seitentitel links, rechts Inbox und Konto-Menue.
 * Die Inbox ist seit AP2.2 echt: das Tray-Icon fuehrt zu inbox. und traegt
 * den Zaehler der ungelesenen Eintraege (frueher ein Platzhalter-Popover).
 * Das Konto-Menue traegt den Theme-Umschalter; Profil und Abmelden sind
 * Mockup-Platzhalter.
 */
export function HeaderBar({
  email,
  rolle,
  initialTheme,
  ungelesen = 0,
}: {
  email: string | null;
  rolle: Rolle | null;
  initialTheme: "light" | "dark";
  /** AP2.2: ungelesene Inbox-Eintraege (Zaehler am Tray-Icon). */
  ungelesen?: number;
}) {
  const pathname = usePathname();
  const [accountOpen, setAccountOpen] = useState(false);
  const [dark, setDark] = useState(initialTheme === "dark");
  const [toast, setToast] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onDown(ev: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) {
        setAccountOpen(false);
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        setAccountOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function zeigeToast(msg: string) {
    setAccountOpen(false);
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    updateUiCookie({ theme: next ? "dark" : "light" });
  }

  const titel = TITEL.find(([pfad]) => pathname.startsWith(pfad))?.[1] ?? "";
  const name = email ? (email.split("@")[0] ?? email) : "nicht angemeldet";

  return (
    <header className="hdr">
      <h1>{titel}</h1>
      <div className="hdr-actions" ref={wrapRef}>
        <Link
          href="/inbox"
          className="icon-btn hdr-inbox"
          aria-label={ungelesen > 0 ? `Inbox, ${ungelesen} ungelesen` : "Inbox"}
          title="inbox."
        >
          <i className={`${pathname.startsWith("/inbox") ? "ph-fill" : "ph"} ph-tray`} aria-hidden />
          {ungelesen > 0 && <span className="hdr-badge">{ungelesen > 99 ? "99+" : ungelesen}</span>}
        </Link>

        <div className="pop-anchor">
          <button
            type="button"
            className="avatar-btn"
            onClick={() => setAccountOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            aria-label="Konto"
          >
            <span className="avatar">{initialen(email)}</span>
          </button>
          {accountOpen && (
            <div role="dialog" aria-label="Konto" className="pop" style={{ width: 320 }}>
              <div className="pop-account-head">
                <span className="avatar avatar--md">{initialen(email)}</span>
                <span className="who">
                  <span className="name">{name}</span>
                  <span className="mail">{email ?? "—"}</span>
                  {/* F8/E30: Rollen-Pille wie in ap1i-delta-v2.md — jetzt mit
                      echter Rolle aus der Datenbank statt als Platzhalter. */}
                  {rolle && <span className="konf konf--rolle">{ROLLE_LABEL[rolle]}</span>}
                </span>
              </div>
              <div className="pop-divider" />
              <button
                type="button"
                className="pop-item"
                onClick={() => zeigeToast("Das Profil folgt im nächsten Schritt.")}
              >
                <i className="ph ph-user" aria-hidden />
                <span className="lbl">Profil</span>
              </button>
              <button
                type="button"
                className="pop-item"
                role="menuitemcheckbox"
                aria-checked={dark}
                onClick={toggleTheme}
              >
                <i className="ph ph-moon" aria-hidden />
                <span className="lbl">Dunkles Design</span>
                <span
                  className="toggle toggle--sm"
                  role="presentation"
                  aria-checked={dark}
                  style={{ pointerEvents: "none" }}
                />
              </button>
              <div className="pop-divider" />
              <button
                type="button"
                className="pop-item"
                onClick={() => zeigeToast("Abmelden folgt mit dem Log-in.")}
              >
                <i className="ph ph-sign-out" aria-hidden />
                <span className="lbl">Abmelden</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className="toast" role="status">
          <i className="ph ph-info" aria-hidden />
          {toast}
        </div>
      )}
    </header>
  );
}
