import {
  aenderung,
  akteur,
  beleg,
  biomassestrom,
  materialart,
  outputBedarf,
  outputProdukt,
  region,
  vergabeZeitraum,
} from "@bhyo/db/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { withDb, type AppDb } from "@/lib/db";
import {
  formularZeileZuWerte,
  type FormularWerte,
} from "@/lib/formular-modell";
import { type Strom, type StromArt } from "@/lib/stroeme-modell";
import {
  vergabenZuFormZeilen,
  type VergabeDaten,
} from "@/lib/verfuegbarkeit";
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
  belegId: beleg.id,
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
          qualitaet: beleg.qualitaet,
          status: biomassestrom.status,
          reserviertBhyo: biomassestrom.reserviertBhyo,
          reserviertSeit: biomassestrom.reserviertSeit,
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
        qualitaet: beleg.qualitaet,
        status: outputBedarf.status,
        reserviertBhyo: outputBedarf.reserviertBhyo,
        reserviertSeit: outputBedarf.reserviertSeit,
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

// --- Vergaben (AP1j) ---------------------------------------------------------

function vergabenQuery(db: AppDb, art: StromArt, id: string) {
  const elternSpalte =
    art === "biomasse"
      ? vergabeZeitraum.biomassestromId
      : vergabeZeitraum.outputBedarfId;
  return db
    .select({
      vergebenVon: vergabeZeitraum.vergebenVon,
      vergebenBis: vergabeZeitraum.vergebenBis,
      vergebenAn: vergabeZeitraum.vergebenAn,
      anBhyo: vergabeZeitraum.anBhyo,
    })
    .from(vergabeZeitraum)
    .where(eq(elternSpalte, id))
    .orderBy(
      // Offenes von = ab Verfuegbarkeitsbeginn, also nach vorn sortieren.
      sql`${vergabeZeitraum.vergebenVon} NULLS FIRST`,
      vergabeZeitraum.vergebenBis,
    );
}

/** Vergabezeitraeume eines Stroms, sortiert nach normalisiertem Beginn (AP1j). */
export function ladeVergaben(
  art: StromArt,
  id: string,
): Promise<VergabeDaten[]> {
  return withDb((db) => vergabenQuery(db, art, id));
}

