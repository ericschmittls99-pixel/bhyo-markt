"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useUrlZustand } from "@/components/stroeme/useUrlZustand";

/**
 * Toolbar von stroeme. (V2): SegmentedControl Feedstock/Outputs, SearchField
 * mit Clear, rechts die Primaeraktion. Der Tab-Wechsel setzt Filter und Detail
 * zurueck (je Tab eigener Filterzustand wie im Mockup).
 */
export function Toolbar({
  tab,
  q,
  canEdit,
}: {
  tab: "biomasse" | "output";
  q: string;
  canEdit: boolean;
}) {
  const { setze } = useUrlZustand();
  const [wert, setWert] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Externe Aenderung (Zuruecksetzen, Navigation) ins Feld uebernehmen.
  useEffect(() => setWert(q), [q]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function tippen(v: string) {
    setWert(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setze({ q: v }), 300);
  }

  const feed = tab === "biomasse";
  return (
    <div className="st-toolbar">
      <div className="seg" role="tablist" aria-label="Feedstock oder Outputs">
        <Link
          role="tab"
          href="/register?tab=biomasse"
          aria-selected={feed}
          className="seg-opt"
        >
          Feedstock
        </Link>
        <Link
          role="tab"
          href="/register?tab=output"
          aria-selected={!feed}
          className="seg-opt"
        >
          Outputs
        </Link>
      </div>
      <div className="search">
        <i className="ph ph-magnifying-glass" aria-hidden />
        <input
          type="search"
          value={wert}
          onChange={(e) => tippen(e.target.value)}
          placeholder={feed ? "Quelle, Ort, Materialart suchen" : "Abnehmer, Ort, Output suchen"}
          aria-label="Ströme durchsuchen"
        />
        {wert && (
          <button
            type="button"
            className="search-clear"
            aria-label="Suche leeren"
            onClick={() => {
              setWert("");
              setze({ q: null });
            }}
          >
            <i className="ph-bold ph-x" aria-hidden />
          </button>
        )}
      </div>
      <div className="st-toolbar-rechts">
        {canEdit && (
          <Link
            className="btn btn--primary btn--sm"
            href={`/register/${feed ? "biomasse" : "output"}/neu`}
          >
            <i className="ph-bold ph-plus" aria-hidden />
            {feed ? "Feedstock anlegen" : "Output anlegen"}
          </Link>
        )}
      </div>
    </div>
  );
}
