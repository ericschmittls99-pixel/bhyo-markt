"use client";

import { type CSSProperties, useLayoutEffect, useState } from "react";

import { popoverLage } from "@/lib/popover-lage";

/**
 * Wendet lib/popover-lage.ts auf ein geöffnetes Popover an (Rückmeldung 1,
 * 28.09.2026): misst nach dem Rendern Anker (Elternelement `.pop-anchor`) und
 * Popover, wählt die Seite und deckelt die Breite — vor dem ersten Anstrich
 * (Layout-Effekt), also ohne sichtbares Springen. Bei Fenstergröße-Änderung
 * wird neu gemessen. `schluessel` ist der geöffnete Zustand (z. B. Facetten-
 * Key); ändert er sich, wird neu gemessen.
 */
export function usePopoverLage(
  schluessel: string | boolean | null,
  /**
   * E77 R2: `fixiert` — das Popover haengt als Portal am Body (position:
   * fixed), damit eine horizontal scrollende Chip-Leiste es nicht abschneidet;
   * `anker` liefert dann das Ankerelement, Lage in Fensterkoordinaten, neu
   * gemessen bei Scrollen und Fenstergroesse.
   */
  optionen: { fixiert?: boolean; anker?: () => HTMLElement | null } = {},
) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [stil, setStil] = useState<CSSProperties>({});
  const { fixiert = false, anker: ankerFn } = optionen;

  useLayoutEffect(() => {
    if (!el || !schluessel) {
      setStil({});
      return;
    }
    const messen = () => {
      const anker = (fixiert ? ankerFn?.() : el.parentElement)?.getBoundingClientRect();
      if (!anker) return;
      // Natürliche Breite messen: ohne Deckel, sonst misst man den Deckel.
      const vorher = el.style.maxWidth;
      el.style.maxWidth = "";
      const popBreite = el.offsetWidth;
      el.style.maxWidth = vorher;
      const lage = popoverLage({
        ankerLinks: anker.left,
        ankerRechts: anker.right,
        popBreite,
        fensterBreite: document.documentElement.clientWidth,
      });
      const fensterBreite = document.documentElement.clientWidth;
      setStil({
        left: lage.seite === "links" ? (fixiert ? Math.round(anker.left) : 0) : "auto",
        right: lage.seite === "rechts" ? (fixiert ? Math.round(fensterBreite - anker.right) : 0) : "auto",
        top: fixiert ? Math.round(anker.bottom + 6) : undefined,
        maxWidth: lage.maxBreite,
        transform: lage.versatz ? `translateX(${Math.round(lage.versatz)}px)` : undefined,
      });
    };
    messen();
    window.addEventListener("resize", messen);
    if (fixiert) document.addEventListener("scroll", messen, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", messen);
      if (fixiert) document.removeEventListener("scroll", messen, { capture: true });
    };
  }, [el, schluessel, fixiert, ankerFn]);

  return { popRef: setEl, popStil: stil };
}
