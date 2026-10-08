import {
  aenderung,
  akteur,
  beleg,
  biomassestrom,
  materialart,
  outputBedarf,
  outputProdukt,
  region,
  sektor,
  vergabeZeitraum,
} from "@bhyo/db/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { heuteBerlin } from "@/lib/datum";
import { DEAKTIVIERT_SUFFIX } from "@/lib/sektor";
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
  // E28: die kurze Nummer ersetzt die UUID in der Anzeige und ist suchbar.
  belegNr: beleg.belegNr,
  belegTyp: beleg.typ,
  belegDateiKey: beleg.dateiKey,
  belegLinkUrl: beleg.linkUrl,
  belegExtern: beleg.externNachvollziehbar,
  belegGueltigBis: beleg.gueltigBis,
  belegErstelltAm: beleg.erstelltAm,
  belegMetadata: beleg.metadata,
  /** AP2.4 (E62, D3): Ablauf-Markierung des Pruefers — gespeichert, nicht ableitbar. */
  belegAbgelaufenAm: beleg.abgelaufenAm,
};

/**
 * AP2.4 PR a (E62): Verifikationszustand aus der EINEN mengenbasierten
 * SQL-Funktion strom_verifikation(stichtag) (Migration 0032) — als Join,
 * nicht je Zeile. Die Frist zaehlt ab dem Prueftag (Ereignis geprueft), nicht
 * mehr ab der Erhebung; die alte E33-Gesamtfaelligkeit ist damit abgeloest.
 */
const verifikationSelect = {
  verifikationZustand: sql<unknown>`v.zustand`,
  verifiziertAm: sql<unknown>`v.verifiziert_am`,
  verifiziertBis: sql<unknown>`v.verifiziert_bis`,
};
const verifikationJoin = (stichtag: string) => sql`strom_verifikation(${stichtag}::date) as v`;

// AP2.3 PR b: Ein deaktivierter Sektor bleibt an seinen Akteuren und damit im
// Filter sichtbar, solange er verwendet wird — benannt, nicht stumm.
const sektorLabelSql = sql<string | null>`case when ${sektor.aktiv} then ${sektor.label} else ${sektor.label} || ${DEAKTIVIERT_SUFFIX} end`;

/**
 * Laedt den Pool eines Tabs (max. 500, neueste zuerst). Mit `nurId` laedt sie
 * genau einen Datensatz — fuer Detail-Deeplinks auf Stroeme jenseits des
 * 500er-Limits.
 */
