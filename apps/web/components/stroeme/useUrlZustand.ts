"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * Datenfilter leben im Querystring (Ansage 5): mehrwertige Facetten
 * kommagetrennt, leere Werte verschwinden aus der URL. `replace` fuer
 * Filter/Sortierung (kein History-Spam), `push` fuer Detail oeffnen/schliessen.
 */
export function useUrlZustand() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setze = useCallback(
    (
      patch: Record<string, string | string[] | null>,
      modus: "replace" | "push" = "replace",
    ) => {
      const p = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) {
          p.delete(k);
        } else {
          p.set(k, Array.isArray(v) ? v.join(",") : v);
        }
      }
      const ziel = p.size ? `${pathname}?${p.toString()}` : pathname;
      if (modus === "push") router.push(ziel, { scroll: false });
      else router.replace(ziel, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return { setze, searchParams };
}
