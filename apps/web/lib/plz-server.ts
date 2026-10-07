import { sql } from "drizzle-orm";

import type { AppDb } from "./db";
import type { PlzPruefung, PlzTreffer } from "./plz-modell";

/**
 * E68 PR 1: Lesewege der lokalen Adresspruefung — duenne Huellen um die
 * SQL-Funktionen aus Migration 0048 (plz_pruefung, plz_fuer_punkt,
 * punkt_in_plz). Die Regel lebt in SQL, der Spiegel in @bhyo/db/plz;
 * hier wird nichts nachgerechnet. Arrays kommen aus dem Worker-Treiber als
 * Text an, deshalb array_to_json(...)::text und JSON.parse.
 */
export async function pruefePlzOrt(db: AppDb, plz: string, ort: string | null): Promise<PlzPruefung> {
  const rows = (await db.execute(sql`
    select plz_bekannt, ort_passt, array_to_json(orte)::text as orte_json
    from plz_pruefung(${plz}, ${ort})`)) as unknown as { plz_bekannt: boolean; ort_passt: boolean; orte_json: string }[];
  const r = rows[0];
  if (!r) return { plzBekannt: false, ortPasst: false, orte: [] };
  return { plzBekannt: r.plz_bekannt, ortPasst: r.ort_passt, orte: JSON.parse(r.orte_json) as string[] };
}

/** PLZ (und ihre Orte) zum Pin; null, wenn der Punkt in keinem PLZ-Gebiet liegt. */
export async function plzAusPunkt(db: AppDb, pin: { lng: number; lat: number }): Promise<PlzTreffer | null> {
  const rows = (await db.execute(sql`
    select plz, array_to_json(orte)::text as orte_json from plz_fuer_punkt(ST_SetSRID(ST_MakePoint(${pin.lng}, ${pin.lat}), 4326)) limit 1`)) as unknown as { plz: string; orte_json: string }[];
  const r = rows[0];
  return r ? { plz: r.plz, orte: JSON.parse(r.orte_json) as string[] } : null;
}

/** Liegt der Pin im Gebiet der PLZ? null bei unbekannter PLZ. */
export async function pinInPlz(db: AppDb, plz: string, pin: { lng: number; lat: number }): Promise<boolean | null> {
  const rows = (await db.execute(sql`
    select punkt_in_plz(${plz}, ST_SetSRID(ST_MakePoint(${pin.lng}, ${pin.lat}), 4326)) as drin`)) as unknown as { drin: boolean | null }[];
  return rows[0]?.drin ?? null;
}

/** Solange der Import (import-plz.yml) nicht gelaufen ist, gibt es keine lokale Pruefung — das wird gesagt, nicht geraten. */
export async function plzBestandVorhanden(db: AppDb): Promise<boolean> {
  const rows = (await db.execute(sql`select exists(select 1 from plz_gebiet) as da`)) as unknown as { da: boolean }[];
  return rows[0]?.da === true;
}

export const PLZ_BESTAND_FEHLT = "PLZ-Gebiete sind noch nicht importiert — PLZ und Ort bitte von Hand eintragen.";

/** Ergebnis je Eingabe des Stapels (E68 PR 3): Pruefung plus Punkt im PLZ-Gebiet (null bei unbekannter PLZ). */
export interface PlzStapelErgebnis extends PlzPruefung {
  pin: { lng: number; lat: number } | null;
}

/**
 * E68 PR 3: Pruefung vieler (PLZ, Ort) in EINER Abfrage — fuer den Import
 * (5.000 Zeilen in einem Aufruf statt je Zeile). Eingaben als jsonb gebunden
 * (Worker-Treiber: Arrays kommen als Text, jsonb geht sicher), Ergebnisse in
 * Eingabereihenfolge.
 */
export async function pruefePlzOrtStapel(db: AppDb, eintraege: readonly { plz: string; ort: string }[]): Promise<PlzStapelErgebnis[]> {
  if (eintraege.length === 0) return [];
  const rows = (await db.execute(sql`
    with e as (
      select t.i, t.plz, nullif(t.ort, '') as ort
      from jsonb_to_recordset(${JSON.stringify(eintraege.map((x, i) => ({ i, plz: x.plz, ort: x.ort })))}::jsonb) as t(i int, plz text, ort text)
    )
    select e.i, p.plz_bekannt, p.ort_passt, array_to_json(p.orte)::text as orte_json,
           ST_X(q.pt) as lng, ST_Y(q.pt) as lat
    from e
    cross join lateral plz_pruefung(e.plz, e.ort) p
    left join lateral (select ST_PointOnSurface(g.geom) as pt from plz_gebiet g where g.plz = e.plz) q on true
    order by e.i`)) as unknown as { i: number; plz_bekannt: boolean; ort_passt: boolean; orte_json: string; lng: unknown; lat: unknown }[];
  return rows.map((r) => ({
    plzBekannt: r.plz_bekannt,
    ortPasst: r.ort_passt,
    orte: JSON.parse(r.orte_json) as string[],
    pin: r.lng == null || r.lat == null ? null : { lng: Number(r.lng), lat: Number(r.lat) },
  }));
}
