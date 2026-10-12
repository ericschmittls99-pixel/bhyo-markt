"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * E77 R2: einzeilige Chip-Leiste. Die Chips brechen nie um — reicht der Platz
 * nicht, scrollt die Zeile horizontal; eine Verlaufskante links/rechts zeigt,
 * dass dort noch etwas liegt (Daten-Attribute, CSS .chipleiste). Popover der
 * Chips haengen als Portal am Body (FacettenChips), die Zeile schneidet also
 * nichts ab. Ueberall gleich: stroeme., karte., auswertung., akteure. (E32).
 */
export function ChipLeiste({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [kanten, setKanten] = useState({ links: false, rechts: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const messen = () => {
      const links = el.scrollLeft > 1;
      const rechts = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setKanten((k) => (k.links === links && k.rechts === rechts ? k : { links, rechts }));
    };
    messen();
    el.addEventListener("scroll", messen, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(messen) : null;
    ro?.observe(el);
    const mo = new MutationObserver(messen);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", messen);
      ro?.disconnect();
      mo.disconnect();
    };
  }, []);
  return (
    <div className={`chipleiste${className ? ` ${className}` : ""}`} data-links={kanten.links || undefined} data-rechts={kanten.rechts || undefined}>
      <div id={id} className="chipleiste-scroll" ref={ref}>
        {children}
      </div>
    </div>
  );
}
