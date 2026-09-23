"use client";

import type {
  GeoJSONSource,
  Map as MlMap,
  Marker as MlMarker,
} from "maplibre-gl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import { farbeFuer, ringFarbeFuer } from "@/lib/farben";
import type { MapPunkt, RegionGebiet, RegionUmriss } from "@/lib/register";

// Keyless OSM-Raster-Style (keine Lizenzkosten, kein API-Key). Fuer das interne
// Werkzeug mit wenigen Nutzern im Rahmen der OSM-Tile-Nutzungspolicy.
const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap-Mitwirkende · © GeoBasis-DE / BKG (2026), dl-de/by-2-0",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

function markerGroesse(menge: number, maxMenge: number): number {
  if (maxMenge <= 0) return 14;
  return Math.round(12 + Math.sqrt(menge / maxMenge) * 26); // 12–38 px
}

type Bbox = [number, number, number, number];
interface Auswahl {
  box: { left: number; top: number; width: number; height: number };
  bbox: Bbox;
}

export function Karte({
  punkte,
  regionGebiet,
  regionUmrisse = [],
  basisStr,
  zeichnenAktiv = false,
  erstellenLabel = "Fokusregion erstellen",
  onErstellen,
}: {
  punkte: MapPunkt[];
  regionGebiet: RegionGebiet | null;
  regionUmrisse?: RegionUmriss[];
  basisStr: string;
  zeichnenAktiv?: boolean;
  erstellenLabel?: string;
  onErstellen?: (name: string, bbox: Bbox) => Promise<void>;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<MlMarker[]>([]);
  const [ready, setReady] = useState(false);

  // Draw-Zustand.
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [dragBox, setDragBox] = useState<Auswahl["box"] | null>(null);
  const [auswahl, setAuswahl] = useState<Auswahl | null>(null);
  const [name, setName] = useState("");
  const [speichert, setSpeichert] = useState(false);

  // Karte einmalig initialisieren (maplibre erst im Browser laden – SSR-sicher).
  useEffect(() => {
    let map: MlMap | null = null;
    let abgebrochen = false;
    (async () => {
      const ml = (await import("maplibre-gl")).default;
      if (abgebrochen || !containerRef.current) return;
      map = new ml.Map({
        container: containerRef.current,
        style: OSM_STYLE,
        center: [9.2, 48.5],
        zoom: 7,
        attributionControl: { compact: true },
      });
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => setReady(true));
      mapRef.current = map;
    })();
    return () => {
      abgebrochen = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Marker bei Punkt-Aenderung neu setzen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    const maxMenge = Math.max(1, ...punkte.map((p) => p.menge));
    void import("maplibre-gl").then((mod) => {
      const ml = mod.default;
      const bounds = new ml.LngLatBounds();
      for (const p of punkte) {
        const size = markerGroesse(p.menge, maxMenge);
        // Wrapper wird von maplibre positioniert (setzt transform); die Form
        // liegt in einem inneren Element, damit die Rauten-Rotation nicht mit
        // der Positionierung kollidiert.
        const el = document.createElement("button");
        el.type = "button";
        el.title = p.label;
        el.style.cssText = `width:${size}px;height:${size}px;padding:0;border:none;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;`;
        const shape = document.createElement("span");
        const gemein = `background:${farbeFuer(p.art, p.farbeKey)};border:1px solid color-mix(in srgb, ${ringFarbeFuer(
          // V1-Karte (BewertungPanel): kennt nur die Stufe — ohne Stufe
          // gilt "unbelegt". Der raeumliche Zustand "ausserhalb" ist der
          // V2-Karte vorbehalten (E24/E27).
          p.qualitaet ?? "unbelegt",
        )} 55%, transparent);box-shadow:0 1px 3px rgba(31,46,56,0.22);box-sizing:border-box;`;
        // Biomasse = Kreis, Output = Raute (rotiertes Quadrat, ~0.72*size, damit
        // die Diagonale wieder ~size ergibt). markerGroesse/Rahmen unveraendert.
        if (p.art === "output") {
          const d = Math.round(size * 0.72);
          shape.style.cssText = `width:${d}px;height:${d}px;border-radius:2px;transform:rotate(45deg);${gemein}`;
        } else {
          shape.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;${gemein}`;
        }
        el.appendChild(shape);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          router.push(`?${basisStr}&detail=${p.id}&art=${p.art}`);
        });
        const marker = new ml.Marker({ element: el })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
        markersRef.current.push(marker);
        bounds.extend([p.lng, p.lat]);
      }
      if (punkte.length && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 0 });
      }
    });
  }, [punkte, ready, basisStr, router]);

  // Alle Region-Umrisse als Rechteck-Linien.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = "region-umrisse";
    const data = {
      type: "FeatureCollection" as const,
      features: regionUmrisse.map((r) => ({
        type: "Feature" as const,
        geometry: r.geojson,
        properties: { name: r.name },
      })),
    };
    const bestehend = map.getSource(src) as GeoJSONSource | undefined;
    if (bestehend) {
      bestehend.setData(data as never);
      return;
    }
    map.addSource(src, { type: "geojson", data: data as never });
    map.addLayer({
      id: "region-umrisse-line",
      type: "line",
      source: src,
      paint: { "line-color": "#1F2E38", "line-width": 1.5, "line-opacity": 0.5 },
    });
  }, [regionUmrisse, ready]);

  // Gefilterte Region hervorheben (Fuellung).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = "region-gebiet";
    const data = regionGebiet
      ? { type: "Feature" as const, geometry: regionGebiet.geojson, properties: {} }
      : { type: "FeatureCollection" as const, features: [] };
    const bestehend = map.getSource(src) as GeoJSONSource | undefined;
    if (bestehend) {
      bestehend.setData(data as never);
      return;
    }
    map.addSource(src, { type: "geojson", data: data as never });
    map.addLayer({
      id: "region-gebiet-fill",
      type: "fill",
      source: src,
      paint: { "fill-color": "#8CC63F", "fill-opacity": 0.12 },
    });
    map.addLayer({
      id: "region-gebiet-line",
      type: "line",
      source: src,
      paint: { "line-color": "#3A5412", "line-width": 2 },
    });
  }, [regionGebiet, ready]);

  // Draw-Modus verlassen -> Auswahl verwerfen.
  useEffect(() => {
    if (!zeichnenAktiv) {
      setAuswahl(null);
      setDragBox(null);
      setName("");
    }
  }, [zeichnenAktiv]);

  function rel(e: React.MouseEvent) {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function boxAus(a: { x: number; y: number }, b: { x: number; y: number }) {
    return {
      left: Math.min(a.x, b.x),
      top: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }

  function onDown(e: React.MouseEvent) {
    dragStart.current = rel(e);
    setDragBox(null);
    setAuswahl(null);
  }
  function onMove(e: React.MouseEvent) {
    if (!dragStart.current) return;
    setDragBox(boxAus(dragStart.current, rel(e)));
  }
  function onUp(e: React.MouseEvent) {
    const map = mapRef.current;
    if (!dragStart.current || !map) return;
    const ende = rel(e);
    const box = boxAus(dragStart.current, ende);
    dragStart.current = null;
    setDragBox(null);
    if (box.width < 8 || box.height < 8) return; // versehentlicher Klick
    const p1 = map.unproject([box.left, box.top]);
    const p2 = map.unproject([box.left + box.width, box.top + box.height]);
    const bbox: Bbox = [
      Math.min(p1.lng, p2.lng),
      Math.min(p1.lat, p2.lat),
      Math.max(p1.lng, p2.lng),
      Math.max(p1.lat, p2.lat),
    ];
    setAuswahl({ box, bbox });
  }

  async function erstellen() {
    if (!auswahl || !name.trim() || !onErstellen) return;
    setSpeichert(true);
    try {
      await onErstellen(name.trim(), auswahl.bbox);
      setAuswahl(null);
      setName("");
    } finally {
      setSpeichert(false);
    }
  }

  const box = auswahl?.box ?? dragBox;

  return (
    <div className="karte-wrap">
      <div ref={containerRef} className="karte" />

      {zeichnenAktiv && !auswahl && (
        <div
          className="karte-draw-layer"
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
        >
          {dragBox && (
            <div
              className="karte-auswahl"
              style={{
                left: dragBox.left,
                top: dragBox.top,
                width: dragBox.width,
                height: dragBox.height,
              }}
            />
          )}
        </div>
      )}

      {/* Spotlight: Scrim ausserhalb der Auswahl, abgerundeter Rahmen um den Ausschnitt. */}
      {zeichnenAktiv && box && (
        <div
          className="karte-auswahl-tile"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      )}

      {/* Glas-Panel mit Name + Aktion, unter dem gezeichneten Ausschnitt. */}
      {zeichnenAktiv && auswahl && (
        <div
          className="karte-auswahl-panel card"
          style={{ left: auswahl.box.left, top: auswahl.box.top + auswahl.box.height + 8 }}
        >
          <input
            type="text"
            autoFocus
            placeholder="Name der Fokusregion"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!name.trim() || speichert}
              onClick={erstellen}
            >
              {speichert ? "…" : erstellenLabel}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setAuswahl(null);
                setName("");
              }}
            >
              Neu zeichnen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
