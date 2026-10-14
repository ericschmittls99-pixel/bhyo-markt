"use client";

/**
 * E77 R7 (Eric 14.10.2026): Zuschneide-Schritt vor dem Speichern des
 * Profilbilds. Runde Vorschau wie der Avatar, das Bild per Ziehen (Maus/Touch)
 * verschieben, Zoom 1×–3× per Regler, Pfeiltasten verschieben, + und − zoomen;
 * „Übernehmen" liefert den Ausschnitt in Quellpixeln, verkleinert wird danach
 * (ProfilEinstellung). Reines Canvas, keine Abhängigkeit: die Geometrie liegt
 * in lib/profil-bild (getestet), hier steht nur das Zeichnen und die Eingabe.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { type Ausschnitt, ZOOM_MAX, ZOOM_MIN, ZOOM_SCHRITT, klemmeMitte, klemmeZoom, zuschnittAusschnitt } from "@/lib/profil-bild";

/** Kantenlaenge der Vorschau in CSS-Pixeln; der Kreis ist eingeschrieben. */
export const ZUSCHNITT_VORSCHAU = 240;
/** Schritt der Pfeiltasten in Vorschau-Pixeln. */
const TASTEN_SCHRITT = 8;

export function ProfilbildZuschnitt({
  datei,
  onUebernehmen,
  onAbbrechen,
}: {
  datei: File;
  onUebernehmen: (ausschnitt: Ausschnitt) => void;
  onAbbrechen: () => void;
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [mitte, setMitte] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ziehen = useRef<{ zeigerId: number; startX: number; startY: number; mitteX: number; mitteY: number } | null>(null);

  // Bild dekodieren; die Mitte startet in der Bildmitte (= mittiges Quadrat wie bisher).
  useEffect(() => {
    let aktiv = true;
    let geladen: ImageBitmap | null = null;
    createImageBitmap(datei)
      .then((b) => {
        if (!aktiv) {
          b.close?.();
          return;
        }
        geladen = b;
        setBitmap(b);
        setMitte({ x: b.width / 2, y: b.height / 2 });
      })
      .catch(() => aktiv && setFehler("Das Bild lässt sich nicht lesen."));
    return () => {
      aktiv = false;
      geladen?.close?.();
    };
  }, [datei]);

  useEffect(() => {
    canvasRef.current?.focus();
  }, [bitmap]);

  // Zeichnen: Ausschnitt ins Quadrat, dann alles ausserhalb des Kreises abdunkeln.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap || !mitte) return;
    const dpr = typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1);
    const groesse = ZUSCHNITT_VORSCHAU;
    if (canvas.width !== groesse * dpr) {
      canvas.width = groesse * dpr;
      canvas.height = groesse * dpr;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, groesse, groesse);
    const a = zuschnittAusschnitt(bitmap.width, bitmap.height, zoom, mitte.x, mitte.y);
    ctx.drawImage(bitmap, a.x, a.y, a.kante, a.kante, 0, 0, groesse, groesse);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, groesse, groesse);
    ctx.arc(groesse / 2, groesse / 2, groesse / 2, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(31, 46, 56, 0.55)";
    ctx.fill("evenodd");
    // Ring wie beim Avatar xl (3 px Kartenflaeche), hier als Strich auf dem Canvas.
    ctx.beginPath();
    ctx.arc(groesse / 2, groesse / 2, groesse / 2 - 1.5, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.stroke();
    ctx.restore();
  }, [bitmap, zoom, mitte]);

  const verschiebe = useCallback(
    (dxVorschau: number, dyVorschau: number, basis?: { x: number; y: number }) => {
      if (!bitmap) return;
      setMitte((alt) => {
        const von = basis ?? alt;
        if (!von) return alt;
        const { kante } = zuschnittAusschnitt(bitmap.width, bitmap.height, zoom, von.x, von.y);
        const faktor = kante / ZUSCHNITT_VORSCHAU;
        return klemmeMitte(bitmap.width, bitmap.height, zoom, von.x - dxVorschau * faktor, von.y - dyVorschau * faktor);
      });
    },
    [bitmap, zoom],
  );

  const zoomen = useCallback(
    (neu: number) => {
      const z = klemmeZoom(neu);
      setZoom(z);
      if (bitmap) setMitte((alt) => (alt ? klemmeMitte(bitmap.width, bitmap.height, z, alt.x, alt.y) : alt));
    },
    [bitmap],
  );

  function uebernehmen() {
    if (!bitmap || !mitte) return;
    onUebernehmen(zuschnittAusschnitt(bitmap.width, bitmap.height, zoom, mitte.x, mitte.y));
  }

  return (
    <div className="modal-scrim" role="presentation" onClick={onAbbrechen}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="zuschnitt-titel"
        className="modal zuschnitt"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onAbbrechen();
          }
        }}
      >
        <h2 id="zuschnitt-titel">bildausschnitt wählen.</h2>
        <p>Bild ziehen, um es zu verschieben; Zoom über den Regler. Tastatur: Pfeiltasten verschieben, + und − zoomen.</p>
        {fehler ? (
          <p className="pf-fehler einst-fehler" role="alert">{fehler}</p>
        ) : (
          <>
            <div className="zuschnitt-buehne">
              <canvas
                ref={canvasRef}
                className="zuschnitt-vorschau"
                width={ZUSCHNITT_VORSCHAU}
                height={ZUSCHNITT_VORSCHAU}
                style={{ width: ZUSCHNITT_VORSCHAU, height: ZUSCHNITT_VORSCHAU }}
                tabIndex={0}
                role="img"
                aria-label="Vorschau des Bildausschnitts, rund wie der Avatar. Pfeiltasten verschieben, Plus und Minus zoomen."
                aria-busy={!bitmap}
                onPointerDown={(e) => {
                  if (!mitte) return;
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  e.currentTarget.focus();
                  ziehen.current = { zeigerId: e.pointerId, startX: e.clientX, startY: e.clientY, mitteX: mitte.x, mitteY: mitte.y };
                }}
                onPointerMove={(e) => {
                  const z = ziehen.current;
                  if (!z || z.zeigerId !== e.pointerId) return;
                  e.preventDefault();
                  verschiebe(e.clientX - z.startX, e.clientY - z.startY, { x: z.mitteX, y: z.mitteY });
                }}
                onPointerUp={(e) => {
                  if (ziehen.current?.zeigerId === e.pointerId) ziehen.current = null;
                }}
                onPointerCancel={() => {
                  ziehen.current = null;
                }}
                onKeyDown={(e) => {
                  const taste = e.key;
                  if (taste === "ArrowLeft") verschiebe(TASTEN_SCHRITT, 0);
                  else if (taste === "ArrowRight") verschiebe(-TASTEN_SCHRITT, 0);
                  else if (taste === "ArrowUp") verschiebe(0, TASTEN_SCHRITT);
                  else if (taste === "ArrowDown") verschiebe(0, -TASTEN_SCHRITT);
                  else if (taste === "+" || taste === "=") zoomen(zoom + ZOOM_SCHRITT);
                  else if (taste === "-" || taste === "_") zoomen(zoom - ZOOM_SCHRITT);
                  else return;
                  e.preventDefault();
                }}
              />
              {!bitmap && <span className="c zuschnitt-laden" role="status">Bild wird geladen …</span>}
            </div>
            <label className="zuschnitt-zoom">
              <span>Zoom</span>
              <input
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={0.01}
                value={zoom}
                aria-valuetext={`${zoom.toFixed(2)}-fach`}
                disabled={!bitmap}
                onChange={(e) => zoomen(Number(e.target.value))}
              />
              <span className="zuschnitt-zoom-wert">{zoom.toFixed(1)}×</span>
            </label>
          </>
        )}
        <div className="modal-aktionen">
          <button type="button" className="btn btn--ghost btn--sm" onClick={onAbbrechen}>
            Abbrechen
          </button>
          {!fehler && (
            <button type="button" className="btn btn--primary btn--sm" disabled={!bitmap} onClick={uebernehmen}>
              <i className="ph ph-check" aria-hidden />
              Übernehmen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