export function ladeStroeme(art: StromArt, nurId?: string, stichtag: string = heuteBerlin()): Promise<Strom[]> {
  return withDb(async (db) => {
    if (art === "biomasse") {
      const geom = biomassestrom.standortGeom;
      const rows = await db
        .select({
          id: biomassestrom.id,
          akteurId: biomassestrom.akteurId,
          akteurName: akteur.name,
          sektor: akteur.sektor,
          sektorLabel: sektorLabelSql,
          bezeichnung: biomassestrom.bezeichnung,
          kontaktpersonen: sql<unknown>`coalesce((select json_agg(k.name order by k.name) from kontaktperson k where k.akteur_id = ${biomassestrom.akteurId}), '[]'::json)`,
          ort: biomassestrom.ort,
          // F0b: raeumliche Ableitung ueber die View (E23: nie gespeichert);
          // json-Konvertierung zentral in stroeme-zeilen (verwaltungOderNull).
          verwaltung: sql<unknown>`(select json_build_object('kreisArs', v.kreis_ars, 'kreisName', v.kreis_name, 'kreisBez', v.kreis_bez, 'landArs', v.land_ars, 'landName', v.land_name) from strom_verwaltung v where v.strom_id = ${biomassestrom.id} and v.kreis_ars is not null)`,
          regionIds: sql<unknown>`coalesce((select json_agg(r.id::text order by r.name) from region r where ${geom} is not null and ST_Contains(r.gebiet, ${geom})), '[]'::json)`,
          regionNamen: sql<unknown>`coalesce((select json_agg(r.name order by r.name) from region r where ${geom} is not null and ST_Contains(r.gebiet, ${geom})), '[]'::json)`,
          lng: sql<unknown>`case when ${geom} is null then null else ST_X(${geom}) end`,
          lat: sql<unknown>`case when ${geom} is null then null else ST_Y(${geom}) end`,
          standortGenauigkeit: biomassestrom.standortGenauigkeit,
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
          preisBezug: biomassestrom.preisBezug,
          zeitraumVon: biomassestrom.zeitraumVon,
          zeitraumBis: biomassestrom.zeitraumBis,
          saisonalitaet: biomassestrom.saisonalitaet,
          qualitaet: beleg.qualitaet,
          status: biomassestrom.status,
          reserviertBhyo: biomassestrom.reserviertBhyo,
          reserviertSeit: biomassestrom.reserviertSeit,
          // AP2.3 (E60): Gueltigkeit der Reservierung ab reserviert_seit aus der Parameter-Historie.
          reservierungMonate: sql<unknown>`case when ${biomassestrom.reserviertSeit} is not null then parameter_wert('verifikationsfrist.reservierung', ${biomassestrom.reserviertSeit}) end`,
          createdAt: biomassestrom.createdAt,
          // E44: Sperre und Zuweisungen — Inhaber/Zugewiesene als JSON (json_build_object,
          // nicht array_agg: der Worker-Treiber liefert Arrays als Text).
          gesperrtAm: biomassestrom.gesperrtAm,
          sperrInhaber: sql<unknown>`(select json_build_object('id', b.id, 'name', b.name, 'email', b.email) from benutzer b where b.id = ${biomassestrom.gesperrtVon})`,
          zuweisungen: sql<unknown>`coalesce((select json_agg(json_build_object('id', b.id, 'name', b.name, 'email', b.email) order by b.name, b.email) from strom_zuweisung z join benutzer b on b.id = z.nutzer_id where z.biomassestrom_id = ${biomassestrom.id}), '[]'::json)`,
          ...belegSelect,
          ...verifikationSelect,
        })
        .from(biomassestrom)
        .leftJoin(akteur, eq(akteur.id, biomassestrom.akteurId))
        .leftJoin(sektor, eq(sektor.code, akteur.sektor))
        .leftJoin(materialart, eq(materialart.code, biomassestrom.materialartCode))
        .leftJoin(beleg, eq(beleg.id, biomassestrom.belegId))
        .leftJoin(verifikationJoin(stichtag), sql`v.strom_id = ${biomassestrom.id} and v.art = 'biomasse'`)
        .where(nurId ? eq(biomassestrom.id, nurId) : undefined)
        .orderBy(desc(biomassestrom.createdAt))
        .limit(500);

      return rows.map(biomasseZeileZuStrom);
    }

    const geom = outputBedarf.standortGeom;
    const rows = await db
      .select({
        id: outputBedarf.id,
        akteurId: outputBedarf.akteurId,
        akteurName: akteur.name,
        sektor: akteur.sektor,
        sektorLabel: sektorLabelSql,
        bezeichnung: outputBedarf.bezeichnung,
        kontaktpersonen: sql<unknown>`coalesce((select json_agg(k.name order by k.name) from kontaktperson k where k.akteur_id = ${outputBedarf.akteurId}), '[]'::json)`,
        ort: outputBedarf.ort,
        verwaltung: sql<unknown>`(select json_build_object('kreisArs', v.kreis_ars, 'kreisName', v.kreis_name, 'kreisBez', v.kreis_bez, 'landArs', v.land_ars, 'landName', v.land_name) from strom_verwaltung v where v.strom_id = ${outputBedarf.id} and v.kreis_ars is not null)`,
        regionIds: sql<unknown>`coalesce((select json_agg(r.id::text order by r.name) from region r where ${geom} is not null and ST_Contains(r.gebiet, ${geom})), '[]'::json)`,
        regionNamen: sql<unknown>`coalesce((select json_agg(r.name order by r.name) from region r where ${geom} is not null and ST_Contains(r.gebiet, ${geom})), '[]'::json)`,
        lng: sql<unknown>`case when ${geom} is null then null else ST_X(${geom}) end`,
        lat: sql<unknown>`case when ${geom} is null then null else ST_Y(${geom}) end`,
        standortGenauigkeit: outputBedarf.standortGenauigkeit,
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
        reservierungMonate: sql<unknown>`case when ${outputBedarf.reserviertSeit} is not null then parameter_wert('verifikationsfrist.reservierung', ${outputBedarf.reserviertSeit}) end`,
        createdAt: outputBedarf.createdAt,
        // E44: Sperre und Zuweisungen — Inhaber/Zugewiesene als JSON (json_build_object,
        // nicht array_agg: der Worker-Treiber liefert Arrays als Text).
        gesperrtAm: outputBedarf.gesperrtAm,
        sperrInhaber: sql<unknown>`(select json_build_object('id', b.id, 'name', b.name, 'email', b.email) from benutzer b where b.id = ${outputBedarf.gesperrtVon})`,
        zuweisungen: sql<unknown>`coalesce((select json_agg(json_build_object('id', b.id, 'name', b.name, 'email', b.email) order by b.name, b.email) from strom_zuweisung z join benutzer b on b.id = z.nutzer_id where z.output_bedarf_id = ${outputBedarf.id}), '[]'::json)`,
        ...belegSelect,
        ...verifikationSelect,
      })
      .from(outputBedarf)
      .leftJoin(akteur, eq(akteur.id, outputBedarf.akteurId))
      .leftJoin(sektor, eq(sektor.code, akteur.sektor))
      .leftJoin(outputProdukt, eq(outputProdukt.code, outputBedarf.produktCode))
      .leftJoin(beleg, eq(beleg.id, outputBedarf.belegId))
      .leftJoin(verifikationJoin(stichtag), sql`v.strom_id = ${outputBedarf.id} and v.art = 'output'`)
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
          strasse: biomassestrom.strasse,
          hausnummer: biomassestrom.hausnummer,
          plz: biomassestrom.plz,
          lat: sql<unknown>`case when ${biomassestrom.standortGeom} is null then null else ST_Y(${biomassestrom.standortGeom}) end`,
          lng: sql<unknown>`case when ${biomassestrom.standortGeom} is null then null else ST_X(${biomassestrom.standortGeom}) end`,
          standortGenauigkeit: biomassestrom.standortGenauigkeit,
          kontaktpersonen: sql<unknown>`coalesce((select json_agg(k.name order by k.name) from kontaktperson k where k.akteur_id = ${biomassestrom.akteurId}), '[]'::json)`,
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
          preisBezug: biomassestrom.preisBezug,
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
        strasse: outputBedarf.strasse,
        hausnummer: outputBedarf.hausnummer,
        plz: outputBedarf.plz,
        lat: sql<unknown>`case when ${outputBedarf.standortGeom} is null then null else ST_Y(${outputBedarf.standortGeom}) end`,
        lng: sql<unknown>`case when ${outputBedarf.standortGeom} is null then null else ST_X(${outputBedarf.standortGeom}) end`,
        standortGenauigkeit: outputBedarf.standortGenauigkeit,
        kontaktpersonen: sql<unknown>`coalesce((select json_agg(k.name order by k.name) from kontaktperson k where k.akteur_id = ${outputBedarf.akteurId}), '[]'::json)`,
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
        preisBezug: null,
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

