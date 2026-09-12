"use client";

import Link from "next/link";

import { KonfidenzPill } from "@/components/stroeme/Pillen";
import { farbeFuer } from "@/lib/farben";
import { fmtZahl } from "@/lib/format";
import type { KartePunkt } from "@/lib/karte-modell";

/**
 * Kompaktes Marker-Panel (PR 6, Eric-Spec): 32-px-Verlaufs-Orb des Clusters,
 * Bezeichnung, Akteur, Materialart/Output, Menge, Qualitaet und der Link ins
 * Register. Bewusst KEIN volles Detail — das lebt auf stroeme.
 */
export function MarkerPanel({
  punkt,
  onSchliessen,
}: {
  punkt: KartePunkt;
  onSchliessen: () => void;
}) {
  const farbe = farbeFuer(punkt.art, punkt.farbeKey);
  return (
    <aside className="km-panel" aria-label="Stromdetails">
      <span
        className="km-panel-orb"
        style={{
          background: `radial-gradient(circle at 30% 30%, color-mix(in srgb, ${farbe} 45%, white), ${farbe})`,
        }}
        aria-hidden
      />
      <div className="km-panel-text">
        <strong>{punkt.titel}</strong>
        <span className="c">{punkt.untertitel}</span>
        {punkt.ort && <span className="c">{punkt.ort}</span>}
        <span className="km-panel-menge">
          {punkt.menge > 0 ? `${fmtZahl(punkt.menge)} ${punkt.einheit}` : "–"}
          <KonfidenzPill stufe={punkt.qualitaet} />
        </span>
        <Link
          className="btn btn--sm"
          href={`/register?tab=${punkt.art === "biomasse" ? "biomasse" : "output"}&detail=${punkt.id}`}
        >
          <i className="ph ph-arrow-square-out" aria-hidden />
          Im Register öffnen
        </Link>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label="Schließen"
        onClick={onSchliessen}
      >
        <i className="ph ph-x" aria-hidden />
      </button>
    </aside>
  );
}
