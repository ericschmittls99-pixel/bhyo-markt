"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Karte } from "@/components/Karte";
import { MapLegende } from "@/components/MapLegende";
import type { MapPunkt, RegionGebiet, RegionUmriss } from "@/lib/register";

/**
 * Karte inkl. „Fokusregion zeichnen"-Modus (Weg 1): Rechteck ziehen -> Name ->
 * sofort persistiert (POST /api/regionen), danach erscheint sie in Filter/
 * Bewertungs-Tab. Das Detail-Panel (Marker-Klick) bleibt unveraendert.
 */
export function KartePanel({
  punkte,
  regionGebiet,
  regionUmrisse,
  basisStr,
}: {
  punkte: MapPunkt[];
  regionGebiet: RegionGebiet | null;
  regionUmrisse: RegionUmriss[];
  basisStr: string;
}) {
  const router = useRouter();
  const [zeichnen, setZeichnen] = useState(false);
  // Nur Karten-UI-Zustand: welche Region-Umrisse ausgeblendet sind (Default: alle
  // sichtbar). Unabhaengig vom Region-Filter (der die Datenpunkte bestimmt).
  const [versteckt, setVersteckt] = useState<Set<string>>(new Set());
  const sichtbareUmrisse = regionUmrisse.filter((r) => !versteckt.has(r.id));

  function toggle(id: string) {
    setVersteckt((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function erstellen(name: string, bbox: [number, number, number, number]) {
    const res = await fetch("/api/regionen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, bbox }),
    });
    if (res.ok) {
      setZeichnen(false);
      router.refresh();
    }
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <button
          type="button"
          className={`btn${zeichnen ? " btn--primary" : ""}`}
          onClick={() => setZeichnen((v) => !v)}
        >
          {zeichnen ? "Zeichnen abbrechen" : "+ Fokusregion zeichnen"}
        </button>
        {zeichnen && (
          <span className="muted">
            Rechteck über den gewünschten Ausschnitt ziehen.
          </span>
        )}
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <Karte
          punkte={punkte}
          regionGebiet={regionGebiet}
          regionUmrisse={sichtbareUmrisse}
          basisStr={basisStr}
          zeichnenAktiv={zeichnen}
          onErstellen={erstellen}
        />
      </div>

      <MapLegende
        regionen={regionUmrisse}
        versteckt={versteckt}
        onToggle={toggle}
      />
    </>
  );
}
