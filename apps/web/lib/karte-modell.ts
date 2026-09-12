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
    menge: (feed ? s.mengeAtro : s.mengeWert) ?? 0,
    einheit: feed ? "t atro/a" : (s.mengeEinheit ?? ""),
    qualitaet: s.qualitaet,
    titel: s.akteurName ?? s.bezeichnung ?? "–",
    untertitel: (feed ? s.materialartLabel : s.produktLabel) ?? "",
    ort: s.ort,
  };
}

/** Markerdurchmesser 12–38 px, Flaeche ~ Menge (Wurzel-Skala). */
export function markerGroesse(menge: number, maxMenge: number): number {
  if (maxMenge <= 0) return 14;
  return Math.round(12 + Math.sqrt(Math.max(0, menge) / maxMenge) * 26);
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
 * Qualitaets-Ring der Marker (Mockup, Delta 1.4): A solid 2,5 / B solid 2 /
 * C dashed / D dotted; ohne Bewertung dezenter 1-px-Rand. Farbe kommt aus
 * QUALITAET_RING (Navy-Rampe, keine Ampel).
 */
export function qualitaetsRing(q: string | null): {
  breite: number;
  stil: "solid" | "dashed" | "dotted";
} {
  switch (q) {
    case "A":
      return { breite: 2.5, stil: "solid" };
    case "B":
      return { breite: 2, stil: "solid" };
    case "C":
      return { breite: 1.5, stil: "dashed" };
    case "D":
      return { breite: 1.5, stil: "dotted" };
    default:
      return { breite: 1, stil: "solid" };
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
 * Verschmilzt Punkte, deren Pixel-Abstand unter dem Radius liegt, transitiv
 * zu Gruppen (BFS). Gruppenzentrum = Mittelwert der Mitglieder.
 */
export function aggregiere(px: PixelPunkt[], radius = 80): AggGruppe[] {
  const n = px.length;
  const besucht = new Array<boolean>(n).fill(false);
  const r2 = radius * radius;
  const gruppen: AggGruppe[] = [];
  for (let i = 0; i < n; i++) {
    if (besucht[i]) continue;
    const mitglieder = [i];
    besucht[i] = true;
    for (let idx = 0; idx < mitglieder.length; idx++) {
      const a = px[mitglieder[idx]!]!;
      for (let j = 0; j < n; j++) {
        if (besucht[j]) continue;
        const b = px[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy < r2) {
          besucht[j] = true;
          mitglieder.push(j);
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
