import { analyseLauf, region } from "@bhyo/db/schema";
import { sql } from "drizzle-orm";

import { type AppDb, withDb } from "@/lib/db";

/** Transaktions-Handle von db.transaction (hat execute/insert/select wie AppDb). */
type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

/** Eine Fokusregion mit abgeleitetem Lauf-Status (Platzhalter, falls kein Lauf). */
export interface FokusregionZeile {
  id: string;
  name: string;
  laufId: string | null;
  laufStatus: string | null;
}

/**
 * Alle Fokusregionen mit ihrem juengsten analyse_lauf (falls vorhanden). Regionen
 * ohne Lauf bleiben als abgeleiteter Platzhalter ("nicht gestartet") – kein
 * eigener DB-Eintrag, kein neuer lauf_status-Wert.
 */
export function listFokusregionen(): Promise<FokusregionZeile[]> {
  return withDb((db) =>
    db
      .select({
        id: region.id,
        name: region.name,
        laufId: sql<
          string | null
        >`(select lauf_id from analyse_lauf where region_id = ${region.id} order by created_at desc limit 1)`,
        laufStatus: sql<
          string | null
        >`(select status from analyse_lauf where region_id = ${region.id} order by created_at desc limit 1)`,
      })
      .from(region)
      .orderBy(region.name),
  );
}

/** Vergibt die naechste Lauf-ID (BW-JJJJ-NNN) kollisionssicher per FOR UPDATE. */
async function naechsteLaufId(tx: Tx, jahr: number): Promise<string> {
  await tx.execute(
    sql`insert into lauf_nummernkreis (jahr, letzte_nummer) values (${jahr}, 0) on conflict (jahr) do nothing`,
  );
  const rows = (await tx.execute(
    sql`select letzte_nummer from lauf_nummernkreis where jahr = ${jahr} for update`,
  )) as unknown as Array<{ letzte_nummer: number }>;
  const naechste = Number(rows[0]?.letzte_nummer ?? 0) + 1;
  await tx.execute(
    sql`update lauf_nummernkreis set letzte_nummer = ${naechste} where jahr = ${jahr}`,
  );
  return `BW-${jahr}-${String(naechste).padStart(3, "0")}`;
}

/** Legt den ersten analyse_lauf (arbeitsfassung) fuer eine bestehende Region an. */
export function starteLauf(regionId: string): Promise<string> {
  return withDb((db) =>
    db.transaction(async (tx) => {
      const laufId = await naechsteLaufId(tx, new Date().getFullYear());
      await tx.insert(analyseLauf).values({ regionId, laufId });
      return laufId;
    }),
  );
}

async function insertRegion(
  tx: Tx,
  name: string,
  bbox: [number, number, number, number],
): Promise<string> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const rows = (await tx.execute(
    sql`insert into region (name, gebiet)
        values (${name}, ST_SetSRID(ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}), 4326))
        returning id`,
  )) as unknown as Array<{ id: string }>;
  return rows[0]!.id;
}

/** Weg 1: Fokusregion sofort anlegen (ohne Lauf). */
export function erstelleRegion(
  name: string,
  bbox: [number, number, number, number],
): Promise<string> {
  return withDb((db) => db.transaction((tx) => insertRegion(tx, name, bbox)));
}

/** Weg 2: Region zeichnen UND direkt Projekt starten – nur dann wird persistiert. */
export function erstelleRegionUndStarte(
  name: string,
  bbox: [number, number, number, number],
): Promise<{ regionId: string; laufId: string }> {
  return withDb((db) =>
    db.transaction(async (tx) => {
      const regionId = await insertRegion(tx, name, bbox);
      const laufId = await naechsteLaufId(tx, new Date().getFullYear());
      await tx.insert(analyseLauf).values({ regionId, laufId });
      return { regionId, laufId };
    }),
  );
}
