import { orbSrc } from "./farben";
import type { Strom } from "./stroeme-modell";

/**
 * Reine Karten-Logik (AP1i PR 6) — ohne DOM-, MapLibre- oder DB-Zugriff.
 * Der Karten-Datenpfad laeuft ueber die getesteten PR-3-Mapper (ladeStroeme);
 * hier passiert nur noch die Ableitung fuer die Darstellung. Lehre aus PR 3:
 * keine stummen Fallbacks — unerwartete Formate werden protokolliert.
 */

export interface KartePunkt {
  id: string;
  art: "biomasse" | "output";
  lng: number;
  lat: number;
  /** Farbschluessel: materialart.cluster bzw. output_produkt.gruppe. */
  farbeKey: string;
  /** Orb-Verlaufsbild (public/orbs), Add-Ons je Produkt. */
  orb: string;
  /** Groessenbasis: menge_atro (Biomasse) bzw. menge_wert (Output). */
  menge: number;
  einheit: string;
  qualitaet: string | null;
  titel: string;
  untertitel: string;
  ort: string | null;
}

/** Strom → Kartenpunkt; null ohne Pin (legitim, kein Fehlerfall). */
export function stromZuPunkt(s: Strom): KartePunkt | null {
  if (s.lng == null || s.lat == null) return null;
  const feed = s.art === "biomasse";
  return {
    id: s.id,
    art: s.art,
    lng: s.lng,
    lat: s.lat,
    farbeKey: (feed ? s.cluster : s.gruppe) ?? "unbekannt",
    orb: orbSrc(s),
    menge: (feed ? s.mengeAtro : s.mengeWert) ?? 0,
    einheit: feed ? "t atro/a" : (s.mengeEinheit ?? ""),
    qualitaet: s.qualitaet,
    titel: s.akteurName ?? s.bezeichnung ?? "–",
    untertitel: (feed ? s.materialartLabel : s.produktLabel) ?? "",
    ort: s.ort,
  };
}

/** Markerdurchmesser 30–62 px (Mockup sizeOf: 30 + 32·√v, v geclampt 0–1). */
export function markerGroesse(menge: number, maxMenge: number): number {
  const v = Math.max(0, menge) / (maxMenge || 1);
  return Math.round(30 + 32 * Math.sqrt(Math.min(1, v)));
}

/** Gruppen-Durchmesser (Mockup): √(Σ D²), gedeckelt auf 72. */
export function gruppenGroesse(groessen: number[]): number {
  return Math.min(72, Math.round(Math.sqrt(groessen.reduce((n, d) => n + d * d, 0))));
}

/** Faecher-Part (Mockup): 55 % des Gruppen-D, geclampt 22–36. */
export function partGroesse(d: number): number {
  return Math.max(22, Math.min(36, Math.round(d * 0.55)));
}

/** Maximum je `${art}|${einheit}` — Outputs skalieren je Einheit getrennt. */
export function maxMengeJe(punkte: KartePunkt[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of punkte) {
    const k = `${p.art}|${p.einheit}`;
    m.set(k, Math.max(m.get(k) ?? 0, p.menge));
  }
  return m;
}

/**
 * Qualitaets-Ring EXAKT wie die Mockup-RING-Konstante — er sitzt auf dem
 * grossen Glas-Halo (Orb-Bild 6 px eingerueckt), dadurch wirken 2–2,5 px
 * dort richtig. Rampe navy-900/700/500/300, keine Ampel.
 */
export function qualitaetsRing(q: string | null): {
  breite: number;
  stil: "solid" | "dashed" | "dotted";
  farbe: string;
} {
  switch (q) {
    case "A":
      return { breite: 2.5, stil: "solid", farbe: "#1f2e38" };
    case "B":
      return { breite: 2, stil: "solid", farbe: "#3c4a52" };
    case "C":
      return { breite: 2, stil: "dashed", farbe: "#6c7a81" };
    case "D":
      return { breite: 2, stil: "dotted", farbe: "#a3acb1" };
    default:
      return { breite: 1.5, stil: "solid", farbe: "rgba(31,46,56,0.18)" };
  }
}

// --- Aggregation ---------------------------------------------------------

export interface PixelPunkt {
  x: number;
  y: number;
}

export interface AggGruppe {
  x: number;
  y: number;
  indizes: number[];
}

/**
 * Aggregation als Zusammenhangskomponenten (Kante bei Pixel-Abstand <= R).
 * BEWUSSTE Abweichung vom Mockup-greedy (clusterize): Komponenten sind
 * monoton unter wachsendem Radius — beim Zoomen verschmelzen/trennen sich
 * nur GANZE Gruppen, ein Randpunkt springt nie einzeln in eine fremde
 * Gruppe (Erics Stabilitaets-Anforderung, Review 6). Radius 0 (Zoom >= 16)
 * = keine Aggregation. Zentrum = Mittelwert.
 */
