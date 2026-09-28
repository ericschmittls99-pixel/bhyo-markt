import { biomassestrom, outputBedarf } from "@bhyo/db/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { withDb } from "@/lib/db";
import { zugangFuerRoute } from "@/lib/rechte/wache";

/**
 * Vorhandene Standorte eines Akteurs (F0a): speist den Formular-Knopf
 * "Adresse von bestehendem Standort uebernehmen". Reines Kopieren
 * vorhandener Stromdaten — bewusst KEINE Adresse am Akteur (Entscheidung
 * 23.09.2026, ap0-schema-entscheidungen Abschnitt 7).
 */
export async function GET(req: Request) {
  // F8/E30: auch Lesen laeuft ueber die Wache — eine unbekannte oder
  // deaktivierte Adresse darf keine Daten sehen (fail closed).
  const wache = await zugangFuerRoute();
  if (!wache.ok) return wache.antwort;
  const akteurId = new URL(req.url).searchParams.get("akteur");
  if (!akteurId) return Response.json({ standorte: [] });

  const standorte = await withDb(async (db) => {
    const felder = (t: typeof biomassestrom | typeof outputBedarf) => ({
      ort: t.ort,
      strasse: t.strasse,
      hausnummer: t.hausnummer,
      plz: t.plz,
      lat: sql<unknown>`case when ${t.standortGeom} is null then null else ST_Y(${t.standortGeom}) end`,
      lng: sql<unknown>`case when ${t.standortGeom} is null then null else ST_X(${t.standortGeom}) end`,
    });
    // "Mit Adresse" heisst: mindestens ein Ort ist erfasst.
    const [a, b] = await Promise.all([
      db
        .select(felder(biomassestrom))
        .from(biomassestrom)
        .where(and(eq(biomassestrom.akteurId, akteurId), isNotNull(biomassestrom.ort))),
      db
        .select(felder(outputBedarf))
        .from(outputBedarf)
        .where(and(eq(outputBedarf.akteurId, akteurId), isNotNull(outputBedarf.ort))),
    ]);
    const num = (v: unknown) => (v == null ? null : Number(v));
    const zeilen = [...a, ...b].map((r) => ({
      ort: r.ort,
      strasse: r.strasse,
      hausnummer: r.hausnummer,
      plz: r.plz,
      lat: num(r.lat),
      lng: num(r.lng),
    }));
    // Dedupe ueber alle Adressteile (ohne Koordinaten-Nachkommarauschen).
    const key = (z: (typeof zeilen)[number]) =>
      [z.strasse, z.hausnummer, z.plz, z.ort, z.lat?.toFixed(5), z.lng?.toFixed(5)].join("|");
    const gesehen = new Set<string>();
    return zeilen.filter((z) => {
      const k = key(z);
      if (gesehen.has(k)) return false;
      gesehen.add(k);
      return true;
    });
  });

  return Response.json({ standorte });
}
