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
import { type Strom, type StromArt } from "@/lib/stroeme-modell";
import {
  biomasseZeileZuStrom,
  outputZeileZuStrom,
} from "@/lib/stroeme-zeilen";

/**
 * Datenzugriff fuer stroeme. (AP1i PR 3). Die Seite laedt den kompletten Pool
 * eines Tabs (bis 500 Zeilen, wie bisher) und filtert/sortiert dann mit den
 * reinen Funktionen aus lib/stroeme-modell.ts — exakt die Logik des
 * V2-Mockups. Bei >500 Zeilen greift das Limit; bekannte Einschraenkung, die
 * schon fuer die bisherige Registerliste galt.
 *
 * Die sql<unknown>-Ausdruecke unten sind bewusst NICHT enger typisiert: der
 * Treiber im Worker liefert sie als Zeichenkette, die Konvertierung passiert
 * zentral in lib/stroeme-zeilen.ts. json_agg statt array_agg, damit der Wert
 * notfalls eindeutig als JSON-Text parsebar ist.
 */

// --- Laden -----------------------------------------------------------------

const belegSelect = {
  belegTyp: beleg.typ,
  belegDateiKey: beleg.dateiKey,
  belegLinkUrl: beleg.linkUrl,
  belegExtern: beleg.externNachvollziehbar,
  belegGueltigBis: beleg.gueltigBis,
  belegErstelltAm: beleg.erstelltAm,
  belegMetadata: beleg.metadata,
};

/**
 * Laedt den Pool eines Tabs (max. 500, neueste zuerst). Mit `nurId` laedt sie
 * genau einen Datensatz — fuer Detail-Deeplinks auf Stroeme jenseits des
 * 500er-Limits.
 */
export function ladeStroeme(art: StromArt, nurId?: string): Promise<Strom[]> {
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
          regionIds: sql<unknown>`coalesce((select json_agg(r.id::text order by r.name) from region r where ${geom} is not null and ST_Contains(r.gebiet, ${geom})), '[]'::json)`,
          regionNamen: sql<unknown>`coalesce((select json_agg(r.name order by r.name) from region r where ${geom} is not null and ST_Contains(r.gebiet, ${geom})), '[]'::json)`,
          lng: sql<unknown>`case when ${geom} is null then null else ST_X(${geom}) end`,
          lat: sql<unknown>`case when ${geom} is null then null else ST_Y(${geom}) end`,
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
        .where(nurId ? eq(biomassestrom.id, nurId) : undefined)
        .orderBy(desc(biomassestrom.createdAt))
        .limit(500);

      return rows.map(biomasseZeileZuStrom);
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
        regionIds: sql<unknown>`coalesce((select json_agg(r.id::text order by r.name) from region r where ${geom} is not null and ST_Contains(r.gebiet, ${geom})), '[]'::json)`,
        regionNamen: sql<unknown>`coalesce((select json_agg(r.name order by r.name) from region r where ${geom} is not null and ST_Contains(r.gebiet, ${geom})), '[]'::json)`,
        lng: sql<unknown>`case when ${geom} is null then null else ST_X(${geom}) end`,
        lat: sql<unknown>`case when ${geom} is null then null else ST_Y(${geom}) end`,
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
      .where(nurId ? eq(outputBedarf.id, nurId) : undefined)
      .orderBy(desc(outputBedarf.createdAt))
      .limit(500);

    return rows.map(outputZeileZuStrom);
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

/**
 * Aeltester Log-Eintrag = die beim Anlegen protokollierte Begruendung
 * ("email: text"). Bewusst eigene Abfrage statt Ende der (auf 50 Eintraege
 * begrenzten) Historie.
 */
export function ladeErsteAenderung(
  art: StromArt,
  id: string,
): Promise<string | null> {
  const entitaetTyp = art === "biomasse" ? "biomassestrom" : "output_bedarf";
  return withDb(async (db) => {
    const [row] = await db
      .select({ text: aenderung.text })
      .from(aenderung)
      .where(
        and(eq(aenderung.entitaetTyp, entitaetTyp), eq(aenderung.entitaetId, id)),
      )
      .orderBy(aenderung.zeitpunkt)
      .limit(1);
    return row?.text ?? null;
  });
}

export function ladeRegionOptionen(): Promise<{ id: string; name: string }[]> {
  return withDb((db) =>
    db.select({ id: region.id, name: region.name }).from(region).orderBy(region.name),
  );
}
