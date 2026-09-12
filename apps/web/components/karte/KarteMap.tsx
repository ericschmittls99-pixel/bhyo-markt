"use client";

import type {
  GeoJSONSource,
  LngLatBounds,
  Map as MlMap,
  Marker as MlMarker,
} from "maplibre-gl";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import { farbeFuer, ringFuer } from "@/lib/farben";
import {
  aggregiere,
  markerGroesse,
  maxMengeJe,
  qualitaetsRing,
  type KartePunkt,
} from "@/lib/karte-modell";

// Keyless OSM-Raster-Style (Kopie aus components/Karte.tsx — die bleibt fuer
// bewertung. bis PR 8 unveraendert stehen). Keine Lizenzkosten, kein API-Key;
// internes Werkzeug im Rahmen der OSM-Tile-Nutzungspolicy.
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

const AGG_RADIUS = 80;
const LIME = "#7DB535";

export interface KarteSteuerung {
  flyTo(lng: number, lat: number, zoom?: number): void;
  fitAlle(): void;
  fitRegion(regionId: string): void;
  zoomIn(): void;
  zoomOut(): void;
}

export interface KarteRegion {
  id: string;
  name: string;
  geojson: unknown;
  anzahl: number;
}

interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}
type Bbox = [number, number, number, number];

function polygonBounds(
  ml: { LngLatBounds: new () => LngLatBounds },
  geojson: unknown,
): LngLatBounds | null {
  const b = new ml.LngLatBounds();
  const sammle = (koord: unknown) => {
    if (
      Array.isArray(koord) &&
      koord.length >= 2 &&
      typeof koord[0] === "number" &&
      typeof koord[1] === "number"
    ) {
      b.extend([koord[0], koord[1]]);
      return;
    }
    if (Array.isArray(koord)) for (const k of koord) sammle(k);
  };
  const g = geojson as { coordinates?: unknown } | null;
  if (!g?.coordinates) return null;
  sammle(g.coordinates);
  return b.isEmpty() ? null : b;
}

/**
 * karte. (V2, PR 6): MapLibre-Flaeche mit Orb-Markern im Mockup-Look
 * (Verlaufs-Orb in Glas-Halo, ALLE rund — Review Eric, Groesse 12–38 px,
 * Qualitaets-Ring
 * A solid 2,5 / B solid 2 / C dashed / D dotted), Pixel-Aggregation mit
 * Zaehler und Hover-Faecher (Hauptorb bleibt stehen), Lime-Regionsumrissen
 * mit Glas-Labeln und Rechteck-Zeichnen. Zustand kommt von KarteAnsicht.
 */
