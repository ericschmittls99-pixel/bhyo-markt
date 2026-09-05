import {
  aenderung,
  akteur,
  beleg,
  biomassestrom,
  materialart,
} from "@bhyo/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

import { withDb } from "@/lib/db";
import { biomasseFilterConds, type RegisterFilter } from "@/lib/register";

export interface AuswertungKpi {
  anzahl: number;
  gesamtAtro: number;
  anteilAB: number;
  landkreise: number;
}
export interface MaterialartMenge {
  label: string;
  atro: number;
  fm: number;
}
export interface ClusterMenge {
  cluster: string;
  atro: number;
}
export interface QualitaetVerteilung {
  stufe: string;
  anzahl: number;
  menge: number;
  anteil: number;
}
export interface LandkreisAbdeckung {
  landkreis: string;
  stroeme: number;
  atro: number;
  qSchnitt: number | null;
}
export interface JahrReihe {
  jahr: number;
  datenjahr: number;
  erhebungsjahr: number;
}
export interface AenderungLog {
  zeitpunkt: string;
  text: string;
  entitaet: string;
}

export interface AuswertungDaten {
  kpi: AuswertungKpi;
  cluster: ClusterMenge[];
  materialart: MaterialartMenge[];
  qualitaet: QualitaetVerteilung[];
  landkreise: LandkreisAbdeckung[];
  jahre: JahrReihe[];
  log: AenderungLog[];
}

