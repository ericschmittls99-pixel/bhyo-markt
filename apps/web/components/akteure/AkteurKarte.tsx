"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";

/**
 * Karte des Akteurs (AP2.5 PR a1): Sitz-Pin (Waldgruen) und die Standorte
 * seiner Stroeme (Navy) unterscheidbar — nur Anzeige, kein Setzen (der Sitz
 * wird im Stammdaten-Formular bearbeitet, die Standorte am Strom).
 *
 * Sitz-Erfassung d (05.10.2026): MapLibre (gemessen 767 KB, 88 % des JS der
 * Seite) wird erst im Leerlauf nach der Hydration geladen, hinter einem
 * Platzhalter — die Seite ist vorher bedienbar, der Kartenaufbau blockiert
 * nicht die erste Interaktion.
 */
const OSM_STYLE = {
  version: 8 as const,
  sources: { osm: { type: "raster" as const, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap" } },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};
const START: [number, number] = [8.7, 49.3];

export function AkteurKarte({ sitz, standorte }: { sitz: { lng: number; lat: number } | null; standorte: { id: string; lng: number; lat: number; label: string }[] }) {
  const div = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [status, setStatus] = useState<"laedt" | "bereit">("laedt");
  useEffect(() => {
    let beendet = false;
    const start = async () => {
      if (beendet || !div.current || mapRef.current) return;
      const ml = await import("maplibre-gl");
      if (beendet || !div.current) return;
      const punkte = [...(sitz ? [sitz] : []), ...standorte];
      const map = new ml.Map({ container: div.current, style: OSM_STYLE as never, center: sitz ? [sitz.lng, sitz.lat] : punkte[0] ? [punkte[0].lng, punkte[0].lat] : START, zoom: punkte.length ? 10 : 7, attributionControl: { compact: true } });
      mapRef.current = map;
      if (sitz) new ml.Marker({ color: "#3A5412" }).setLngLat([sitz.lng, sitz.lat]).setPopup(new ml.Popup({ closeButton: false }).setText("Sitz")).addTo(map);
      for (const s of standorte) new ml.Marker({ color: "#1F2E38", scale: 0.8 }).setLngLat([s.lng, s.lat]).setPopup(new ml.Popup({ closeButton: false }).setText(s.label)).addTo(map);
      if (punkte.length > 1) {
        const b = new ml.LngLatBounds();
        for (const p of punkte) b.extend([p.lng, p.lat]);
        map.fitBounds(b, { padding: 40, maxZoom: 12 });
      }
      map.once("load", () => {
        if (!beendet) setStatus("bereit");
      });
    };
    // Leerlauf abwarten (Fallback: naechster Tick), hoechstens 1,5 s — dann
    // ist die Seite hydriert und bedienbar, bevor 767 KB Karte ausgewertet werden.
    const idle = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(() => void start(), { timeout: 1500 }) : null;
    const timer = idle == null ? setTimeout(() => void start(), 0) : null;
    return () => {
      beendet = true;
      if (idle != null) window.cancelIdleCallback(idle);
      if (timer != null) clearTimeout(timer);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="ak-karte" aria-label="Karte: Sitz und Standorte" aria-busy={status === "laedt"}>
      <div ref={div} className="ak-karte-flaeche" />
      {status === "laedt" && <span className="ak-karte-platzhalter">Karte lädt …</span>}
    </div>
  );
}
