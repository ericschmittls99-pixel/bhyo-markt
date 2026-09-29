"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import {
  FILTER_PARAMS,
  leseSicht,
  zuVerwerfen,
  type Ansicht,
  type Sicht,
} from "@/lib/filter-modell";
import { updateUiCookie, type UiState } from "@/lib/ui-state";

interface NavKind {
  id: string;
  label: string;
  href: string;
  /** aktiv, wenn dieser Query-Parameter diesen Wert hat (bzw. fehlt bei defaultKind). */
  param: string;
  wert: string;
  defaultKind?: boolean;
}

interface NavEintrag {
  key: string;
  label: string;
  icon: string;
  href: string;
  kinder?: NavKind[];
  addLabel?: string;
  addHref?: string;
}

/**
 * Sidebar laut V2-Mockup: 264 px, einklappbar auf 72 px, Akkordeons fuer
 * stroeme. und planer. Zustand lebt im Cookie bhyo_ui (Ansage 5) — der Server
 * liefert den Initialwert, Klicks schreiben document.cookie.
 * Routen-Pfade bleiben unveraendert (Ansage 7), nur die Labels folgen dem Mockup.
 */
export function Sidebar({
  regionen,
  initial,
  ungelesen = 0,
}: {
  regionen: { id: string; name: string }[];
  initial: UiState;
  /** AP2.2: ungelesene Inbox-Eintraege — Zaehler-Badge; aktualisiert sich beim naechsten Seitenaufruf. */
  ungelesen?: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState(!!initial.sidebarZu);
  const [open, setOpen] = useState<string[]>(initial.akkordeons ?? []);

  // E32: Filter ueberleben JEDEN Ansichtswechsel — vorher trugen nur die
  // Links von karte. und auswertung. sie weiter, ein Wechsel aus oder nach
  // stroeme. verlor alles. Nicht geltende Filter bleiben gemerkt und wirken
  // in der Zielansicht nicht; nur ausdrueckliche Ausnahmen (zuVerwerfen)
  // fallen weg.
  const filterQuery = (ziel: Ansicht, zielSicht: Sicht, extra?: [string, string]) => {
    const raus = new Set(zuVerwerfen(ziel, zielSicht));
    const p = new URLSearchParams();
    for (const k of FILTER_PARAMS) {
      if (raus.has(k)) continue;
      const v = searchParams.get(k);
      if (v) p.set(k, v);
    }
    // Die Stromart gehoert mit: Wer auf Feedstock steht und auf die Karte
    // wechselt, will Feedstock sehen. `sicht` ist kein Datenfilter und
    // deshalb nicht in FILTER_PARAMS — mitgetragen wird sie trotzdem.
    const sicht = searchParams.get("sicht");
    if (sicht) p.set("sicht", sicht);
    if (extra) p.set(extra[0], extra[1]);
    return p.size ? `?${p.toString()}` : "";
  };

  // Die Sicht der Zielansicht: aus der Adresszeile, sonst der Standard.
  const { sicht: aktuelleSicht } = leseSicht(
    searchParams.get("sicht") ?? undefined,
    "feedstock",
  );

  const nav: NavEintrag[] = [
    {
      key: "stroeme",
      label: "ströme.",
      icon: "leaf",
      href: "/register",
      kinder: [
        {
          id: "feedstock",
          label: "Feedstock",
          href: `/register${filterQuery("stroeme", "feedstock", ["sicht", "feedstock"])}`,
          param: "sicht",
          wert: "feedstock",
          defaultKind: true,
        },
        {
          id: "outputs",
          label: "Outputs",
          href: `/register${filterQuery("stroeme", "outputs", ["sicht", "outputs"])}`,
          param: "sicht",
          wert: "outputs",
        },
      ],
    },
    {
      key: "karte",
      label: "karte.",
      icon: "map-trifold",
      href: `/karte${filterQuery("karte", aktuelleSicht)}`,
    },
    {
      key: "auswertung",
      label: "auswertung.",
      icon: "chart-bar",
      href: `/auswertung${filterQuery("auswertung", aktuelleSicht)}`,
    },
    {
      key: "planer",
      label: "planer.",
      icon: "calculator",
      href: "/bewertung",
      kinder: regionen.map((r) => ({
        id: r.id,
        label: r.name,
        href: `/bewertung?region=${r.id}`,
        param: "region",
        wert: r.id,
      })),
      addLabel: "Projekt starten",
      addHref: "/bewertung",
    },
    { key: "import", label: "import.", icon: "upload-simple", href: "/import" },
  ];

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    updateUiCookie({ sidebarZu: next });
  }

  function toggleGroup(key: string) {
    const next = open.includes(key) ? open.filter((k) => k !== key) : [...open, key];
    setOpen(next);
    updateUiCookie({ akkordeons: next });
  }

  const basisPfad = (href: string) => href.split("?")[0]!;
  const bereichAktiv = (e: NavEintrag) => pathname.startsWith(basisPfad(e.href));
  const kindAktiv = (e: NavEintrag, k: NavKind) => {
    if (!bereichAktiv(e)) return false;
    const wert = searchParams.get(k.param);
    return wert === k.wert || (!wert && !!k.defaultKind);
  };

  const settingsAktiv = pathname.startsWith("/einstellungen");
  const inboxAktiv = pathname.startsWith("/inbox");

  return (
    <aside aria-label="Seitennavigation" className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sb-brand">
        <img
          src="/logo/bhyo-mark-navy.svg"
          alt="bhyo Bildmarke"
          className="mark logo-light"
          height={32}
        />
        <img
          src="/logo/bhyo-mark-white.svg"
          alt="bhyo Bildmarke"
          className="mark logo-dark"
          height={32}
        />
        {!collapsed && (
          <>
            <img src="/logo/bhyo-wordmark-navy.svg" alt="bhyo." className="word logo-light" height={18} />
            <img src="/logo/bhyo-wordmark-white.svg" alt="bhyo." className="word logo-dark" height={18} />
          </>
        )}
        <span className="sb-toggle-wrap">
          <button
            type="button"
            className="icon-btn"
            onClick={toggleCollapsed}
            aria-pressed={collapsed}
            aria-label="Seitenleiste ein- oder ausblenden"
          >
            <i className="ph ph-sidebar-simple" aria-hidden />
          </button>
        </span>
      </div>

      <nav aria-label="Hauptbereiche" className="sb-nav">
        {nav.map((e) => {
          const aktiv = bereichAktiv(e);
          const irgendeinKindAktiv = !!e.kinder?.some((k) => kindAktiv(e, k));
          // Wie im Mockup: der Bereich selbst gilt nur ohne aktives Kind als
          // aktuell — sonst traegt allein das Kind die weisse Flaeche.
          const selbstAktiv = aktiv && !irgendeinKindAktiv;
          const exp = open.includes(e.key);
          const zeigeKinder = !!e.kinder && !collapsed;
          return (
            <div key={e.key} className="sb-group">
              <Link
                href={e.href}
                className="sb-item"
                title={collapsed ? e.label : undefined}
                aria-current={selbstAktiv ? "page" : undefined}
              >
                <i
                  className={`${selbstAktiv ? "ph-fill" : "ph"} ph-${e.icon}`}
                  aria-hidden
                />
                <span className="lbl">{e.label}</span>
              </Link>
              {zeigeKinder && (
                <button
                  type="button"
                  className="sb-caret"
                  aria-label="Untereinträge ein- oder ausklappen"
                  aria-expanded={exp}
                  aria-controls={`sb-kids-${e.key}`}
                  onClick={() => toggleGroup(e.key)}
                >
                  <i className="ph-bold ph-caret-right" aria-hidden />
                </button>
              )}
              {zeigeKinder && (
                <div id={`sb-kids-${e.key}`} className="sb-kids" data-closed={exp ? undefined : ""}>
                  <div>
                    {e.kinder!.map((k) => (
                      <Link
                        key={k.id}
                        href={k.href}
                        className="sb-kid"
                        aria-current={kindAktiv(e, k) ? "page" : undefined}
                        tabIndex={exp ? undefined : -1}
                      >
                        <span className="lbl">{k.label}</span>
                      </Link>
                    ))}
                    {e.addLabel && (
                      <Link href={e.addHref ?? e.href} className="sb-kid" tabIndex={exp ? undefined : -1}>
                        <i className="ph-bold ph-plus" aria-hidden />
                        <span className="lbl">{e.addLabel}</span>
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sb-foot">
        <Link
          href="/inbox"
          className="sb-item sb-item--badge"
          title={collapsed ? `inbox.${ungelesen ? ` (${ungelesen} ungelesen)` : ""}` : undefined}
          aria-current={inboxAktiv ? "page" : undefined}
        >
          <i className={`${inboxAktiv ? "ph-fill" : "ph"} ph-tray`} aria-hidden />
          <span className="lbl">inbox.</span>
          {ungelesen > 0 && (
            <span className="sb-badge" aria-label={`${ungelesen} ungelesen`}>
              {ungelesen > 99 ? "99+" : ungelesen}
            </span>
          )}
        </Link>
        <Link
          href="/einstellungen"
          className="sb-item"
          title={collapsed ? "einstellungen." : undefined}
          aria-current={settingsAktiv ? "page" : undefined}
        >
          <i className={`${settingsAktiv ? "ph-fill" : "ph"} ph-gear`} aria-hidden />
          <span className="lbl">einstellungen.</span>
        </Link>
      </div>
    </aside>
  );
}
