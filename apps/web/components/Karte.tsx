"use client";

import type {
  GeoJSONSource,
  Map as MlMap,
  Marker as MlMarker,
} from "maplibre-gl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import { farbeFuer, ringFuer } from "@/lib/farben";
import type { MapPunkt, RegionKreis } from "@/lib/register";

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
      attribution: "© OpenStreetMap-Mitwirkende",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

/** Grosskreis-Polygon (km) fuer den Region-Radius. */
function kreisPolygon(lng: number, lat: number, radiusKm: number, steps = 64) {
  const R = 6371;
  const coords: [number, number][] = [];
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lng * Math.PI) / 180;
  const d = radiusKm / R;
  for (let i = 0; i <= steps; i++) {
    const brng = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
      );
    coords.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return {
    type: "Feature" as const,
    geometry: { type: "Polygon" as const, coordinates: [coords] },
    properties: {},
  };
}

function markerGroesse(menge: number, maxMenge: number): number {
  if (maxMenge <= 0) return 14;
  return Math.round(12 + Math.sqrt(menge / maxMenge) * 26); // 12–38 px
}

export function Karte({
  punkte,
  regionKreis,
  basisStr,
}: {
  punkte: MapPunkt[];
  regionKreis: RegionKreis | null;
  basisStr: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<MlMarker[]>([]);
  const [ready, setReady] = useState(false);

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
        center: [9.2, 48.5], // Baden-Württemberg
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
        const el = document.createElement("button");
        el.type = "button";
        el.title = p.label;
        el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;cursor:pointer;padding:0;background:${farbeFuer(
          p.art,
          p.farbeKey,
        )};border:3px solid ${ringFuer(p.qualitaet)};box-shadow:0 1px 4px rgba(0,0,0,.35);`;
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

  // Region-Radius als Kreis.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = "region-kreis";
    const data = regionKreis
      ? kreisPolygon(regionKreis.lng, regionKreis.lat, regionKreis.radiusKm)
      : { type: "FeatureCollection" as const, features: [] };

    const bestehend = map.getSource(src) as GeoJSONSource | undefined;
    if (bestehend) {
      bestehend.setData(data as never);
      return;
    }
    map.addSource(src, { type: "geojson", data: data as never });
    map.addLayer({
      id: "region-kreis-fill",
      type: "fill",
      source: src,
      paint: { "fill-color": "#8CC63F", "fill-opacity": 0.1 },
    });
    map.addLayer({
      id: "region-kreis-line",
      type: "line",
      source: src,
      paint: { "line-color": "#3A5412", "line-width": 2, "line-dasharray": [2, 1] },
    });
  }, [regionKreis, ready]);

  return <div ref={containerRef} className="karte" />;
}