export function aggregiere(px: PixelPunkt[], radius = 80): AggGruppe[] {
  const n = px.length;
  const besucht = new Array<boolean>(n).fill(false);
  const gruppen: AggGruppe[] = [];
  for (let i = 0; i < n; i++) {
    if (besucht[i]) continue;
    besucht[i] = true;
    const mitglieder = [i];
    if (radius > 0) {
      for (let idx = 0; idx < mitglieder.length; idx++) {
        const a = px[mitglieder[idx]!]!;
        for (let j = 0; j < n; j++) {
          if (besucht[j]) continue;
          const b = px[j]!;
          if (Math.hypot(a.x - b.x, a.y - b.y) <= radius) {
            besucht[j] = true;
            mitglieder.push(j);
          }
        }
      }
    }
    mitglieder.sort((a, b) => a - b);
    gruppen.push({
      x: mitglieder.reduce((s, k) => s + px[k]!.x, 0) / mitglieder.length,
      y: mitglieder.reduce((s, k) => s + px[k]!.y, 0) / mitglieder.length,
      indizes: mitglieder,
    });
  }
  return gruppen;
}

/**
 * Faecher-Startwinkel (Mockup fanStart): waehlt den 120°-Sektor, der am
 * weitesten von Nachbar-Orbs (< 260 px) entfernt liegt; ohne Nachbarn −100°.
 */
export function fanStart(g: PixelPunkt, nachbarn: PixelPunkt[]): number {
  const nah = nachbarn.filter((o) => Math.hypot(o.x - g.x, o.y - g.y) < 260);
  if (!nah.length) return -100;
  let best = -100;
  let bestScore = -Infinity;
  for (let start = -180; start < 180; start += 15) {
    const mitte = ((start + 60) * Math.PI) / 180;
    const mx = Math.cos(mitte);
    const my = Math.sin(mitte);
    const score =
      nah.reduce((min, o) => {
        const dx = o.x - g.x;
        const dy = o.y - g.y;
        const d = Math.hypot(dx, dy) || 1;
        return Math.min(min, d * (1 - (dx * mx + dy * my) / d));
      }, Infinity) - (start === -100 ? 0 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }
  return best;
}

export interface FarbGruppe {
  orb: string;
  mitglieder: KartePunkt[];
  flaeche: number;
}

/** Parts eines Stapels (Mockup): je Orb-Bild gruppiert, nach Flaeche sortiert. */
export function farbGruppen(
  mitglieder: KartePunkt[],
  groessen: Record<string, number>,
): FarbGruppe[] {
  const je = new Map<string, FarbGruppe>();
  for (const p of mitglieder) {
    const g = je.get(p.orb) ?? { orb: p.orb, mitglieder: [], flaeche: 0 };
    g.mitglieder.push(p);
    const d = groessen[p.id] ?? 0;
    g.flaeche += d * d;
    je.set(p.orb, g);
  }
  return [...je.values()].sort((a, b) => b.flaeche - a.flaeche);
}

// --- Bbox-Mathe (Zeichnen-Dialog) -----------------------------------------

const KM_JE_GRAD = 111.2;

export function bboxKm(bbox: [number, number, number, number]): {
  breite: number;
  hoehe: number;
} {
  const [w, s, o, n] = bbox;
  const mittlereLat = ((s + n) / 2) * (Math.PI / 180);
  return {
    breite: (o - w) * KM_JE_GRAD * Math.cos(mittlereLat),
    hoehe: (n - s) * KM_JE_GRAD,
  };
}

export function punkteInBbox(
  punkte: KartePunkt[],
  bbox: [number, number, number, number],
): number {
  const [w, s, o, n] = bbox;
  return punkte.filter(
    (p) => p.lng >= w && p.lng <= o && p.lat >= s && p.lat <= n,
  ).length;
}

// --- Suche -----------------------------------------------------------------

export interface KarteTreffer {
  typ: "strom" | "region" | "ort";
  label: string;
  meta: string;
  id?: string;
  lng?: number;
  lat?: number;
}

/** Suche ueber geladene Punkte, Regionen und Orte — kein Geocoding. */
export function sucheKarte(
  punkte: KartePunkt[],
  regionen: { id: string; name: string }[],
  q: string,
): KarteTreffer[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const treffer: KarteTreffer[] = [];

  for (const r of regionen) {
    if (r.name.toLowerCase().includes(s))
      treffer.push({ typ: "region", id: r.id, label: r.name, meta: "Fokusregion" });
  }

  const orte = new Set<string>();
  for (const p of punkte) {
    const hay = `${p.titel} ${p.untertitel} ${p.ort ?? ""}`.toLowerCase();
    if (hay.includes(s)) {
      treffer.push({
        typ: "strom",
        id: p.id,
        label: p.titel,
        meta: [p.untertitel, p.ort].filter(Boolean).join(" · "),
        lng: p.lng,
        lat: p.lat,
      });
    }
    if (p.ort && p.ort.toLowerCase().includes(s) && !orte.has(p.ort)) {
      orte.add(p.ort);
      treffer.push({ typ: "ort", label: p.ort, meta: "Ort", lng: p.lng, lat: p.lat });
    }
  }

  return treffer.slice(0, 8);
}

// --- GeoJSON ----------------------------------------------------------------

/**
 * ST_AsGeoJSON kommt je nach Treiber als Text oder geparstes Objekt an —
 * eine sql<T>-Annotation ist keine Konvertierung (Lehre aus PR 3).
 */
export function geojsonOderNull(v: unknown, kontext: string): unknown | null {
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as unknown;
    } catch {
      console.error(`Unerwartetes GeoJSON (${kontext}):`, v);
      return null;
    }
  }
  if (v != null && typeof v === "object") return v;
  console.error(`Unerwartetes GeoJSON (${kontext}):`, v);
  return null;
}
