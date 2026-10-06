import { sql } from "drizzle-orm";

import type { AppDb, BelegeBucket } from "@/lib/db";

/**
 * AP2.7 PR b (E67): Roh-Uploads des Imports liegen unter import/<env>/<lauf>/
 * in R2 und koennen Personen-Spalten enthalten. Die Zuordnung loescht sie
 * sofort; was liegen bleibt (Lauf abgebrochen, Loeschen gescheitert), raeumt
 * der taegliche Job spaetestens nach 24 h weg. Reine Entscheidung hier,
 * R2-Zugriff in loescheAlteImportUploads.
 */
export const IMPORT_ROH_AUFBEWAHRUNG_MS = 24 * 60 * 60 * 1000;
export const IMPORT_ROH_PRAEFIX = "import/";

export interface RohObjekt {
  key: string;
  uploaded: Date;
}

/** Alles, was aelter als 24 h ist — Zeitpunkt wird hereingereicht (kein Date.now). */
export function zuLoeschen(objekte: readonly RohObjekt[], jetzt: Date): string[] {
  const grenze = jetzt.getTime() - IMPORT_ROH_AUFBEWAHRUNG_MS;
  return objekte.filter((o) => o.key.startsWith(IMPORT_ROH_PRAEFIX) && o.uploaded.getTime() <= grenze).map((o) => o.key);
}

export interface AufraeumErgebnis {
  gesehen: number;
  geloescht: number;
  fehler: number;
}

export async function loescheAlteImportUploads(bucket: Pick<BelegeBucket, "list" | "delete">, jetzt: Date): Promise<AufraeumErgebnis> {
  const erg: AufraeumErgebnis = { gesehen: 0, geloescht: 0, fehler: 0 };
  let cursor: string | undefined;
  do {
    const seite = await bucket.list({ prefix: IMPORT_ROH_PRAEFIX, cursor });
    erg.gesehen += seite.objects.length;
    for (const key of zuLoeschen(seite.objects, jetzt)) {
      try {
        await bucket.delete(key);
        erg.geloescht += 1;
      } catch (e) {
        erg.fehler += 1;
        console.error("JOB import-aufraeumen: Loeschen fehlgeschlagen", key, e);
      }
    }
    cursor = seite.truncated ? seite.cursor : undefined;
  } while (cursor);
  return erg;
}

/**
 * AP2.7 PR c (E67): Zeilen abgeschlossener Laeufe nach der Aufbewahrungsfrist
 * loeschen — Parameter import.zeilen_aufbewahrung_tage (Migration 0045),
 * aufgeloest am Stichtag wie die anderen Fristen (parameter_wert in SQL).
 * Nur Laeufe ausgefuehrt/zurueckgenommen mit abgeschlossen_am; Zaehler und
 * Protokoll bleiben am Lauf. Ein Statement, der Zeitpunkt kommt herein.
 */
export interface ZeilenAufraeumErgebnis {
  laeufe: number;
  zeilen: number;
}

export async function loescheAlteImportZeilen(db: Pick<AppDb, "execute">, stichtag: string): Promise<ZeilenAufraeumErgebnis> {
  const rows = (await db.execute(sql`
    with faellig as (
      select id from import_lauf
       where status in ('ausgefuehrt', 'zurueckgenommen')
         and abgeschlossen_am is not null
         and (abgeschlossen_am::date + make_interval(days => parameter_wert('import.zeilen_aufbewahrung_tage', ${stichtag}::date))) <= ${stichtag}::date
         and exists (select 1 from import_zeile z where z.lauf_id = import_lauf.id)
    ),
    geloescht as (
      delete from import_zeile where lauf_id in (select id from faellig) returning lauf_id
    )
    select (select count(*)::int from faellig) as laeufe, (select count(*)::int from geloescht) as zeilen`)) as unknown as { laeufe: number; zeilen: number }[];
  return { laeufe: Number(rows[0]?.laeufe ?? 0), zeilen: Number(rows[0]?.zeilen ?? 0) };
}