export function KarteMap({
  punkte,
  regionen,
  regionenAus,
  aktivId,
  zeichnenAktiv,
  onPunktKlick,
  onRegionKlick,
  onAuswahl,
  auswahlBox,
  steuerungRef,
}: {
  punkte: KartePunkt[];
  regionen: KarteRegion[];
  regionenAus: string[];
  aktivId: string | null;
  zeichnenAktiv: boolean;
  onPunktKlick: (id: string) => void;
  onRegionKlick: (id: string) => void;
  onAuswahl: (bbox: Bbox, box: PixelBox) => void;
  /** Gewaehlte Box (Spotlight), solange der Zeichnen-Dialog offen ist. */
  auswahlBox: PixelBox | null;
  steuerungRef: MutableRefObject<KarteSteuerung | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<MlMarker[]>([]);
  const labelsRef = useRef<MlMarker[]>([]);
  const [ready, setReady] = useState(false);
  const [aufgefaechert, setAufgefaechert] = useState<string | null>(null);
  const [, setRenderTick] = useState(0);

  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [dragBox, setDragBox] = useState<PixelBox | null>(null);

  // Props in Refs spiegeln, damit die Marker-Neuzeichnung stabil bleibt.
  const zustand = useRef({ punkte, aktivId, aufgefaechert, onPunktKlick });
  zustand.current = { punkte, aktivId, aufgefaechert, onPunktKlick };

  useEffect(() => {
    let map: MlMap | null = null;
    let abgebrochen = false;
    (async () => {
      const ml = (await import("maplibre-gl")).default;
      if (abgebrochen || !containerRef.current) return;
      map = new ml.Map({
        container: containerRef.current,
        style: OSM_STYLE,
        center: [9.2, 48.8],
        zoom: 7,
        attributionControl: { compact: true },
      });
      map.on("load", () => {
        console.info("karte: maplibre load");
        setReady(true);
      });
      map.on("moveend", () => setRenderTick((t) => t + 1));
      // Kein stummer Fallback: MapLibre-Fehler (Style, Tiles, WebGL) landen
      // sonst nirgends — protokollieren, damit eine haengende Karte Ursache zeigt.
      map.on("error", (e) => console.error("karte: maplibre-Fehler", e.error ?? e));
      mapRef.current = map;

      steuerungRef.current = {
        flyTo: (lng, lat, zoom = 12) =>
          mapRef.current?.flyTo({ center: [lng, lat], zoom }),
        fitAlle: () => {
          const m = mapRef.current;
          if (!m) return;
          const b = new ml.LngLatBounds();
          for (const p of zustand.current.punkte) b.extend([p.lng, p.lat]);
          if (!b.isEmpty()) m.fitBounds(b, { padding: 80, maxZoom: 12 });
        },
        fitRegion: (regionId) => {
          const m = mapRef.current;
          const r = regionenRef.current.find((x) => x.id === regionId);
          if (!m || !r) return;
          const b = polygonBounds(ml, r.geojson);
          if (b) m.fitBounds(b, { padding: 80, maxZoom: 12 });
        },
        zoomIn: () => mapRef.current?.zoomIn(),
        zoomOut: () => mapRef.current?.zoomOut(),
      };
    })();
    return () => {
      abgebrochen = true;
      map?.remove();
      mapRef.current = null;
      steuerungRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const regionenRef = useRef(regionen);
  regionenRef.current = regionen;

  // Einmalig beim ersten Punkte-Satz auf alle Punkte zoomen.
  const initialGefittet = useRef(false);
  useEffect(() => {
    if (!ready || initialGefittet.current || punkte.length === 0) return;
    initialGefittet.current = true;
    steuerungRef.current?.fitAlle();
  }, [ready, punkte, steuerungRef]);

  // --- Marker mit Aggregation (neu bei Punkten, Zoom/Move, Faecher, aktiv) ---
  const zeichneMarker = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const ml = (await import("maplibre-gl")).default;
    if (mapRef.current !== map) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    const { punkte: pkt, aktivId: aktiv, aufgefaechert: faecher } = zustand.current;
    const maxJe = maxMengeJe(pkt);
    const px = pkt.map((p) => {
      const q = map.project([p.lng, p.lat]);
      return { x: q.x, y: q.y };
    });
    const gruppen = aggregiere(px, AGG_RADIUS);

    // Marker im Mockup-Look (Delta 1.4): Verlaufs-Orb in Cluster-/Gruppenfarbe
    // auf Glas-Halo; Form Kreis (Biomasse) / Raute (Output); Qualitaets-Ring
    // A solid 2,5 / B solid 2 / C dashed / D dotted auf dem Halo.
    const macheMarkerEl = (p: KartePunkt, size: number, badge?: number) => {
      const el = document.createElement("button");
      el.type = "button";
      el.title = badge ? `${badge} Ströme` : `${p.titel} · ${p.untertitel}`;
      el.className = "km-marker";
      const farbe = farbeFuer(p.art, p.farbeKey);
      const ring = qualitaetsRing(p.qualitaet);
      const ringFarbe = aktiv === p.id && !badge ? LIME : ringFuer(p.qualitaet);
      const halo = document.createElement("span");
      const orb = document.createElement("span");
      const haloGroesse = size + 10;
      el.style.width = `${haloGroesse}px`;
      el.style.height = `${haloGroesse}px`;
      halo.className = "km-halo";
      halo.style.borderWidth = `${ring.breite}px`;
      halo.style.borderStyle = ring.stil;
      halo.style.borderColor = ringFarbe;
      orb.className = "km-orb";
      orb.style.width = `${size}px`;
      orb.style.height = `${size}px`;
      // Echtes Orb-Verlaufsbild (public/orbs) wie im Grid/Detail — der
      // radiale Verlauf ist rotationssymmetrisch, die Raute rotiert einfach mit.
      orb.style.backgroundImage = `url(${p.orb})`;
      orb.style.backgroundSize = "cover";
      orb.style.backgroundColor = farbe;
      halo.appendChild(orb);
      el.appendChild(halo);
      if (badge && badge > 1) {
        const b = document.createElement("span");
        b.className = "km-badge";
        b.textContent = String(badge);
        el.appendChild(b);
      }
      return el;
    };

    for (const g of gruppen) {
      const mitglieder = g.indizes.map((i) => pkt[i]!);
      const gruppenKey = mitglieder.map((m) => m.id).join("|");

      if (mitglieder.length === 1) {
        const p = mitglieder[0]!;
        const size = markerGroesse(p.menge, maxJe.get(`${p.art}|${p.einheit}`) ?? 0);
        const el = macheMarkerEl(p, size);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          zustand.current.onPunktKlick(p.id);
        });
        markersRef.current.push(
          new ml.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map),
        );
        continue;
      }

      // Gruppe: gleicher art+farbeKey -> ein Orb mit Summe; gemischt -> Stapel.
      // Der Gruppen-Orb bleibt IMMER stehen (Mockup: Hover faechert die
      // NEBEN-Orbs auf, der Hauptorb verschwindet nicht); Klick zoomt hinein.
      const einheitlich = mitglieder.every(
        (m) => m.art === mitglieder[0]!.art && m.farbeKey === mitglieder[0]!.farbeKey,
      );
      const zentrum = map.unproject([g.x, g.y]);
      const reinzoomen = (e: Event) => {
        e.stopPropagation();
        const b = new ml.LngLatBounds();
        for (const m of mitglieder) b.extend([m.lng, m.lat]);
        map.fitBounds(b, { padding: 80, maxZoom: 14 });
      };

      let gruppenEl: HTMLElement;
      if (einheitlich) {
        const summe = mitglieder.reduce((s, m) => s + m.menge, 0);
        const p0 = mitglieder[0]!;
        const size = markerGroesse(
          summe,
          Math.max(summe, maxJe.get(`${p0.art}|${p0.einheit}`) ?? 0),
        );
        gruppenEl = macheMarkerEl(p0, size, mitglieder.length);
      } else {
        const groesstes = [...mitglieder].sort((a, b) => b.menge - a.menge)[0]!;
        const size = markerGroesse(
          groesstes.menge,
          maxJe.get(`${groesstes.art}|${groesstes.einheit}`) ?? 0,
        );
        gruppenEl = macheMarkerEl(groesstes, Math.max(size, 22), mitglieder.length);
        gruppenEl.classList.add("km-stapel");
        gruppenEl.addEventListener("mouseenter", () => setAufgefaechert(gruppenKey));
      }
      gruppenEl.addEventListener("click", reinzoomen);
      markersRef.current.push(
        new ml.Marker({ element: gruppenEl })
          .setLngLat([zentrum.lng, zentrum.lat])
          .addTo(map),
      );

      // Aufgefaecherte Mitglieder ZUSAETZLICH auf dem Bogen (-90° ± 60°).
      if (faecher === gruppenKey) {
        const radius = 52;
        mitglieder.forEach((p, idx) => {
          const size = markerGroesse(p.menge, maxJe.get(`${p.art}|${p.einheit}`) ?? 0);
          const el = macheMarkerEl(p, Math.min(size, 24));
          el.classList.add("km-faecher");
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            zustand.current.onPunktKlick(p.id);
          });
          const winkel =
            mitglieder.length === 1
              ? -Math.PI / 2
              : -Math.PI / 2 -
                Math.PI / 3 +
                ((Math.PI * 2) / 3) * (idx / (mitglieder.length - 1));
          const pos = map.unproject([
            g.x + Math.cos(winkel) * radius,
            g.y + Math.sin(winkel) * radius,
          ]);
          markersRef.current.push(
            new ml.Marker({ element: el }).setLngLat([pos.lng, pos.lat]).addTo(map),
          );
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void zeichneMarker();
  });

  // Faecher zuklappen, wenn die Maus die Karte verlaesst.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const zu = () => setAufgefaechert(null);
    node.addEventListener("mouseleave", zu);
    return () => node.removeEventListener("mouseleave", zu);
  }, []);

  // --- Regions-Layer (Lime-Umrisse, schwache Fuellung, Glas-Labels) ---------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const sichtbar = regionen.filter((r) => !regionenAus.includes(r.id));
    const data = {
      type: "FeatureCollection" as const,
      features: sichtbar
        .filter((r) => r.geojson != null)
        .map((r) => ({
          type: "Feature" as const,
          geometry: r.geojson as never,
          properties: { id: r.id, name: r.name },
        })),
    };
    const src = "km-regionen";
    const bestehend = map.getSource(src) as GeoJSONSource | undefined;
    if (bestehend) {
      bestehend.setData(data as never);
    } else {
      map.addSource(src, { type: "geojson", data: data as never });
      map.addLayer({
        id: "km-regionen-fill",
        type: "fill",
        source: src,
        paint: { "fill-color": LIME, "fill-opacity": 0.06 },
      });
      map.addLayer({
        id: "km-regionen-line",
        type: "line",
        source: src,
        paint: { "line-color": LIME, "line-width": 1.5 },
      });
    }

    // Glas-Label-Pillen am noerdlichsten Punkt jeder Region.
    void import("maplibre-gl").then((mod) => {
      const ml = mod.default;
      if (mapRef.current !== map) return;
      for (const l of labelsRef.current) l.remove();
      labelsRef.current = [];
      for (const r of sichtbar) {
        const b = polygonBounds(ml, r.geojson);
        if (!b) continue;
        const el = document.createElement("button");
        el.type = "button";
        el.className = "km-region-label";
        el.innerHTML = `<span>${r.name}</span><em>${r.anzahl}</em>`;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onRegionKlick(r.id);
        });
        labelsRef.current.push(
          new ml.Marker({ element: el, anchor: "bottom" })
            .setLngLat([(b.getWest() + b.getEast()) / 2, b.getNorth()])
            .addTo(map),
        );
      }
    });
  }, [regionen, regionenAus, ready, onRegionKlick]);

  // --- Zeichnen (Rechteck) ---------------------------------------------------
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
  }
  function onMove(e: React.MouseEvent) {
    if (!dragStart.current) return;
    setDragBox(boxAus(dragStart.current, rel(e)));
  }
  function onUp(e: React.MouseEvent) {
    const map = mapRef.current;
    if (!dragStart.current || !map) return;
    const box = boxAus(dragStart.current, rel(e));
    dragStart.current = null;
    setDragBox(null);
    if (box.width < 8 || box.height < 8) return; // versehentlicher Klick
    const p1 = map.unproject([box.left, box.top]);
    const p2 = map.unproject([box.left + box.width, box.top + box.height]);
    onAuswahl(
      [
        Math.min(p1.lng, p2.lng),
        Math.min(p1.lat, p2.lat),
        Math.max(p1.lng, p2.lng),
        Math.max(p1.lat, p2.lat),
      ],
      box,
    );
  }

  const box = auswahlBox ?? dragBox;

  return (
    <div className="km-wrap">
      <div ref={containerRef} className="km-flaeche" />

      {zeichnenAktiv && !auswahlBox && (
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

      {zeichnenAktiv && box && (
        <div
          className="karte-auswahl-tile"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      )}
    </div>
  );
}
