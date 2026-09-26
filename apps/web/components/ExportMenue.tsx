"use client";

import { useEffect, useRef, useState } from "react";

import { type ExportModus, MODUS_SATZ } from "@/lib/export-modell";

/**
 * E36: EIN Export-Knopf in Toolbar (auswertung.) und Filterzeile (ströme.),
 * der ein kleines Menü öffnet: oben die Wahl extern/intern (voreingestellt
 * extern — wer alles sehen will, muss es bewusst wählen), darunter die
 * Ausgaben. Der interne Modus trägt einen sichtbaren Hinweis. „Drucken"
 * führt zur Druck-Route (F6 PR B).
 */
export function ExportMenue({
  exportParams,
  kompakt,
}: {
  /** Filter-Parameter, Sicht und Ansicht — der Modus kommt aus dem Menü. */
  exportParams: URLSearchParams;
  /** Nur Icon (Filterzeile) statt Icon + Text (Toolbar). */
  kompakt?: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const [modus, setModus] = useState<ExportModus>("extern");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!offen) return;
    function zu(ev: MouseEvent) {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOffen(false);
    }
    function esc(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOffen(false);
    }
    document.addEventListener("mousedown", zu);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", zu);
      document.removeEventListener("keydown", esc);
    };
  }, [offen]);

  const params = new URLSearchParams(exportParams);
  params.set("modus", modus);
  const csvHref = `/api/auswertung/export?${params}`;
  const druckHref = `/auswertung/druck?${params}`;

  return (
    <div className="pop-anchor" ref={ref}>
      <button
        type="button"
        className={`btn btn--sm${kompakt ? " btn--icon" : " aw-export"}`}
        aria-haspopup="menu"
        aria-expanded={offen}
        aria-label={kompakt ? "Export" : undefined}
        title={kompakt ? "Export" : undefined}
        onClick={() => setOffen((o) => !o)}
      >
        <i className="ph ph-download-simple" aria-hidden />
        {!kompakt && "Export"}
      </button>
      {offen && (
        <div role="menu" aria-label="Export" className="pop exp-pop">
          <div className="exp-modus" role="radiogroup" aria-label="Modus">
            {(["extern", "intern"] as const).map((m) => (
              <label key={m} className={`exp-modus-opt${modus === m ? " aktiv" : ""}`}>
                <input
                  type="radio"
                  name="export_modus"
                  value={m}
                  checked={modus === m}
                  onChange={() => setModus(m)}
                />
                <span className="exp-modus-text">
                  <span>{m === "extern" ? "extern" : "intern"}</span>
                  <span className="c">{MODUS_SATZ[m].replace(/^(extern|intern): /, "")}</span>
                </span>
              </label>
            ))}
          </div>
          {modus === "intern" && (
            <p className="exp-hinweis" role="note">
              Interne Datei: enthält nicht freigegebene Belegangaben und Abnehmernamen. Nicht weitergeben.
            </p>
          )}
          <div className="menu">
            <a className="menu-item" role="menuitem" href={csvHref} download onClick={() => setOffen(false)}>
              <i className="ph ph-file-csv" aria-hidden />
              <span className="lbl">CSV herunterladen</span>
              <span className="kurz">{modus}</span>
            </a>
            {/* F6 PR B: Druck-Route, gedruckt wird aus dem Browser als PDF. */}
            <a
              className="menu-item"
              role="menuitem"
              href={druckHref}
              target="_blank"
              rel="noopener"
              onClick={() => setOffen(false)}
            >
              <i className="ph ph-printer" aria-hidden />
              <span className="lbl">Drucken / PDF</span>
              <span className="kurz">{modus}</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
