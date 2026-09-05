import {
  analyseLauf,
  biomassestrom,
  materialart,
  region,
} from "@bhyo/db/schema";
import { eq, sql } from "drizzle-orm";

import { type AppDb, withDb } from "@/lib/db";

/** Transaktions-Handle von db.transaction (hat execute/insert/select wie AppDb). */
type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

export interface ClusterAnteil {
  cluster: string;
  anteil: number;
}

/** Eine Fokusregion mit abgeleitetem Lauf-Status (Platzhalter, falls kein Lauf). */
export interface FokusregionZeile {
  id: string;
  name: string;
  laufId: string | null;
  laufStatus: string | null;
  /** Cluster-Vielfalt der raeumlich zugeordneten Stroeme, absteigend nach Anteil. */
  clusterVerteilung: ClusterAnteil[];
}

/**
 * Prozentuale Cluster-Verteilung je Region: biomassestrom (mit materialart fuer
 * cluster) ueber ST_Contains gegen alle region.gebiet, nach region + cluster
 * gruppiert; Anteil = menge_atro-Summe je Cluster / Gesamtsumme der Region.
 */
async function verteilungJeRegion(
  db: AppDb,
): Promise<Map<string, ClusterAnteil[]>> {
  const rows = await db
    .select({
      regionId: region.id,
      cluster: materialart.cluster,
      menge: sql<number>`sum(${biomassestrom.mengeAtro})::float8`,
    })
    .from(region)
    .innerJoin(
      biomassestrom,
      sql`${biomassestrom.standortGeom} is not null and ST_Contains(${region.gebiet}, ${biomassestrom.standortGeom})`,
    )
    .innerJoin(materialart, eq(materialart.code, biomassestrom.materialartCode))
    .groupBy(region.id, materialart.cluster);

  const proRegion = new Map<string, { cluster: string; menge: number }[]>();
  for (const r of rows) {
    const liste = proRegion.get(r.regionId) ?? [];
    liste.push({ cluster: r.cluster, menge: r.menge });
    proRegion.set(r.regionId, liste);
  }

  const ergebnis = new Map<string, ClusterAnteil[]>();
  for (const [regionId, liste] of proRegion) {
    const gesamt = liste.reduce((a, x) => a + x.menge, 0);
    const verteilung = liste
      .map((x) => ({
        cluster: x.cluster,
        anteil: gesamt ? Math.round((x.menge / gesamt) * 100) : 0,
      }))
      .sort((a, b) => b.anteil - a.anteil);
    ergebnis.set(regionId, verteilung);
  }
  return ergebnis;
}

/** Cluster-Verteilung je Region (eigenstaendig; auch von listFokusregionen genutzt). */
export function listClusterVerteilungJeRegion(): Promise<
  Map<string, ClusterAnteil[]>
> {
  return withDb(verteilungJeRegion);
}

/**
 * Alle Fokusregionen mit ihrem juengsten analyse_lauf (falls vorhanden) und der
 * Cluster-Verteilung. Regionen ohne Lauf bleiben als abgeleiteter Platzhalter
 * ("nicht gestartet"), ohne Biomasse-Zuordnung ein leeres Verteilungs-Array.
 */
export function listFokusregionen(): Promise<FokusregionZeile[]> {
  return withDb(async (db) => {
    const zeilen = await db
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
      .orderBy(region.name);

    const verteilung = await verteilungJeRegion(db);
    return zeilen.map((z) => ({
      ...z,
      clusterVerteilung: verteilung.get(z.id) ?? [],
    }));
  });
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
