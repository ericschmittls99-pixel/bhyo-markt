"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { updateUiCookie } from "@/lib/ui-state";
import { ROLLE_LABEL, type Rolle } from "@/lib/rollen";

const TITEL: [string, string][] = [
  ["/register", "ströme."],
  ["/karte", "karte."],
  ["/auswertung", "auswertung."],
  ["/bewertung", "planer."],
  ["/import", "import."],
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
 * Inbox ist ein Platzhalter (kein Benachrichtigungs-Modell im Schema, AP1i
 * Delta-Bericht §3) und zeigt den Leerzustand aus dem Mockup. Das Konto-Menue
 * traegt den Theme-Umschalter; Profil und Abmelden sind Mockup-Platzhalter.
 */
export function HeaderBar({
  email,
  rolle,
  initialTheme,
}: {
  email: string | null;
  rolle: Rolle | null;
  initialTheme: "light" | "dark";
}) {
  const pathname = usePathname();
  const [inboxOpen, setInboxOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [dark, setDark] = useState(initialTheme === "dark");
  const [toast, setToast] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onDown(ev: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) {
        setInboxOpen(false);
        setAccountOpen(false);
      }
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        setInboxOpen(false);
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
    setInboxOpen(false);
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
        <div className="pop-anchor">
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setInboxOpen((v) => !v);
              setAccountOpen(false);
            }}
            aria-haspopup="dialog"
            aria-expanded={inboxOpen}
            aria-label="Inbox"
          >
            <i className="ph ph-tray" aria-hidden />
          </button>
          {inboxOpen && (
            <div role="dialog" aria-label="Inbox" className="pop" style={{ width: 360 }}>
              <div className="pop-head">
                <h2>inbox.</h2>
                <button type="button" className="btn btn--ghost btn--sm" disabled>
                  Alle als gelesen markieren
                </button>
              </div>
              <div className="empty-state" style={{ padding: "24px 0 20px" }}>
                <span className="disc">
                  <i className="ph ph-tray" aria-hidden />
                </span>
                <h2>keine nachrichten.</h2>
                <p>Einladungen, Import-Berichte und Rollenänderungen landen hier.</p>
              </div>
            </div>
          )}
        </div>

        <div className="pop-anchor">
          <button
            type="button"
            className="avatar-btn"
            onClick={() => {
              setAccountOpen((v) => !v);
              setInboxOpen(false);
            }}
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
