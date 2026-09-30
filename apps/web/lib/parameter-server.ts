/**
 * AP2.3 (E60): Lesen der Parameter — der aktuelle Wert kommt IMMER aus der
 * SQL-Funktion parameter_wert(schluessel, stichtag) (eine Logik, Migration
 * 0029); der Verlauf ist eine Liste der Zeilen. Kein Standardwert: fehlt ein
 * Wert, wirft die Funktion.
 */
import { benutzer, parameterDefinition, parameterWert } from "@bhyo/db/schema";
import { asc, eq, sql } from "drizzle-orm";

import type { AppDb } from "@/lib/db";
import { gruppeVon, type ParameterDefinition } from "@/lib/parameter";

export type Leser = Pick<AppDb, "select" | "execute">;

export interface VerlaufZeile {
  id: string;
  wert: number;
  /** JJJJ-MM-TT oder '-infinity' (seit Einfuehrung). */
  gueltigAb: string;
  begruendung: string;
  erstelltAm: string;
  erstelltVon: { id: string; name: string | null; email: string } | null;
}

export interface ParameterUebersicht extends ParameterDefinition {
  gruppe: string;
  /** Wert, der heute gilt — aus parameter_wert(schluessel, heute). */
  aktuell: number;
  /** gueltig_ab der heute geltenden Zeile. */
  aktuellSeit: string;
  /** Geplante kuenftige Aenderungen (gueltig_ab > heute), aufsteigend. */
  geplant: VerlaufZeile[];
  /** Kompletter Verlauf, neueste zuerst. */
  verlauf: VerlaufZeile[];
}

/** Der TS-Wrapper der SQL-Funktion — die einzige Lesestelle fuer „welcher Wert gilt". */
export async function parameterWertAm(db: Leser, schluessel: string, stichtag: string): Promise<number> {
  const zeilen = (await db.execute(sql`select parameter_wert(${schluessel}, ${stichtag}::date) as wert`)) as unknown as Array<{ wert: number | string }>;
  const w = zeilen[0]?.wert;
  if (w == null) throw new Error(`Kein Parameterwert für ${schluessel} am ${stichtag}.`);
  return Number(w);
}

export async function ladeParameterUebersicht(db: Leser, heute: string): Promise<ParameterUebersicht[]> {
  const defs = await db.select().from(parameterDefinition).orderBy(asc(parameterDefinition.schluessel));
  const zeilen = await db
    .select({
      id: parameterWert.id,
      schluessel: parameterWert.schluessel,
      wert: parameterWert.wert,
      gueltigAb: parameterWert.gueltigAb,
      begruendung: parameterWert.begruendung,
      erstelltAm: parameterWert.erstelltAm,
      vonId: benutzer.id,
      vonName: benutzer.name,
      vonEmail: benutzer.email,
    })
    .from(parameterWert)
    .leftJoin(benutzer, eq(benutzer.id, parameterWert.erstelltVon))
    .orderBy(asc(parameterWert.schluessel), asc(parameterWert.gueltigAb));
  const ergebnis: ParameterUebersicht[] = [];
  for (const d of defs) {
    const eigene = zeilen
      .filter((z) => z.schluessel === d.schluessel)
      .map<VerlaufZeile>((z) => ({
        id: z.id,
        wert: z.wert,
        gueltigAb: String(z.gueltigAb),
        begruendung: z.begruendung,
        erstelltAm: z.erstelltAm.toISOString(),
        erstelltVon: z.vonId ? { id: z.vonId, name: z.vonName, email: z.vonEmail ?? "" } : null,
      }));
    const aktuell = await parameterWertAm(db, d.schluessel, heute);
    // gueltig_ab der geltenden Zeile: die groesste <= heute ('-infinity' sortiert zuerst).
    const geltend = [...eigene].filter((z) => z.gueltigAb.startsWith("-infinity") || z.gueltigAb <= heute).pop();
    ergebnis.push({
      ...d,
      gruppe: gruppeVon(d.schluessel),
      aktuell,
      aktuellSeit: geltend?.gueltigAb ?? "-infinity",
      geplant: eigene.filter((z) => !z.gueltigAb.startsWith("-infinity") && z.gueltigAb > heute),
      verlauf: [...eigene].reverse(),
    });
  }
  return ergebnis;
}
