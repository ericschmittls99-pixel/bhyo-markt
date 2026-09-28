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
export function usePopoverLage(schluessel: string | boolean | null) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [stil, setStil] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!el || !schluessel) {
      setStil({});
      return;
    }
    const messen = () => {
      const anker = el.parentElement?.getBoundingClientRect();
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
      setStil({
        left: lage.seite === "links" ? 0 : "auto",
        right: lage.seite === "rechts" ? 0 : "auto",
        maxWidth: lage.maxBreite,
        transform: lage.versatz ? `translateX(${Math.round(lage.versatz)}px)` : undefined,
      });
    };
    messen();
    window.addEventListener("resize", messen);
    return () => window.removeEventListener("resize", messen);
  }, [el, schluessel]);

  return { popRef: setEl, popStil: stil };
}
