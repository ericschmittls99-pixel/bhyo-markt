import {
  akteur,
  beleg,
  biomassestrom,
  materialart,
  outputBedarf,
  region,
} from "@bhyo/db/schema";
import { and, type Column, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { withDb } from "@/lib/db";

/**
 * Raeumliche Regionszuordnung: ein Strom/Bedarf gehoert zu einer Region, wenn
 * sein Standort innerhalb des Einzugsradius um region.standort_geom liegt
 * (ST_DWithin auf geography, Meter). Standorte ohne Pin fallen aus jeder
 * Regionsfilterung heraus (Geocoding fehlt noch, bekannte Einschraenkung).
 */
function imEinzugsradius(geom: Column, regionId: string): SQL {
  return sql`${geom} is not null and ST_DWithin(
    ${geom}::geography,
    (select ${region.standortGeom} from ${region} where ${region.id} = ${regionId})::geography,
    coalesce((select ${region.einzugsradiusKm} from ${region} where ${region.id} = ${regionId}), 0) * 1000
  )`;
}

export interface RegisterFilter {
  regionId?: string | undefined;
  suche?: string | undefined;
  materialart?: string | undefined;
  qualitaet?: string | undefined;
  status?: string | undefined;
}

export interface RegionOption {
  id: string;
  name: string;
}
export interface MaterialartOption {
  code: string;
  label: string;
}
export interface AkteurOption {
  id: string;
  name: string;
  sektor: string | null;
}

export interface RegisterZeile {
  id: string;
  akteurName: string | null;
  bezeichnung: string | null;
  ort: string | null;
  landkreis: string | null;
  /** Materialart-Label (Biomasse) bzw. Vektor (Output). */
  kategorie: string | null;
  zeitraumVon: string | null;
  zeitraumBis: string | null;
  /** Formatierte Menge inkl. Einheit. */
  menge: string | null;
  /** Roher Mengenwert fuer Aggregate (t atro bzw. Bedarfsmenge). */
  mengeNum: number | null;
  qualitaet: string | null;
  status: string;
  beleg: BelegRef | null;
}

/** Beleg-Referenz fuer die Uebersicht: Quellenangabe als Linktext, Ziel-URL. */
export interface BelegRef {
  /** Anzeigetext = beleg.quellenangabe, Fallback "Beleg". */
  quelle: string;
  /** Datei-Route oder externer Link; null, wenn keiner vorliegt. */
  href: string | null;
}

export function listRegionen(): Promise<RegionOption[]> {
  return withDb((db) =>
    db
      .select({ id: region.id, name: region.name })
      .from(region)
      .orderBy(region.name),
  );
}

export function listMaterialarten(): Promise<MaterialartOption[]> {
  return withDb((db) =>
    db
      .select({ code: materialart.code, label: materialart.label })
      .from(materialart)
      .orderBy(materialart.label),
  );
}

/** Live-Suche fuer die Materialart-Combobox (Label). */
export function sucheMaterialarten(query: string): Promise<MaterialartOption[]> {
  const q = query.trim();
  return withDb((db) => {
    const base = db
      .select({ code: materialart.code, label: materialart.label })
      .from(materialart);
    const filtered = q ? base.where(ilike(materialart.label, `%${q}%`)) : base;
    return filtered.orderBy(materialart.label).limit(20);
  });
}

/** Live-Suche fuer die Akteur-Combobox (Name oder Sektor). */
export function sucheAkteure(query: string): Promise<AkteurOption[]> {
  const q = query.trim();
  return withDb((db) => {
    const base = db
      .select({ id: akteur.id, name: akteur.name, sektor: akteur.sektor })
      .from(akteur);
    const filtered = q
      ? base.where(or(ilike(akteur.name, `%${q}%`), ilike(akteur.sektor, `%${q}%`)))
      : base;
    return filtered.orderBy(akteur.name).limit(20);
  });
}

export function listBiomasse(filter: RegisterFilter): Promise<RegisterZeile[]> {
  return withDb(async (db) => {
    const conds: SQL[] = [];
    if (filter.regionId)
      conds.push(imEinzugsradius(biomassestrom.standortGeom, filter.regionId));
    if (filter.materialart)
      conds.push(eq(biomassestrom.materialartCode, filter.materialart));
    if (filter.qualitaet)
      conds.push(eq(biomassestrom.qualitaet, filter.qualitaet as never));
    if (filter.status)
      conds.push(eq(biomassestrom.status, filter.status as never));
    if (filter.suche) {
      const s = `%${filter.suche.trim()}%`;
      conds.push(
        or(
          ilike(akteur.name, s),
          ilike(biomassestrom.bezeichnung, s),
          ilike(biomassestrom.landkreis, s),
          ilike(biomassestrom.ort, s),
        )!,
      );
    }

    const rows = await db
      .select({
        id: biomassestrom.id,
        akteurName: akteur.name,
        bezeichnung: biomassestrom.bezeichnung,
        ort: biomassestrom.ort,
        landkreis: biomassestrom.landkreis,
        kategorie: materialart.label,
        zeitraumVon: biomassestrom.zeitraumVon,
        zeitraumBis: biomassestrom.zeitraumBis,
        mengeAtro: biomassestrom.mengeAtro,
        qualitaet: biomassestrom.qualitaet,
        status: biomassestrom.status,
        belegId: biomassestrom.belegId,
        belegQuelle: sql<string | null>`${beleg.metadata} ->> 'quellenangabe'`,
        belegDateiKey: beleg.dateiKey,
        belegLinkUrl: beleg.linkUrl,
      })
      .from(biomassestrom)
      .leftJoin(akteur, eq(akteur.id, biomassestrom.akteurId))
      .leftJoin(materialart, eq(materialart.code, biomassestrom.materialartCode))
      .leftJoin(beleg, eq(beleg.id, biomassestrom.belegId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(biomassestrom.createdAt))
      .limit(500);

    return rows.map((r) => ({
      id: r.id,
      akteurName: r.akteurName,
      bezeichnung: r.bezeichnung,
      ort: r.ort,
      landkreis: r.landkreis,
      kategorie: r.kategorie,
      zeitraumVon: r.zeitraumVon,
      zeitraumBis: r.zeitraumBis,
      menge: r.mengeAtro != null ? `${formatZahl(r.mengeAtro)} t atro` : null,
      mengeNum: r.mengeAtro != null ? Number(r.mengeAtro) : null,
      qualitaet: r.qualitaet,
      status: r.status,
      beleg: belegRef(r.belegId, r.belegQuelle, r.belegDateiKey, r.belegLinkUrl),
    }));
  });
}

export function listOutput(filter: RegisterFilter): Promise<RegisterZeile[]> {
  return withDb(async (db) => {
    const conds: SQL[] = [];
    if (filter.regionId)
      conds.push(imEinzugsradius(outputBedarf.standortGeom, filter.regionId));
    if (filter.qualitaet)
      conds.push(eq(outputBedarf.qualitaet, filter.qualitaet as never));
    if (filter.status)
      conds.push(eq(outputBedarf.status, filter.status as never));
    if (filter.suche) {
      const s = `%${filter.suche.trim()}%`;
      conds.push(
        or(
          ilike(akteur.name, s),
          ilike(outputBedarf.bezeichnung, s),
          ilike(outputBedarf.landkreis, s),
          ilike(outputBedarf.ort, s),
        )!,
      );
    }

    const rows = await db
      .select({
        id: outputBedarf.id,
        akteurName: akteur.name,
        bezeichnung: outputBedarf.bezeichnung,
        ort: outputBedarf.ort,
        landkreis: outputBedarf.landkreis,
        vektor: outputBedarf.vektor,
        zeitraumVon: outputBedarf.zeitraumVon,
        zeitraumBis: outputBedarf.zeitraumBis,
        mengeWert: outputBedarf.mengeWert,
        mengeEinheit: outputBedarf.mengeEinheit,
        qualitaet: outputBedarf.qualitaet,
        status: outputBedarf.status,
        belegId: outputBedarf.belegId,
        belegQuelle: sql<string | null>`${beleg.metadata} ->> 'quellenangabe'`,
        belegDateiKey: beleg.dateiKey,
        belegLinkUrl: beleg.linkUrl,
      })
      .from(outputBedarf)
      .leftJoin(akteur, eq(akteur.id, outputBedarf.akteurId))
      .leftJoin(beleg, eq(beleg.id, outputBedarf.belegId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(outputBedarf.createdAt))
      .limit(500);

    return rows.map((r) => ({
      id: r.id,
      akteurName: r.akteurName,
      bezeichnung: r.bezeichnung,
      ort: r.ort,
      landkreis: r.landkreis,
      kategorie: vektorLabel(r.vektor),
      zeitraumVon: r.zeitraumVon,
      zeitraumBis: r.zeitraumBis,
      menge:
        r.mengeWert != null
          ? `${formatZahl(r.mengeWert)} ${r.mengeEinheit ?? ""}`.trim()
          : null,
      mengeNum: r.mengeWert != null ? Number(r.mengeWert) : null,
      qualitaet: r.qualitaet,
      status: r.status,
      beleg: belegRef(r.belegId, r.belegQuelle, r.belegDateiKey, r.belegLinkUrl),
    }));
  });
}

export function vektorLabel(v: string | null): string | null {
  if (!v) return null;
  return { waerme: "Wärme", h2: "H₂", co2: "CO₂" }[v] ?? v;
}

function belegRef(
  belegId: string | null,
  quelle: string | null,
  dateiKey: string | null,
  linkUrl: string | null,
): BelegRef | null {
  if (!belegId) return null;
  return {
    quelle: quelle?.trim() || "Beleg",
    href: dateiKey ? `/api/belege/${dateiKey}` : (linkUrl ?? null),
  };
}

function formatZahl(wert: string): string {
  const n = Number(wert);
  if (Number.isNaN(n)) return wert;
  return n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}