// Aggregation ausschliesslich ueber Biomasseströme (menge_atro, materialart).
// Reine Auswertung vorhandener Felder – kein Schema-Gap (AP1d).
export function getAuswertung(
  filter: RegisterFilter,
): Promise<AuswertungDaten> {
  return withDb(async (db) => {
    const w = () => and(...biomasseFilterConds(filter));
    const joinAkteur = eq(akteur.id, biomassestrom.akteurId);

    // 1. KPI-Kopfzeile
    const [k] = await db
      .select({
        anzahl: sql<number>`count(*)::int`,
        gesamtAtro: sql<number>`coalesce(sum(${biomassestrom.mengeAtro}), 0)::float8`,
        ab: sql<number>`count(*) filter (where ${biomassestrom.qualitaet} in ('A','B'))::int`,
        bewertet: sql<number>`count(*) filter (where ${biomassestrom.qualitaet} is not null)::int`,
        landkreise: sql<number>`count(distinct ${biomassestrom.landkreis})::int`,
      })
      .from(biomassestrom)
      .leftJoin(akteur, joinAkteur)
      .where(w());
    const kpi: AuswertungKpi = {
      anzahl: k!.anzahl,
      gesamtAtro: k!.gesamtAtro,
      anteilAB: k!.bewertet ? Math.round((k!.ab / k!.bewertet) * 100) : 0,
      landkreise: k!.landkreise,
    };

    // 2. Menge nach Materialart (t atro vs. t FM)
    const matRows = await db
      .select({
        label: materialart.label,
        atro: sql<number>`coalesce(sum(${biomassestrom.mengeAtro}), 0)::float8`,
        fm: sql<number>`coalesce(sum(${biomassestrom.mengeRohFm}), 0)::float8`,
      })
      .from(biomassestrom)
      .leftJoin(akteur, joinAkteur)
      .leftJoin(materialart, eq(materialart.code, biomassestrom.materialartCode))
      .where(w())
      .groupBy(materialart.label)
      .orderBy(sql`2 desc`);
    const materialartMenge: MaterialartMenge[] = matRows.map((r) => ({
      label: r.label ?? "—",
      atro: r.atro,
      fm: r.fm,
    }));

    // 2b. Menge nach Cluster (eine Ebene ueber der Materialart)
    const clusterRows = await db
      .select({
        cluster: materialart.cluster,
        atro: sql<number>`coalesce(sum(${biomassestrom.mengeAtro}), 0)::float8`,
      })
      .from(biomassestrom)
      .leftJoin(akteur, joinAkteur)
      .leftJoin(materialart, eq(materialart.code, biomassestrom.materialartCode))
      .where(w())
      .groupBy(materialart.cluster);
    const clusterMenge: ClusterMenge[] = clusterRows.map((r) => ({
      cluster: r.cluster ?? "unbekannt",
      atro: r.atro,
    }));

    // 3. Qualitaetsverteilung A–D
    const qRows = await db
      .select({
        stufe: biomassestrom.qualitaet,
        anzahl: sql<number>`count(*)::int`,
        menge: sql<number>`coalesce(sum(${biomassestrom.mengeAtro}), 0)::float8`,
      })
      .from(biomassestrom)
      .leftJoin(akteur, joinAkteur)
      .where(w())
      .groupBy(biomassestrom.qualitaet);
    const gesamtAnzahl = qRows.reduce((a, r) => a + r.anzahl, 0);
    const qualitaet: QualitaetVerteilung[] = ["A", "B", "C", "D"].map((st) => {
      const r = qRows.find((x) => x.stufe === st);
      const anzahl = r?.anzahl ?? 0;
      return {
        stufe: st,
        anzahl,
        menge: r?.menge ?? 0,
        anteil: gesamtAnzahl ? Math.round((anzahl / gesamtAnzahl) * 100) : 0,
      };
    });

    // 4. Abdeckung nach Landkreis (Ø-Qualitaet A=1..D=4, eine Nachkommastelle)
    const lkRows = await db
      .select({
        landkreis: biomassestrom.landkreis,
        stroeme: sql<number>`count(*)::int`,
        atro: sql<number>`coalesce(sum(${biomassestrom.mengeAtro}), 0)::float8`,
        qSchnitt: sql<
          number | null
        >`round(avg(case ${biomassestrom.qualitaet} when 'A' then 1 when 'B' then 2 when 'C' then 3 when 'D' then 4 end), 1)::float8`,
      })
      .from(biomassestrom)
      .leftJoin(akteur, joinAkteur)
      .where(and(w(), sql`${biomassestrom.landkreis} is not null`))
      .groupBy(biomassestrom.landkreis)
      .orderBy(sql`3 desc`);
    const landkreise: LandkreisAbdeckung[] = lkRows.map((r) => ({
      landkreis: r.landkreis ?? "—",
      stroeme: r.stroeme,
      atro: r.atro,
      qSchnitt: r.qSchnitt,
    }));

    // 5. Zeitliche Entwicklung: Datenjahr (zeitraum_von) vs. Erhebungsjahr (beleg)
    const datenRows = await db
      .select({
        jahr: sql<number>`extract(year from ${biomassestrom.zeitraumVon})::int`,
        anzahl: sql<number>`count(*)::int`,
      })
      .from(biomassestrom)
      .leftJoin(akteur, joinAkteur)
      .where(w())
      .groupBy(sql`1`);
    const erhebRows = await db
      .select({
        jahr: sql<number>`extract(year from ${beleg.erstelltAm})::int`,
        anzahl: sql<number>`count(*)::int`,
      })
      .from(biomassestrom)
      .leftJoin(akteur, joinAkteur)
      .leftJoin(beleg, eq(beleg.id, biomassestrom.belegId))
      .where(and(w(), sql`${beleg.id} is not null`))
      .groupBy(sql`1`);
    const jahreMap = new Map<number, JahrReihe>();
    const ensure = (jahr: number) => {
      let e = jahreMap.get(jahr);
      if (!e) {
        e = { jahr, datenjahr: 0, erhebungsjahr: 0 };
        jahreMap.set(jahr, e);
      }
      return e;
    };
    for (const r of datenRows) if (r.jahr) ensure(r.jahr).datenjahr = r.anzahl;
    for (const r of erhebRows) if (r.jahr) ensure(r.jahr).erhebungsjahr = r.anzahl;
    const jahre = [...jahreMap.values()].sort((a, b) => a.jahr - b.jahr);

    // 6. Zuletzt aktualisiert (direkt aus der aenderung-Tabelle)
    const logRows = await db
      .select({
        zeitpunkt: aenderung.zeitpunkt,
        text: aenderung.text,
        entitaet: aenderung.entitaetTyp,
      })
      .from(aenderung)
      .orderBy(desc(aenderung.zeitpunkt))
      .limit(20);
    const log: AenderungLog[] = logRows.map((r) => ({
      zeitpunkt: r.zeitpunkt.toLocaleString("de-DE"),
      text: r.text,
      entitaet: r.entitaet,
    }));

    return {
      kpi,
      cluster: clusterMenge,
      materialart: materialartMenge,
      qualitaet,
      landkreise,
      jahre,
      log,
    };
  });
}
