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
import { and, desc, eq, sql } from "drizzle-orm";

import { withDb } from "@/lib/db";
import {
  GRUPPE_LABEL,
  type Strom,
  type StromArt,
  type StromBeleg,
} from "@/lib/stroeme-modell";
import { vollstaendigkeit } from "@/lib/vollstaendigkeit";

/**
 * Datenzugriff fuer stroeme. (AP1i PR 3). Die Seite laedt den kompletten Pool
 * eines Tabs (bis 500 Zeilen, wie bisher) und filtert/sortiert dann mit den
 * reinen Funktionen aus lib/stroeme-modell.ts — exakt die Logik des
 * V2-Mockups. Bei >500 Zeilen greift das Limit; bekannte Einschraenkung, die
 * schon fuer die bisherige Registerliste galt.
 */

// --- Laden -----------------------------------------------------------------

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

function parseSaison(j: unknown): number[] | null {
  if (Array.isArray(j) && j.length === 12) return j.map((x) => Number(x) || 0);
  return null;
}

function num(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

type BelegRow = {
  belegTyp: string | null;
  belegDateiKey: string | null;
  belegLinkUrl: string | null;
  belegExtern: boolean | null;
  belegGueltigBis: string | null;
  belegErstelltAm: Date | null;
  belegMetadata: unknown;
};

function belegAus(r: BelegRow): StromBeleg | null {
  if (!r.belegTyp) return null;
  const m = (r.belegMetadata ?? {}) as Record<string, unknown>;
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
    kernnotiz: str(m.kernnotiz),
  };
}

const belegSelect = {
  belegTyp: beleg.typ,
  belegDateiKey: beleg.dateiKey,
  belegLinkUrl: beleg.linkUrl,
  belegExtern: beleg.externNachvollziehbar,
  belegGueltigBis: beleg.gueltigBis,
  belegErstelltAm: beleg.erstelltAm,
  belegMetadata: beleg.metadata,
};