/** Alle Vergaben einer Art als Map Strom-ID -> Zeilen (Pool-Anreicherung, PR 3). */
export function ladeAlleVergaben(
  art: StromArt,
): Promise<Map<string, VergabeDaten[]>> {
  return withDb(async (db) => {
    const elternSpalte =
      art === "biomasse"
        ? vergabeZeitraum.biomassestromId
        : vergabeZeitraum.outputBedarfId;
    const rows = await db
      .select({
        stromId: elternSpalte,
        vergebenVon: vergabeZeitraum.vergebenVon,
        vergebenBis: vergabeZeitraum.vergebenBis,
        vergebenAn: vergabeZeitraum.vergebenAn,
        anBhyo: vergabeZeitraum.anBhyo,
      })
      .from(vergabeZeitraum)
      .where(isNotNull(elternSpalte))
      .orderBy(
        sql`${vergabeZeitraum.vergebenVon} NULLS FIRST`,
        vergabeZeitraum.vergebenBis,
      );
    const map = new Map<string, VergabeDaten[]>();
    for (const { stromId, ...v } of rows) {
      const liste = map.get(stromId!) ?? [];
      liste.push(v);
      map.set(stromId!, liste);
    }
    return map;
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

/**
 * Rohwerte eines Stroms fuer das Edit-Formular (PR 5). Nur echte Spalten,
 * keine sql-Ausdruecke; die Konvertierung passiert ausschliesslich im
 * getesteten Mapper formularZeileZuWerte.
 */
export function ladeFormularWerte(
  art: StromArt,
  id: string,
): Promise<FormularWerte | null> {
  return withDb(async (db) => {
    if (art === "biomasse") {
      const [row] = await db
        .select({
          id: biomassestrom.id,
          akteurId: biomassestrom.akteurId,
          akteurName: akteur.name,
          akteurSektor: akteur.sektor,
          bezeichnung: biomassestrom.bezeichnung,
          ort: biomassestrom.ort,
          landkreis: biomassestrom.landkreis,
          strasse: biomassestrom.strasse,
          hausnummer: biomassestrom.hausnummer,
          plz: biomassestrom.plz,
          bundesland: biomassestrom.bundesland,
          lat: sql<unknown>`case when ${biomassestrom.standortGeom} is null then null else ST_Y(${biomassestrom.standortGeom}) end`,
          lng: sql<unknown>`case when ${biomassestrom.standortGeom} is null then null else ST_X(${biomassestrom.standortGeom}) end`,
          kontaktperson: biomassestrom.kontaktperson,
          materialartCode: biomassestrom.materialartCode,
          cluster: materialart.cluster,
          zeitraumVon: biomassestrom.zeitraumVon,
          zeitraumBis: biomassestrom.zeitraumBis,
          mengeRohFm: biomassestrom.mengeRohFm,
          tsAnteilPct: biomassestrom.tsAnteilPct,
          aschegehaltPct: biomassestrom.aschegehaltPct,
          preisMin: biomassestrom.preisMin,
          preisMittel: biomassestrom.preisMittel,
          preisMax: biomassestrom.preisMax,
          preisHerkunft: biomassestrom.preisHerkunft,
          saisonalitaet: biomassestrom.saisonalitaet,
          status: biomassestrom.status,
          reserviertBhyo: biomassestrom.reserviertBhyo,
          reserviertSeit: biomassestrom.reserviertSeit,
          belegId: biomassestrom.belegId,
          belegTyp: beleg.typ,
          belegLinkUrl: beleg.linkUrl,
          belegDateiKey: beleg.dateiKey,
          belegErstelltAm: beleg.erstelltAm,
          belegGueltigBis: beleg.gueltigBis,
          belegExtern: beleg.externNachvollziehbar,
          belegMetadata: beleg.metadata,
        })
        .from(biomassestrom)
        .leftJoin(akteur, eq(akteur.id, biomassestrom.akteurId))
        .leftJoin(materialart, eq(materialart.code, biomassestrom.materialartCode))
        .leftJoin(beleg, eq(beleg.id, biomassestrom.belegId))
        .where(eq(biomassestrom.id, id))
        .limit(1);
      if (!row) return null;
      const vergaben = await vergabenQuery(db, art, id);
      return formularZeileZuWerte(
        "biomasse",
        {
          ...row,
          // Worker-Treiber liefert ST_X/ST_Y als Text — zentrale Konvertierung.
          lat: row.lat == null ? null : Number(row.lat),
          lng: row.lng == null ? null : Number(row.lng),
          produktCode: null,
          mengeWert: null,
          mengeEinheit: null,
          preis: null,
          preisEinheit: null,
        },
        vergabenZuFormZeilen(vergaben),
      );
    }

    const [row] = await db
      .select({
        id: outputBedarf.id,
        akteurId: outputBedarf.akteurId,
        akteurName: akteur.name,
        akteurSektor: akteur.sektor,
        bezeichnung: outputBedarf.bezeichnung,
        ort: outputBedarf.ort,
        landkreis: outputBedarf.landkreis,
        strasse: outputBedarf.strasse,
        hausnummer: outputBedarf.hausnummer,
        plz: outputBedarf.plz,
        bundesland: outputBedarf.bundesland,
        lat: sql<unknown>`case when ${outputBedarf.standortGeom} is null then null else ST_Y(${outputBedarf.standortGeom}) end`,
        lng: sql<unknown>`case when ${outputBedarf.standortGeom} is null then null else ST_X(${outputBedarf.standortGeom}) end`,
        kontaktperson: outputBedarf.kontaktperson,
        produktCode: outputBedarf.produktCode,
        zeitraumVon: outputBedarf.zeitraumVon,
        zeitraumBis: outputBedarf.zeitraumBis,
        mengeWert: outputBedarf.mengeWert,
        mengeEinheit: outputBedarf.mengeEinheit,
        preis: outputBedarf.preis,
        preisEinheit: outputBedarf.preisEinheit,
        preisHerkunft: outputBedarf.preisHerkunft,
        saisonalitaet: outputBedarf.saisonalitaet,
        status: outputBedarf.status,
        reserviertBhyo: outputBedarf.reserviertBhyo,
        reserviertSeit: outputBedarf.reserviertSeit,
        belegId: outputBedarf.belegId,
        belegTyp: beleg.typ,
        belegLinkUrl: beleg.linkUrl,
        belegDateiKey: beleg.dateiKey,
        belegErstelltAm: beleg.erstelltAm,
        belegGueltigBis: beleg.gueltigBis,
        belegExtern: beleg.externNachvollziehbar,
        belegMetadata: beleg.metadata,
      })
      .from(outputBedarf)
      .leftJoin(akteur, eq(akteur.id, outputBedarf.akteurId))
      .leftJoin(beleg, eq(beleg.id, outputBedarf.belegId))
      .where(eq(outputBedarf.id, id))
      .limit(1);
    if (!row) return null;
    const vergaben = await vergabenQuery(db, art, id);
    return formularZeileZuWerte(
      "output",
      {
        ...row,
        lat: row.lat == null ? null : Number(row.lat),
        lng: row.lng == null ? null : Number(row.lng),
        materialartCode: null,
        cluster: null,
        mengeRohFm: null,
        tsAnteilPct: null,
        aschegehaltPct: null,
        preisMin: null,
        preisMittel: null,
        preisMax: null,
      },
      vergabenZuFormZeilen(vergaben),
    );
  });
}

export function ladeRegionOptionen(): Promise<{ id: string; name: string }[]> {
  return withDb((db) =>
    db.select({ id: region.id, name: region.name }).from(region).orderBy(region.name),
  );
}

/**
 * DISTINCT Landkreise beider Tabellen fuer die Landkreis-Combobox (E7:
 * Bestandsdaten + Freitext, keine Lookup-Tabelle). Nur echte Spalten;
 * Deduplizieren und Sortieren in TypeScript.
 */
export function ladeLandkreisOptionen(): Promise<string[]> {
  return withDb(async (db) => {
    const [a, b] = await Promise.all([
      db.selectDistinct({ lk: biomassestrom.landkreis }).from(biomassestrom),
      db.selectDistinct({ lk: outputBedarf.landkreis }).from(outputBedarf),
    ]);
    const alle = [...a, ...b]
      .map((r) => r.lk)
      .filter((x): x is string => typeof x === "string" && x.trim() !== "");
    return [...new Set(alle)].sort((x, y) => x.localeCompare(y, "de"));
  });
}
