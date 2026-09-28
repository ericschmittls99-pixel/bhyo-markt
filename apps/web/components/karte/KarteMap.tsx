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

import {
  popoverZeilen,
  aggregiere,
  faecherLayout,
  fanStart,
  farbGruppen,
  gruppenGroesse,
  markerGroesse,
  maxMengeJe,
  partGroesse,
  ringStil,
  type KartePunkt,
} from "@/lib/karte-modell";

// Keyless OSM-Raster-Style (Kopie aus components/Karte.tsx — die bleibt fuer
// bewertung. bis PR 8 unveraendert stehen). Keine Lizenzkosten, kein API-Key;
// internes Werkzeug im Rahmen der OSM-Tile-Nutzungspolicy.
export const OSM_STYLE = {
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

/**
 * F2: Glas-Popover am Marker-Hover — ersetzt den nativen Browser-Tooltip
 * (unstyled, verzoegert, im Dark Mode systemfarben). Inhalt kommt aus der
 * reinen Funktion popoverZeilen; Sichtbarkeit steuert CSS (.km-pop).
 */
function machePopover(titel: string, zeilen: string[]): HTMLSpanElement {
  const pop = document.createElement("span");
  pop.className = "km-pop";
  const t = document.createElement("strong");
  t.className = "km-pop-titel";
  t.textContent = titel;
  pop.appendChild(t);
  for (const z of zeilen) {
    const zeile = document.createElement("span");
    zeile.className = "km-pop-zeile";
    zeile.textContent = z;
    pop.appendChild(zeile);
  }
  return pop;
}

const AGG_RADIUS = 80;
const LIME = "#7DB535";

export interface KarteSteuerung {
  flyTo(lng: number, lat: number, zoom?: number): void;
  fitAlle(sofort?: boolean): void;
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
  umrisseAn,
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
  /** Master-Toggle regionsumrisse. (Legende): alle Umrisse an oder aus. */
  umrisseAn: boolean;
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
  // Keyed Marker (Key = Typ + Mitglieds-IDs): beim Zoomen werden nur echte
  // Gruppierungswechsel neu gebaut — kein Voll-Redraw, kein Blinken.
  const markerMapRef = useRef(
    new Map<string, { marker: MlMarker; orbEl: HTMLElement; typ: string; punktId?: string }>(),
  );
  const labelsRef = useRef<MlMarker[]>([]);
  const regionTipRef = useRef<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);

  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [dragBox, setDragBox] = useState<PixelBox | null>(null);

  // Props in Refs spiegeln, damit die Marker-Neuzeichnung stabil bleibt.
  const zustand = useRef({ punkte, aktivId, onPunktKlick });
  zustand.current = { punkte, aktivId, onPunktKlick };

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
      // Aggregation laeuft schon WAEHREND des Zoomens (rAF-gedrosselt) —
      // Pan aendert Pixel-Abstaende nicht, zoom schon.
      let rafId = 0;
      map.on("zoom", () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          void zeichneMarkerRef.current?.();
        });
      });
      // Kein stummer Fallback: MapLibre-Fehler (Style, Tiles, WebGL) landen
      // sonst nirgends — protokollieren, damit eine haengende Karte Ursache zeigt.
      map.on("error", (e) => console.error("karte: maplibre-Fehler", e.error ?? e));
      mapRef.current = map;

      steuerungRef.current = {
        flyTo: (lng, lat, zoom = 12) =>
          mapRef.current?.flyTo({ center: [lng, lat], zoom }),
        fitAlle: (sofort?: boolean) => {
          const m = mapRef.current;
          if (!m) return;
          const b = new ml.LngLatBounds();
          for (const p of zustand.current.punkte) b.extend([p.lng, p.lat]);
          if (!b.isEmpty())
            m.fitBounds(b, {
              padding: 80,
              maxZoom: 12,
              // duration 0 fuer den Initial-Fit: die animierte Kamera haengt
              // sonst auf halbem Weg fest, wenn der Browser RAF drosselt
              // (verdecktes Fenster) — wie schon in der V1-Karte.
              ...(sofort ? { duration: 0 } : {}),
            });
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
    steuerungRef.current?.fitAlle(true);
  }, [ready, punkte, steuerungRef]);

  // --- Marker: 1:1 nach Mockup-addGroupMarker (single / agg / stack) ------
  // Keyed Diffing: bestehende Gruppen behalten ihre Marker (MapLibre bewegt
  // sie beim Zoomen selbst), nur Gruppierungswechsel bauen neu. Die Pop- und
  // Hover-Animationen liegen auf einem INNEREN Element — auf dem Wurzel-
  // element setzt MapLibre den Positions-Transform (sonst blitzt der Orb
  // waehrend der Animation oben links auf).
  const zeichneMarker = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const ml = (await import("maplibre-gl")).default;
    if (mapRef.current !== map) return;

    const { punkte: pkt, aktivId: aktiv } = zustand.current;
    const maxJe = maxMengeJe(pkt);
    const groessen: Record<string, number> = {};
    for (const p of pkt)
      groessen[p.id] = markerGroesse(p.menge, maxJe.get(`${p.art}|${p.einheit}`) ?? 0);
    const px = pkt.map((p) => {
      const q = map.project([p.lng, p.lat]);
      return { x: q.x, y: q.y };
    });
    // Mockup: ab Zoom 16 keine Aggregation mehr. Komponenten-Aggregation
    // (statt Mockup-greedy) haelt Gruppen beim Zoomen stabil — siehe
    // aggregiere in lib/karte-modell.
    const gruppen = aggregiere(px, map.getZoom() >= 16 ? 0 : AGG_RADIUS);
    const zentren = gruppen.map((g) => ({ x: g.x, y: g.y }));

    const fillEl = (orb: string) => {
      const f = document.createElement("span");
      f.className = "km-fill";
      f.style.backgroundImage = `url(${orb})`;
      return f;
    };
    const countEl = (n: number) => {
      const c = document.createElement("span");
      c.className = "km-count";
      c.textContent = String(n);
      return c;
    };
    const reinzoomen = (mit: KartePunkt[]) => {
      const b = new ml.LngLatBounds();
      for (const m of mit) b.extend([m.lng, m.lat]);
      map.fitBounds(b, { padding: 90, maxZoom: 16 });
    };

    const bestand = markerMapRef.current;
    const gesehen = new Set<string>();

    gruppen.forEach((g, gi) => {
      const mitglieder = g.indizes.map((i) => pkt[i]!);
      const parts = farbGruppen(mitglieder, groessen);
      const typ =
        mitglieder.length === 1 ? "single" : parts.length === 1 ? "agg" : "stack";
      const key = `${typ}|${mitglieder
        .map((m) => m.id)
        .sort()
        .join(",")}`;
      gesehen.add(key);
      // Zoomstabiles Zentrum wie im Mockup: Mittel der LngLat-Positionen.
      const zentrum: [number, number] = [
        mitglieder.reduce((n, m) => n + m.lng, 0) / mitglieder.length,
        mitglieder.reduce((n, m) => n + m.lat, 0) / mitglieder.length,
      ];

      const vorhanden = bestand.get(key);
      if (vorhanden) {
        vorhanden.marker.setLngLat(zentrum);
        return;
      }

      const D =
        mitglieder.length === 1
          ? (groessen[mitglieder[0]!.id] ?? 30)
          : gruppenGroesse(mitglieder.map((m) => groessen[m.id] ?? 30));
      const W = D + 12;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "km-marker";
      el.style.width = `${W}px`;
      el.style.height = `${W}px`;
      // Ueber den Regions-Labeln (Karten-Review: Label ueberlappte die Orbs).
      el.style.zIndex = "2";
      const orbEl = document.createElement("div");
      orbEl.className = "km-orb km-neu";
      el.appendChild(orbEl);
      const halo = document.createElement("span");
      halo.className = "km-halo";

      let punktId: string | undefined;
      if (typ === "single") {
        const p = mitglieder[0]!;
        punktId = p.id;
        const ring = ringStil(p.ringZustand);
        halo.style.border = `${ring.breite}px ${ring.stil} ${ring.farbe}`;
        if (p.id === aktiv) orbEl.classList.add("is-active");
        // Status im Popover statt Marker-Faerbung (Beschluss 22.09.2026),
        // seit F2 als Glas-Popover statt nativem Tooltip.
        const inhalt = popoverZeilen(p);
        el.append(machePopover(inhalt.titel, inhalt.zeilen));
        orbEl.append(halo, fillEl(p.orb));
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          zustand.current.onPunktKlick(p.id);
        });
      } else {
        // Aggregat (einfarbig wie gemischt): Hauptorb mit Zaehler; der
        // Hover-Preview faechert ALLE Belege der Gruppe als kleine Orbs auf
        // (Review Eric — nicht nur die aus anderen Clustern). Klick auf einen
        // kleinen Orb oeffnet dessen Panel, Klick auf den Hauptorb zoomt.
        orbEl.classList.add("km-stack");
        halo.style.border = "1.5px solid var(--glass-edge)";
        const pGr = partGroesse(D);
        const layout = faecherLayout(mitglieder.length, pGr, W / 2 + pGr / 2 + 4);
        // fanStart liefert den Start des freien 120°-Sektors; dessen Mitte
        // ist die freie Richtung — dort zentriert der Bogen, die Luecke
        // zeigt zu den Nachbar-Orbs (Review: nichts ueberschneiden).
        const freieMitte = fanStart(g, zentren.filter((_, i) => i !== gi)) + 60;
        const positionen = layout.sichtbar + (layout.mehr ? 1 : 0);
        const winkelVon = (i: number) => {
          if (layout.voll) return freieMitte + i * (360 / positionen);
          const spanne = (positionen - 1) * layout.schrittGrad;
          return freieMitte - spanne / 2 + i * layout.schrittGrad;
        };
        const machePart = (i: number) => {
          const deg = winkelVon(i);
          const a = (deg * Math.PI) / 180;
          const part = document.createElement("span");
          part.className = "km-part";
          part.style.width = `${pGr}px`;
          part.style.height = `${pGr}px`;
          part.style.left = `${(W - pGr) / 2}px`;
          part.style.top = `${(W - pGr) / 2}px`;
          part.style.zIndex = String(positionen - i);
          part.style.setProperty("--fx", `${Math.round(layout.radius * Math.cos(a))}px`);
          part.style.setProperty("--fy", `${Math.round(layout.radius * Math.sin(a))}px`);
          // Stagger: die Belege wachsen nacheinander aus dem Orb (smoother).
          part.style.setProperty("--verzug", `${i * 35}ms`);
          return part;
        };
        mitglieder.slice(0, layout.sichtbar).forEach((p, i) => {
          const part = machePart(i);
          part.title = [p.titel, p.untertitel, p.statusText]
            .filter(Boolean)
            .join(" · ");
          part.style.backgroundImage = `url(${p.orb})`;
          part.addEventListener("click", (e) => {
            e.stopPropagation();
            zustand.current.onPunktKlick(p.id);
          });
          orbEl.appendChild(part);
        });
        if (layout.mehr) {
          const rest = mitglieder.length - layout.sichtbar;
          const part = machePart(layout.sichtbar);
          part.classList.add("km-part--mehr");
          part.title = `${rest} weitere Ströme — hineinzoomen`;
          part.textContent = "…";
          part.addEventListener("click", (e) => {
            e.stopPropagation();
            reinzoomen(mitglieder);
          });
          orbEl.appendChild(part);
        }
        halo.style.zIndex = String(positionen + 1);
        const f0 = fillEl(parts[0]!.orb);
        f0.style.zIndex = String(positionen + 2);
        const c0 = countEl(mitglieder.length);
        c0.style.zIndex = String(positionen + 3);
        orbEl.append(halo, f0, c0);
        el.append(
          machePopover(`${mitglieder.length} Ströme`, ["hineinzoomen für Einzelheiten"]),
        );
        el.addEventListener("mouseenter", () => orbEl.classList.add("is-open"));
        el.addEventListener("mouseleave", () => orbEl.classList.remove("is-open"));
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          reinzoomen(mitglieder);
        });
      }

      const marker = new ml.Marker({ element: el }).setLngLat(zentrum).addTo(map);
      bestand.set(key, { marker, orbEl, typ, punktId });
    });

    // Verschwundene Gruppen entfernen, aktiv-Zustand der Singles angleichen.
    for (const [key, eintrag] of bestand) {
      if (!gesehen.has(key)) {
        eintrag.marker.remove();
        bestand.delete(key);
      } else if (eintrag.typ === "single") {
        eintrag.orbEl.classList.toggle("is-active", eintrag.punktId === aktiv);
      }
    }
  }, []);

  const zeichneMarkerRef = useRef<(() => Promise<void>) | null>(null);
  zeichneMarkerRef.current = zeichneMarker;

  // Punkte-Wechsel (Filter/sicht): alles verwerfen und frisch bauen.
  useEffect(() => {
    for (const [, e] of markerMapRef.current) e.marker.remove();
    markerMapRef.current.clear();
  }, [punkte]);

  useEffect(() => {
    if (!ready) return;
    void zeichneMarker();
  });

  // --- Regions-Layer (Lime-Umrisse, schwache Fuellung, Glas-Labels) ---------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const sichtbar = umrisseAn ? regionen : [];
    const data = {
      type: "FeatureCollection" as const,
      features: sichtbar
        .filter((r) => r.geojson != null)
        .map((r) => ({
          type: "Feature" as const,
          geometry: r.geojson as never,
          properties: { id: r.id, name: r.name, anzahl: r.anzahl },
        })),
    };
    const src = "km-regionen";
    const bestehend = map.getSource(src) as GeoJSONSource | undefined;
    if (bestehend) {
      bestehend.setData(data as never);
    } else {
      map.addSource(src, { type: "geojson", data: data as never });
      // Karten-Review 22.09.2026: Umrisse waren zu schwach — Fuellung und
      // Linie moderat angehoben (Region ist Datenmarkierung, kein Marker).
      // Farbe aus den Tokens (--bhyo-lime-500), damit Karte und Oberflaeche
      // dieselbe Quelle haben; LIME ist nur der Fallback ohne CSS.
      const lime =
        getComputedStyle(document.documentElement).getPropertyValue("--bhyo-lime-500").trim() || LIME;
      map.addLayer({
        id: "km-regionen-fill",
        type: "fill",
        source: src,
        paint: { "fill-color": lime, "fill-opacity": 0.09 },
      });
      map.addLayer({
        id: "km-regionen-line",
        type: "line",
        source: src,
        // F2: rundere Regionen (weiche Ecken statt spitzer Zacken); die
        // Geometrie selbst bleibt exakt (region.gebiet, keine Vereinfachung).
        // Rueckmeldung 1 (28.09.2026): Linie 1,5-fach (3 -> 4,5 px), damit
        // die Umrisse die Flaeche fuehren, ohne mit den Markern zu konkurrieren.
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": lime, "line-width": 4.5, "line-opacity": 1 },
      });

      // Rueckmeldung 1: kein Dauer-Label mehr. Der Regionsname erscheint als
      // Glas-Popover (wie am Marker) beim Ueberfahren der Flaeche, auf Touch
      // beim Antippen; per Tastatur ueber den fokussierbaren Anker (unten).
      const tip = machePopover("", []);
      tip.classList.add("km-region-tip");
      containerRef.current?.appendChild(tip);
      regionTipRef.current = tip;
      const zeige = (e: { point: { x: number; y: number }; features?: unknown[] }) => {
        const f = e.features?.[0] as { properties?: { name?: string; anzahl?: number } } | undefined;
        if (!f?.properties?.name) return;
        tip.replaceChildren(
          ...machePopover(f.properties.name, [`${f.properties.anzahl ?? 0} Ströme`]).childNodes,
        );
        tip.style.left = `${e.point.x}px`;
        tip.style.top = `${e.point.y}px`;
        tip.classList.add("is-open");
      };
      const verstecke = () => tip.classList.remove("is-open");
      map.on("mousemove", "km-regionen-fill", zeige);
      map.on("mouseleave", "km-regionen-fill", verstecke);
      map.on("click", "km-regionen-fill", zeige);
      map.on("click", (e) => {
        if (!map.queryRenderedFeatures(e.point, { layers: ["km-regionen-fill"] }).length) verstecke();
      });
    }

    // Unauffaelliger, fokussierbarer Anker am noerdlichsten Punkt jeder
    // Region (Tastatur: Fokus zeigt den Namen, Enter zoomt hinein). Ersetzt
    // die Glas-Label-Pille (Rueckmeldung 1, 28.09.2026).
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
        el.className = "km-region-anker";
        el.setAttribute("aria-label", `Region ${r.name}, ${r.anzahl} Ströme — hineinzoomen`);
        // Hinter die Strom-Marker (Karten-Review 22.09.2026).
        el.style.zIndex = "1";
        el.append(machePopover(r.name, [`${r.anzahl} Ströme`]));
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
  }, [regionen, umrisseAn, ready, onRegionKlick]);

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