/** Laedt den kompletten Pool eines Tabs (max. 500, neueste zuerst). */
export function ladeStroeme(art: StromArt): Promise<Strom[]> {
  return withDb(async (db) => {
    if (art === "biomasse") {
      const geom = biomassestrom.standortGeom;
      const rows = await db
        .select({
          id: biomassestrom.id,
          akteurName: akteur.name,
          sektor: akteur.sektor,
          bezeichnung: biomassestrom.bezeichnung,
          kontaktperson: biomassestrom.kontaktperson,
          ort: biomassestrom.ort,
          landkreis: biomassestrom.landkreis,
          regionIds: sql<string[]>`coalesce((select array_agg(r.id::text order by r.name) from region r where ${geom} is not null and ST_Contains(r.gebiet, ${geom})), '{}')`,
          regionNamen: sql<string[]>`coalesce((select array_agg(r.name order by r.name) from region r where ${geom} is not null and ST_Contains(r.gebiet, ${geom})), '{}')`,
          lng: sql<number | null>`case when ${geom} is null then null else ST_X(${geom}) end`,
          lat: sql<number | null>`case when ${geom} is null then null else ST_Y(${geom}) end`,
          cluster: materialart.cluster,
          materialartCode: biomassestrom.materialartCode,
          materialartLabel: materialart.label,
          mengeFm: biomassestrom.mengeRohFm,
          tsAnteil: biomassestrom.tsAnteilPct,
          aschegehalt: biomassestrom.aschegehaltPct,
          mengeAtro: biomassestrom.mengeAtro,
          preisMin: biomassestrom.preisMin,
          preisMittel: biomassestrom.preisMittel,
          preisMax: biomassestrom.preisMax,
          preisHerkunft: biomassestrom.preisHerkunft,
          zeitraumVon: biomassestrom.zeitraumVon,
          zeitraumBis: biomassestrom.zeitraumBis,
          saisonalitaet: biomassestrom.saisonalitaet,
          qualitaet: biomassestrom.qualitaet,
          status: biomassestrom.status,
          createdAt: biomassestrom.createdAt,
          ...belegSelect,
        })
        .from(biomassestrom)
        .leftJoin(akteur, eq(akteur.id, biomassestrom.akteurId))
        .leftJoin(materialart, eq(materialart.code, biomassestrom.materialartCode))
        .leftJoin(beleg, eq(beleg.id, biomassestrom.belegId))
        .orderBy(desc(biomassestrom.createdAt))
        .limit(500);

      return rows.map((r) => {
        const b = belegAus(r);
        const basis = {
          id: r.id,
          art: "biomasse" as const,
          akteurName: r.akteurName,
          sektor: r.sektor,
          bezeichnung: r.bezeichnung,
          kontaktperson: r.kontaktperson,
          ort: r.ort,
          landkreis: r.landkreis,
          regionIds: r.regionIds,
          regionNamen: r.regionNamen,
          lng: r.lng,
          lat: r.lat,
          cluster: r.cluster,
          materialartCode: r.materialartCode,
          materialartLabel: r.materialartLabel,
          mengeFm: num(r.mengeFm),
          tsAnteil: num(r.tsAnteil),
          aschegehalt: num(r.aschegehalt),
          mengeAtro: num(r.mengeAtro),
          preisMin: num(r.preisMin),
          preisMittel: num(r.preisMittel),
          preisMax: num(r.preisMax),
          preisHerkunft: r.preisHerkunft,
          gruppe: null,
          gruppeLabel: null,
          produktCode: null,
          produktLabel: null,
          kategorie: null,
          mengeWert: null,
          mengeEinheit: null,
          preis: null,
          preisEinheit: null,
          zeitraumVon: r.zeitraumVon,
          zeitraumBis: r.zeitraumBis,
          saisonalitaet: parseSaison(r.saisonalitaet),
          qualitaet: r.qualitaet,
          status: r.status,
          erstelltAm: r.createdAt.toISOString().slice(0, 10),
          beleg: b,
        };
        return {
          ...basis,
          vollstaendigkeit: vollstaendigkeit({
            art: "biomasse",
            bezeichnung: basis.bezeichnung,
            kontaktperson: basis.kontaktperson,
            ort: basis.ort,
            landkreis: basis.landkreis,
            zeitraumVon: basis.zeitraumVon,
            zeitraumBis: basis.zeitraumBis,
            menge: basis.mengeFm,
            tsAnteil: basis.tsAnteil,
            aschegehalt: basis.aschegehalt,
            mengeEinheit: null,
            preis: basis.preisMittel,
            preisEinheit: null,
            saisonalitaet: basis.saisonalitaet,
            beleg: b && {
              typ: b.typ,
              quellenangabe: b.quellenangabe,
              erhebungsdatum: b.erhebungsdatum,
              externNachvollziehbar: b.externNachvollziehbar,
              kernnotiz: b.kernnotiz,
            },
            status: basis.status,
          }),
        };
      });
    }

    const geom = outputBedarf.standortGeom;
    const rows = await db
      .select({
        id: outputBedarf.id,
        akteurName: akteur.name,
        sektor: akteur.sektor,
        bezeichnung: outputBedarf.bezeichnung,
        kontaktperson: outputBedarf.kontaktperson,
        ort: outputBedarf.ort,
        landkreis: outputBedarf.landkreis,
        regionIds: sql<string[]>`coalesce((select array_agg(r.id::text order by r.name) from region r where ${geom} is not null and ST_Contains(r.gebiet, ${geom})), '{}')`,
        regionNamen: sql<string[]>`coalesce((select array_agg(r.name order by r.name) from region r where ${geom} is not null and ST_Contains(r.gebiet, ${geom})), '{}')`,
        lng: sql<number | null>`case when ${geom} is null then null else ST_X(${geom}) end`,
        lat: sql<number | null>`case when ${geom} is null then null else ST_Y(${geom}) end`,
        gruppe: outputProdukt.gruppe,
        produktCode: outputBedarf.produktCode,
        produktLabel: outputProdukt.label,
        kategorie: outputProdukt.art,
        mengeWert: outputBedarf.mengeWert,
        mengeEinheit: outputBedarf.mengeEinheit,
        preis: outputBedarf.preis,
        preisEinheit: outputBedarf.preisEinheit,
        zeitraumVon: outputBedarf.zeitraumVon,
        zeitraumBis: outputBedarf.zeitraumBis,
        saisonalitaet: outputBedarf.saisonalitaet,
        qualitaet: outputBedarf.qualitaet,
        status: outputBedarf.status,
        createdAt: outputBedarf.createdAt,
        ...belegSelect,
      })
      .from(outputBedarf)
      .leftJoin(akteur, eq(akteur.id, outputBedarf.akteurId))
      .leftJoin(outputProdukt, eq(outputProdukt.code, outputBedarf.produktCode))
      .leftJoin(beleg, eq(beleg.id, outputBedarf.belegId))
      .orderBy(desc(outputBedarf.createdAt))
      .limit(500);

    return rows.map((r) => {
      const b = belegAus(r);
      const basis = {
        id: r.id,
        art: "output" as const,
        akteurName: r.akteurName,
        sektor: r.sektor,
        bezeichnung: r.bezeichnung,
        kontaktperson: r.kontaktperson,
        ort: r.ort,
        landkreis: r.landkreis,
        regionIds: r.regionIds,
        regionNamen: r.regionNamen,
        lng: r.lng,
        lat: r.lat,
        cluster: null,
        materialartCode: null,
        materialartLabel: null,
        mengeFm: null,
        tsAnteil: null,
        aschegehalt: null,
        mengeAtro: null,
        preisMin: null,
        preisMittel: null,
        preisMax: null,
        preisHerkunft: null,
        gruppe: r.gruppe,
        gruppeLabel: r.gruppe ? (GRUPPE_LABEL[r.gruppe] ?? r.gruppe) : null,
        produktCode: r.produktCode,
        produktLabel: r.produktLabel,
        kategorie: r.kategorie,
        mengeWert: num(r.mengeWert),
        mengeEinheit: r.mengeEinheit,
        preis: num(r.preis),
        preisEinheit: r.preisEinheit,
        zeitraumVon: r.zeitraumVon,
        zeitraumBis: r.zeitraumBis,
        saisonalitaet: parseSaison(r.saisonalitaet),
        qualitaet: r.qualitaet,
        status: r.status,
        erstelltAm: r.createdAt.toISOString().slice(0, 10),
        beleg: b,
      };
      return {
        ...basis,
        vollstaendigkeit: vollstaendigkeit({
          art: "output",
          bezeichnung: basis.bezeichnung,
          kontaktperson: basis.kontaktperson,
          ort: basis.ort,
          landkreis: basis.landkreis,
          zeitraumVon: basis.zeitraumVon,
          zeitraumBis: basis.zeitraumBis,
          menge: basis.mengeWert,
          tsAnteil: null,
          aschegehalt: null,
          mengeEinheit: basis.mengeEinheit,
          preis: basis.preis,
          preisEinheit: basis.preisEinheit,
          saisonalitaet: basis.saisonalitaet,
          beleg: b && {
            typ: b.typ,
            quellenangabe: b.quellenangabe,
            erhebungsdatum: b.erhebungsdatum,
            externNachvollziehbar: b.externNachvollziehbar,
            kernnotiz: b.kernnotiz,
          },
          status: basis.status,
        }),
      };
    });
  });
}

/** Aenderungshistorie eines Stroms (neueste zuerst). */
export function ladeHistorie(
  art: StromArt,
  id: string,
): Promise<{ zeitpunkt: string; text: string }[]> {
  const entitaetTyp = art === "biomasse" ? "biomassestrom" : "output_bedarf";
  return withDb(async (db) => {
    const rows = await db
      .select({ zeitpunkt: aenderung.zeitpunkt, text: aenderung.text })
      .from(aenderung)
      .where(
        and(eq(aenderung.entitaetTyp, entitaetTyp), eq(aenderung.entitaetId, id)),
      )
      .orderBy(desc(aenderung.zeitpunkt))
      .limit(50);
    return rows.map((r) => ({
      zeitpunkt: r.zeitpunkt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" }),
      text: r.text,
    }));
  });
}

export function ladeRegionOptionen(): Promise<{ id: string; name: string }[]> {
  return withDb((db) =>
    db.select({ id: region.id, name: region.name }).from(region).orderBy(region.name),
  );
}
