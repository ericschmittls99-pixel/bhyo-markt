import {
  akteur,
  biomassestrom,
  materialart,
  outputBedarf,
  region,
} from "@bhyo/db/schema";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";

import { withDb } from "@/lib/db";

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
  hatBeleg: boolean;
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
    if (filter.regionId) conds.push(eq(biomassestrom.regionId, filter.regionId));
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
      })
      .from(biomassestrom)
      .leftJoin(akteur, eq(akteur.id, biomassestrom.akteurId))
      .leftJoin(materialart, eq(materialart.code, biomassestrom.materialartCode))
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
      hatBeleg: r.belegId != null,
    }));
  });
}

export function listOutput(filter: RegisterFilter): Promise<RegisterZeile[]> {
  return withDb(async (db) => {
    const conds: SQL[] = [];
    if (filter.regionId) conds.push(eq(outputBedarf.regionId, filter.regionId));
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
      })
      .from(outputBedarf)
      .leftJoin(akteur, eq(akteur.id, outputBedarf.akteurId))
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
      hatBeleg: r.belegId != null,
    }));
  });
}

export function vektorLabel(v: string | null): string | null {
  if (!v) return null;
  return { waerme: "Wärme", h2: "H₂", co2: "CO₂" }[v] ?? v;
}

function formatZahl(wert: string): string {
  const n = Number(wert);
  if (Number.isNaN(n)) return wert;
  return n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}
