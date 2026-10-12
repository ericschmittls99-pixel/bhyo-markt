"use client";

/**
 * E77 R2: „Filter entfernen" — ueberall gleich (E32) links neben dem
 * Filter-Knopf (stroeme., karte., auswertung.); in akteure. ohne Filter-Knopf
 * rechts in der Kopfzeile. Erscheint nur, wenn ein Filter gesetzt ist; das
 * Zuruecksetzen selbst kommt aus lib/filter-modell.ts (ruecksetzPatchAus).
 */
export function FilterEntfernen({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn--ghost btn--sm filter-entfernen" onClick={onClick}>
      <i className="ph-bold ph-x" aria-hidden />
      Filter entfernen
    </button>
  );
}
