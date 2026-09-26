"use client";

/** Löst den Browserdruck aus — daraus entsteht das PDF (F6 PR B). Nur am Bildschirm sichtbar. */
export function DruckenKnopf() {
  return (
    <button type="button" className="btn btn--primary btn--sm" onClick={() => window.print()}>
      <i className="ph ph-printer" aria-hidden />
      Drucken / als PDF sichern
    </button>
  );
}
