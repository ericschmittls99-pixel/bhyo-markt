import {
  aenderung,
  akteur,
  beleg,
  biomassestrom,
  materialart,
  outputBedarf,
  outputProdukt,
  region,
} from "@bhyo/db/schema";
import { and, type Column, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { withDb } from "@/lib/db";

/**
 * Raeumliche Regionszuordnung (AP1e): ein Strom/Bedarf gehoert zu einer Region,
 * wenn sein Standort im Flaechen-Polygon der Region liegt (ST_Contains, kein
 * geography-Cast mehr). Standorte ohne Pin fallen aus jeder Regionsfilterung
 * heraus (Geocoding fehlt noch, bekannte Einschraenkung).
 */
function imGebiet(geom: Column, regionId: string): SQL {
  return sql`${geom} is not null and ST_Contains(
    (select ${region.gebiet} from ${region} where ${region.id} = ${regionId}),
    ${geom}
  )`;
}

export interface RegisterFilter {
  regionId?: string | undefined;
  suche?: string | undefined;
  materialart?: string | undefined;
  qualitaet?: string | undefined;
  status?: string | undefined;
  landkreis?: string | undefined;
  /** Datenjahr (zeitraum_von/bis ueberlappt dieses Jahr). */
  jahr?: string | undefined;
  /** Nur Output: Filter nach Output-Gruppe. */
  outputGruppe?: string | undefined;
  /** Nur Biomasse: Filter nach Feedstock-Cluster (ueber materialart.cluster). */
  cluster?: string | undefined;
}

/** Biomassestrom gehoert zu einer Materialart des gegebenen Clusters. */
function clusterFilter(clusterCode: string): SQL {
  return sql`${biomassestrom.materialartCode} in (select code from materialart where cluster = ${clusterCode})`;
}

/** Zeitraum [von,bis] ueberlappt das gegebene Jahr. */
function jahrFilter(vonCol: Column, bisCol: Column, jahr: string): SQL {
  return sql`${vonCol} <= ${`${jahr}-12-31`} and ${bisCol} >= ${`${jahr}-01-01`}`;
}

/**
 * Gemeinsame WHERE-Bedingungen fuer Biomasse-Abfragen (Liste, Karte, Auswertung).
 * Voraussetzung: die Abfrage joint `akteur` (fuer die Suche ueber den Namen).
 */
export function biomasseFilterConds(filter: RegisterFilter): SQL[] {
  const conds: SQL[] = [];
  if (filter.regionId)
    conds.push(imGebiet(biomassestrom.standortGeom, filter.regionId));
  if (filter.materialart)
    conds.push(eq(biomassestrom.materialartCode, filter.materialart));
  if (filter.cluster) conds.push(clusterFilter(filter.cluster));
  if (filter.qualitaet)
    conds.push(eq(biomassestrom.qualitaet, filter.qualitaet as never));
  if (filter.status)
    conds.push(eq(biomassestrom.status, filter.status as never));
  if (filter.landkreis)
    conds.push(ilike(biomassestrom.landkreis, `%${filter.landkreis.trim()}%`));
  if (filter.jahr)
    conds.push(
      jahrFilter(biomassestrom.zeitraumVon, biomassestrom.zeitraumBis, filter.jahr),
    );
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
  return conds;
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

export interface OutputProduktOption {
  code: string;
  label: string;
  gruppe: string;
  /** "target" | "add_on" (output_produkt.art) — Kategorie-Hinweis im Formular. */
  kategorie: string;
}

/** Output-Produkte (fuer die Produktauswahl im Erfassungsformular). */
export function listOutputProdukte(): Promise<OutputProduktOption[]> {
  return withDb((db) =>
    db
      .select({
        code: outputProdukt.code,
        label: outputProdukt.label,
        gruppe: outputProdukt.gruppe,
        kategorie: outputProdukt.art,
      })
      .from(outputProdukt)
      .orderBy(outputProdukt.label),
  );
}

export interface MaterialartMitCluster {
  code: string;
  label: string;
  cluster: string;
}

/** Materialarten mit Cluster (fuer die gekoppelten Comboboxen, PR 5). */
export function listMaterialartenMitCluster(): Promise<MaterialartMitCluster[]> {
  return withDb((db) =>
    db
      .select({
        code: materialart.code,
        label: materialart.label,
        cluster: materialart.cluster,
      })
      .from(materialart)
      .orderBy(materialart.label),
  );
}

export function listMaterialarten(
  cluster?: string,
): Promise<MaterialartOption[]> {
  return withDb((db) => {
    const base = db
      .select({ code: materialart.code, label: materialart.label })
      .from(materialart);
    const filtered = cluster
      ? base.where(eq(materialart.cluster, cluster as never))
      : base;
    return filtered.orderBy(materialart.label);
  });
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
    // Gemeinsame Bedingungen (inkl. Cluster-Filter) – die Query joint akteur.
    const conds = biomasseFilterConds(filter);

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
      conds.push(imGebiet(outputBedarf.standortGeom, filter.regionId));
    if (filter.qualitaet)
      conds.push(eq(outputBedarf.qualitaet, filter.qualitaet as never));
    if (filter.status)
      conds.push(eq(outputBedarf.status, filter.status as never));
    if (filter.landkreis)
      conds.push(ilike(outputBedarf.landkreis, `%${filter.landkreis.trim()}%`));
    if (filter.outputGruppe)
      conds.push(eq(outputProdukt.gruppe, filter.outputGruppe as never));
    if (filter.jahr)
      conds.push(
        jahrFilter(outputBedarf.zeitraumVon, outputBedarf.zeitraumBis, filter.jahr),
      );
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
        produktLabel: outputProdukt.label,
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
      .leftJoin(outputProdukt, eq(outputProdukt.code, outputBedarf.produktCode))
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
      kategorie: r.produktLabel,
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

// --- Detail-Panel (read-only) --------------------------------------------

export interface DetailBeleg {
  typ: string;
  quellenangabe: string | null;
  href: string | null;
  externNachvollziehbar: boolean;
  gueltigBis: string | null;
  erhebungsdatum: string | null;
  amtlich: boolean | null;
  gespraechsdatum: string | null;
  gespraechspartner: string | null;
}

export interface DetailDaten {
  art: "biomasse" | "output";
  id: string;
  bezeichnung: string | null;
  akteurName: string | null;
  sektor: string | null;
  ort: string | null;
  landkreis: string | null;
  kontaktperson: string | null;
  kategorie: string | null;
  zeitraumVon: string | null;
  zeitraumBis: string | null;
  mengen: { label: string; wert: string }[];
  saisonalitaet: number[] | null;
  preis: string | null;
  qualitaet: string | null;
  status: string;
  beleg: DetailBeleg | null;
  historie: { zeitpunkt: string; text: string }[];
}

const belegSelect = {
  belegId: beleg.id,
  belegTyp: beleg.typ,
  belegDateiKey: beleg.dateiKey,
  belegLinkUrl: beleg.linkUrl,
  belegExtern: beleg.externNachvollziehbar,
  belegGueltigBis: beleg.gueltigBis,
  belegErstelltAm: beleg.erstelltAm,
  belegMetadata: beleg.metadata,
};

type BelegRow = {
  belegId: string | null;
  belegTyp: string | null;
  belegDateiKey: string | null;
  belegLinkUrl: string | null;
  belegExtern: boolean | null;
  belegGueltigBis: string | null;
  belegErstelltAm: Date | null;
  belegMetadata: unknown;
};

function belegDetail(r: BelegRow): DetailBeleg | null {
  if (!r.belegId || !r.belegTyp) return null;
  const m = (r.belegMetadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    typ: r.belegTyp,
    quellenangabe: str(m.quellenangabe),
    href: r.belegDateiKey ? `/api/belege/${r.belegDateiKey}` : r.belegLinkUrl,
    externNachvollziehbar: r.belegExtern ?? false,
    gueltigBis: r.belegGueltigBis,
    erhebungsdatum: r.belegErstelltAm
      ? r.belegErstelltAm.toISOString().slice(0, 10)
      : null,
    amtlich: typeof m.amtlich === "boolean" ? m.amtlich : null,
    gespraechsdatum: str(m.gespraechsdatum),
    gespraechspartner: str(m.gespraechspartner),
  };
}

function parseSaison(j: unknown): number[] | null {
  if (Array.isArray(j) && j.length === 12) return j.map((x) => Number(x) || 0);
  return null;
}

function preisText(
  min: string | null,
  mittel: string | null,
  max: string | null,
  herkunft: string | null,
): string | null {
  if (min == null && mittel == null && max == null) return null;
  const f = (v: string | null) => (v != null ? formatZahl(v) : "—");
  const h = herkunft
    ? { eigene_datenbank: "eigene Datenbank", marktdaten: "Marktdaten", schaetzung: "Schätzung" }[herkunft]
    : null;
  return `${f(min)} / ${f(mittel)} / ${f(max)} €/t${h ? ` · ${h}` : ""}`;
}

function pct(v: string | null): string {
  return v != null ? `${formatZahl(v)} %` : "—";
}

async function ladeHistorie(
  db: Parameters<Parameters<typeof withDb>[0]>[0],
  entitaetTyp: string,
  id: string,
): Promise<{ zeitpunkt: string; text: string }[]> {
  const rows = await db
    .select({ zeitpunkt: aenderung.zeitpunkt, text: aenderung.text })
    .from(aenderung)
    .where(and(eq(aenderung.entitaetTyp, entitaetTyp), eq(aenderung.entitaetId, id)))
    .orderBy(desc(aenderung.zeitpunkt))
    .limit(50);
  return rows.map((r) => ({
    zeitpunkt: r.zeitpunkt.toLocaleString("de-DE"),
    text: r.text,
  }));
}

export function getDetail(
  art: "biomasse" | "output",
  id: string,
): Promise<DetailDaten | null> {
  return withDb(async (db) => {
    if (art === "biomasse") {
      const [r] = await db
        .select({
          id: biomassestrom.id,
          bezeichnung: biomassestrom.bezeichnung,
          akteurName: akteur.name,
          sektor: akteur.sektor,
          ort: biomassestrom.ort,
          landkreis: biomassestrom.landkreis,
          kontaktperson: biomassestrom.kontaktperson,
          kategorie: materialart.label,
          zeitraumVon: biomassestrom.zeitraumVon,
          zeitraumBis: biomassestrom.zeitraumBis,
          mengeRohFm: biomassestrom.mengeRohFm,
          tsAnteilPct: biomassestrom.tsAnteilPct,
          aschegehaltPct: biomassestrom.aschegehaltPct,
          mengeAtro: biomassestrom.mengeAtro,
          saisonalitaet: biomassestrom.saisonalitaet,
          preisMin: biomassestrom.preisMin,
          preisMittel: biomassestrom.preisMittel,
          preisMax: biomassestrom.preisMax,
          preisHerkunft: biomassestrom.preisHerkunft,
          qualitaet: biomassestrom.qualitaet,
          status: biomassestrom.status,
          ...belegSelect,
        })
        .from(biomassestrom)
        .leftJoin(akteur, eq(akteur.id, biomassestrom.akteurId))
        .leftJoin(materialart, eq(materialart.code, biomassestrom.materialartCode))
        .leftJoin(beleg, eq(beleg.id, biomassestrom.belegId))
        .where(eq(biomassestrom.id, id))
        .limit(1);
      if (!r) return null;
      return {
        art,
        id: r.id,
        bezeichnung: r.bezeichnung,
        akteurName: r.akteurName,
        sektor: r.sektor,
        ort: r.ort,
        landkreis: r.landkreis,
        kontaktperson: r.kontaktperson,
        kategorie: r.kategorie,
        zeitraumVon: r.zeitraumVon,
        zeitraumBis: r.zeitraumBis,
        mengen: [
          { label: "Rohmenge (FM)", wert: r.mengeRohFm != null ? formatZahl(r.mengeRohFm) : "—" },
          { label: "TS-Anteil", wert: pct(r.tsAnteilPct) },
          { label: "Aschegehalt", wert: pct(r.aschegehaltPct) },
          { label: "Trockenmasse", wert: r.mengeAtro != null ? `${formatZahl(r.mengeAtro)} t atro` : "—" },
        ],
        saisonalitaet: parseSaison(r.saisonalitaet),
        preis: preisText(r.preisMin, r.preisMittel, r.preisMax, r.preisHerkunft),
        qualitaet: r.qualitaet,
        status: r.status,
        beleg: belegDetail(r),
        historie: await ladeHistorie(db, "biomassestrom", id),
      };
    }

    const [r] = await db
      .select({
        id: outputBedarf.id,
        bezeichnung: outputBedarf.bezeichnung,
        akteurName: akteur.name,
        sektor: akteur.sektor,
        ort: outputBedarf.ort,
        landkreis: outputBedarf.landkreis,
        kontaktperson: outputBedarf.kontaktperson,
        produktLabel: outputProdukt.label,
        zeitraumVon: outputBedarf.zeitraumVon,
        zeitraumBis: outputBedarf.zeitraumBis,
        mengeWert: outputBedarf.mengeWert,
        mengeEinheit: outputBedarf.mengeEinheit,
        saisonalitaet: outputBedarf.saisonalitaet,
        qualitaet: outputBedarf.qualitaet,
        status: outputBedarf.status,
        ...belegSelect,
      })
      .from(outputBedarf)
      .leftJoin(akteur, eq(akteur.id, outputBedarf.akteurId))
      .leftJoin(outputProdukt, eq(outputProdukt.code, outputBedarf.produktCode))
      .leftJoin(beleg, eq(beleg.id, outputBedarf.belegId))
      .where(eq(outputBedarf.id, id))
      .limit(1);
    if (!r) return null;
    return {
      art,
      id: r.id,
      bezeichnung: r.bezeichnung,
      akteurName: r.akteurName,
      sektor: r.sektor,
      ort: r.ort,
      landkreis: r.landkreis,
      kontaktperson: r.kontaktperson,
      kategorie: r.produktLabel,
      zeitraumVon: r.zeitraumVon,
      zeitraumBis: r.zeitraumBis,
      mengen: [
        {
          label: "Bedarfsmenge",
          wert: r.mengeWert != null ? `${formatZahl(r.mengeWert)} ${r.mengeEinheit ?? ""}`.trim() : "—",
        },
      ],
      saisonalitaet: parseSaison(r.saisonalitaet),
      preis: null,
      qualitaet: r.qualitaet,
      status: r.status,
      beleg: belegDetail(r),
      historie: await ladeHistorie(db, "output_bedarf", id),
    };
  });
}

// --- Karte (AP1c) ---------------------------------------------------------

export interface MapPunkt {
  id: string;
  art: "biomasse" | "output";
  lng: number;
  lat: number;
  /** Farbschluessel: materialart.cluster (Biomasse) bzw. output_produkt.gruppe (Output). */
  farbeKey: string;
  /** Groessenbasis: menge_atro (Biomasse) bzw. menge_wert (Output). */
  menge: number;
  qualitaet: string | null;
  label: string;
}

/** Flaechen-Umriss einer Region als GeoJSON-Geometrie (Polygon) fuer die Karte. */
export interface RegionGebiet {
  geojson: unknown;
}

export function listMapPunkte(filter: RegisterFilter): Promise<MapPunkt[]> {
  return withDb(async (db) => {
    const s = filter.suche ? `%${filter.suche.trim()}%` : null;

    const bConds: SQL[] = [sql`${biomassestrom.standortGeom} is not null`];
    if (filter.regionId)
      bConds.push(imGebiet(biomassestrom.standortGeom, filter.regionId));
    if (filter.materialart)
      bConds.push(eq(biomassestrom.materialartCode, filter.materialart));
    if (filter.cluster) bConds.push(clusterFilter(filter.cluster));
    if (filter.qualitaet)
      bConds.push(eq(biomassestrom.qualitaet, filter.qualitaet as never));
    if (filter.status)
      bConds.push(eq(biomassestrom.status, filter.status as never));
    if (filter.landkreis)
      bConds.push(ilike(biomassestrom.landkreis, `%${filter.landkreis.trim()}%`));
    if (filter.jahr)
      bConds.push(
        jahrFilter(biomassestrom.zeitraumVon, biomassestrom.zeitraumBis, filter.jahr),
      );
    if (s)
      bConds.push(
        or(
          ilike(akteur.name, s),
          ilike(biomassestrom.bezeichnung, s),
          ilike(biomassestrom.landkreis, s),
          ilike(biomassestrom.ort, s),
        )!,
      );

    const bRows = await db
      .select({
        id: biomassestrom.id,
        lng: sql<number>`ST_X(${biomassestrom.standortGeom})`,
        lat: sql<number>`ST_Y(${biomassestrom.standortGeom})`,
        cluster: materialart.cluster,
        menge: biomassestrom.mengeAtro,
        qualitaet: biomassestrom.qualitaet,
        bezeichnung: biomassestrom.bezeichnung,
        akteurName: akteur.name,
      })
      .from(biomassestrom)
      .leftJoin(akteur, eq(akteur.id, biomassestrom.akteurId))
      .leftJoin(materialart, eq(materialart.code, biomassestrom.materialartCode))
      .where(and(...bConds))
      .limit(2000);

    const biomasse: MapPunkt[] = bRows.map((r) => ({
      id: r.id,
      art: "biomasse" as const,
      lng: r.lng,
      lat: r.lat,
      farbeKey: r.cluster ?? "unbekannt",
      menge: r.menge != null ? Number(r.menge) : 0,
      qualitaet: r.qualitaet,
      label: r.bezeichnung ?? r.akteurName ?? "Biomassestrom",
    }));

    // Materialart-Filter aktiv -> Output ausblenden (Output hat keine Materialart).
    if (filter.materialart) return biomasse;

    const oConds: SQL[] = [sql`${outputBedarf.standortGeom} is not null`];
    if (filter.regionId)
      oConds.push(imGebiet(outputBedarf.standortGeom, filter.regionId));
    if (filter.qualitaet)
      oConds.push(eq(outputBedarf.qualitaet, filter.qualitaet as never));
    if (filter.status)
      oConds.push(eq(outputBedarf.status, filter.status as never));
    if (filter.landkreis)
      oConds.push(ilike(outputBedarf.landkreis, `%${filter.landkreis.trim()}%`));
    if (filter.jahr)
      oConds.push(
        jahrFilter(outputBedarf.zeitraumVon, outputBedarf.zeitraumBis, filter.jahr),
      );
    if (s)
      oConds.push(
        or(
          ilike(akteur.name, s),
          ilike(outputBedarf.bezeichnung, s),
          ilike(outputBedarf.landkreis, s),
          ilike(outputBedarf.ort, s),
        )!,
      );

    const oRows = await db
      .select({
        id: outputBedarf.id,
        lng: sql<number>`ST_X(${outputBedarf.standortGeom})`,
        lat: sql<number>`ST_Y(${outputBedarf.standortGeom})`,
        gruppe: outputProdukt.gruppe,
        menge: outputBedarf.mengeWert,
        qualitaet: outputBedarf.qualitaet,
        bezeichnung: outputBedarf.bezeichnung,
        akteurName: akteur.name,
      })
      .from(outputBedarf)
      .leftJoin(akteur, eq(akteur.id, outputBedarf.akteurId))
      .leftJoin(outputProdukt, eq(outputProdukt.code, outputBedarf.produktCode))
      .where(and(...oConds))
      .limit(2000);

    const output: MapPunkt[] = oRows.map((r) => ({
      id: r.id,
      art: "output" as const,
      lng: r.lng,
      lat: r.lat,
      farbeKey: r.gruppe ?? "unbekannt",
      menge: r.menge != null ? Number(r.menge) : 0,
      qualitaet: r.qualitaet,
      label: r.bezeichnung ?? r.akteurName ?? "Output-Bedarf",
    }));

    return [...biomasse, ...output];
  });
}

export function getRegionGebiet(regionId: string): Promise<RegionGebiet | null> {
  return withDb(async (db) => {
    const [r] = await db
      .select({ geojson: sql<string>`ST_AsGeoJSON(${region.gebiet})` })
      .from(region)
      .where(eq(region.id, regionId))
      .limit(1);
    if (!r?.geojson) return null;
    return { geojson: JSON.parse(r.geojson) };
  });
}

/** Umriss (id, name, Polygon-GeoJSON) aller Regionen fuer den Karten-Layer. */
export interface RegionUmriss {
  id: string;
  name: string;
  geojson: unknown;
}

export function listRegionGebiete(): Promise<RegionUmriss[]> {
  return withDb(async (db) => {
    const rows = await db
      .select({
        id: region.id,
        name: region.name,
        geojson: sql<string>`ST_AsGeoJSON(${region.gebiet})`,
      })
      .from(region)
      .orderBy(region.name);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      geojson: JSON.parse(r.geojson),
    }));
  });
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
