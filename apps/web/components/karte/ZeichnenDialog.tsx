"use client";

import { useState } from "react";

import { fmtMenge } from "@/lib/format";
import { bboxKm } from "@/lib/karte-modell";

/**
 * Zwei-Schritt-Zeichnen-Dialog (PR 6): nach dem Rechteck erscheint das
 * Glas-Popup "Fokusregion erstellen" mit Meta (Stroeme im Ausschnitt,
 * Kantenlaengen), Namensfeld und "Anlegen". Escape bricht ab.
 */
export function ZeichnenDialog({
  box,
  bbox,
  anzahl,
  onAnlegen,
  onNeu,
  onAbbrechen,
}: {
  box: { left: number; top: number; width: number; height: number };
  bbox: [number, number, number, number];
  anzahl: number;
  onAnlegen: (name: string) => Promise<void>;
  onNeu: () => void;
  onAbbrechen: () => void;
}) {
  const [name, setName] = useState("");
  const [speichert, setSpeichert] = useState(false);
  const km = bboxKm(bbox);

  async function anlegen() {
    if (!name.trim() || speichert) return;
    setSpeichert(true);
    try {
      await onAnlegen(name.trim());
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Fokusregion erstellen"
      className="km-zeichnen-dialog"
      style={{
        left: Math.max(8, box.left),
        top: box.top + box.height + 10,
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onAbbrechen();
        if (e.key === "Enter") void anlegen();
      }}
    >
      <span className="km-zd-kicker">fokusregion.</span>
      <h2>Fokusregion erstellen</h2>
      <p className="km-zd-meta">
        {anzahl} {anzahl === 1 ? "Strom" : "Ströme"} im Ausschnitt ·{" "}
        {fmtMenge(Math.round(km.breite))} × {fmtMenge(Math.round(km.hoehe))} km
      </p>
      <label className="pf">
        <span>Name</span>
        <span className="pf-feld">
          <input
            type="text"
            autoFocus
            placeholder="z. B. Südpfalz West"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </span>
      </label>
      <div className="km-zd-aktionen">
        <button type="button" className="btn btn--sm" onClick={onNeu}>
          Neu zeichnen
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={!name.trim() || speichert}
          onClick={() => void anlegen()}
        >
          {speichert ? "Speichert…" : "Anlegen"}
        </button>
      </div>
    </div>
  );
}
