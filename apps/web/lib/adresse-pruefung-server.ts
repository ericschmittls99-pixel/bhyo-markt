import { sql } from "drizzle-orm";

import { entscheideAdresse, suchtextAus, type Kandidat, type PruefEingabe, type PruefErgebnis } from "./adresse-pruefung";
import type { AppDb } from "./db";
import { nurAdressenUndOrte, type Adresse } from "./geocode";
import { photonSuche } from "./photon-server";
import { plzPruefungText } from "./plz-modell";
import { PLZ_BESTAND_FEHLT, pinInPlz, plzBestandVorhanden, pruefePlzOrt } from "./plz-server";

/**
 * E68 PR 2: Ablauf der Adresspruefung (ein Klick, hoechstens eine externe
 * Anfrage). 1. PLZ und Ort lokal; bei Fehler sofort „Meinten Sie …?" ohne
 * Netz. 2. EINE strukturierte Anfrage an den Adressdienst (Zeitlimit und
 * Diagnose in lib/photon-server). 3. Entscheidung in lib/adresse-pruefung:
 * Treffer im PLZ-Gebiet -> Pin; Abweichung -> Kandidaten; nichts oder
 * Zeitlimit -> Punkt im PLZ-Gebiet (ST_PointOnSurface) mit Genauigkeit
 * plz_gebiet. `kreise` > 1 heisst: die PLZ liegt ueber einer Kreisgrenze —
 * der Kreis folgt dem Pin, die Oberflaeche sagt es.
 */
export interface PruefAntwort {
  ergebnis: PruefErgebnis;
  /** Anzahl der Kreise, die das PLZ-Gebiet nennenswert (>= 5 %) schneiden; null, wenn nicht ermittelt. */
  kreise: number | null;
  /** Dauer der externen Anfrage in ms, null ohne Anfrage. */
  dauerMs: number | null;
}

/** Punkt innerhalb des PLZ-Gebiets (nie ausserhalb, auch bei Mehrfachflaechen). */
export async function plzRueckfallPin(db: AppDb, plz: string): Promise<{ lng: number; lat: number } | null> {
  const rows = (await db.execute(sql`
    select ST_X(p) as lng, ST_Y(p) as lat from (select ST_PointOnSurface(geom) as p from plz_gebiet where plz = ${plz}) q`)) as unknown as { lng: unknown; lat: unknown }[];
  const r = rows[0];
  if (!r) return null;
  return { lng: Number(r.lng), lat: Number(r.lat) };
}

/** Wie viele Kreise schneidet das PLZ-Gebiet mit mindestens 5 % seiner Flaeche? */
export async function plzKreise(db: AppDb, plz: string): Promise<number> {
  const rows = (await db.execute(sql`
    select count(*)::int as n from verwaltungsgebiet k, plz_gebiet g
    where g.plz = ${plz} and k.ebene = 'kreis' and ST_Intersects(k.geom, g.geom)
      and ST_Area(ST_Intersection(k.geom, g.geom)) >= 0.05 * ST_Area(g.geom)`)) as unknown as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

export async function pruefeAdresse(db: AppDb, e: PruefEingabe): Promise<PruefAntwort> {
  const plz = e.plz.trim();
  if (!/^[0-9]{5}$/.test(plz)) return { ergebnis: { status: "ort_fehler", text: "PLZ muss fünfstellig sein.", orte: [] }, kreise: null, dauerMs: null };
  if (!(await plzBestandVorhanden(db))) return { ergebnis: { status: "dienst_fehlt", text: PLZ_BESTAND_FEHLT }, kreise: null, dauerMs: null };

  const lokal = await pruefePlzOrt(db, plz, e.ort.trim() || null);
  const lokalText = plzPruefungText(lokal, plz);
  if (lokalText) return { ergebnis: { status: "ort_fehler", text: lokalText, orte: lokal.orte }, kreise: null, dauerMs: null };

  // Eine Anfrage; jeder Ausfall (Zeitlimit, Status, Netz) fuehrt zum Rueckfall, nie zu einem Fehler.
  let treffer: Adresse[] = [];
  let ausfall = false;
  const start = Date.now();
  try {
    treffer = nurAdressenUndOrte(await photonSuche(suchtextAus({ ...e, plz })));
  } catch {
    ausfall = true;
  }
  const dauerMs = Date.now() - start;

  const kandidaten: Kandidat[] = [];
  for (const t of treffer.slice(0, 5)) {
    kandidaten.push({ ...t, imGebiet: (await pinInPlz(db, plz, { lng: t.lng, lat: t.lat })) === true });
  }
  const rueckfall = await plzRueckfallPin(db, plz);
  const ergebnis = entscheideAdresse({ ...e, plz }, kandidaten, rueckfall, ausfall);
  const kreise = ergebnis.status === "plz_gebiet" ? await plzKreise(db, plz) : null;
  return { ergebnis, kreise, dauerMs };
}
