import { importLauf, importZeile } from "@bhyo/db/schema";
import { eq, sql } from "drizzle-orm";

import type { AppDb, BelegeBucket } from "@/lib/db";
import { importBelegKey } from "@/lib/import-server";
import { protokolliere, type Schreiber } from "@/lib/protokoll";

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

/**
 * AP2.7 PR g (Eric 07.10.2026): einen nie ausgefuehrten Lauf verwerfen — EINE
 * Regel fuer die Aktion (import-actions.ts) und den Job: Zeilen loeschen
 * (Zwischendaten, keine Stroeme), Status „verworfen", Zeitpunkt, Zaehler,
 * Ereignis am Lauf. Der Urheber ist beim Job der Ersteller des Laufs; der
 * Text nennt den Job ausdruecklich.
 */
export type VerwerfSchreiber = Schreiber & Pick<AppDb, "delete">;

export async function verwirfLauf(tx: VerwerfSchreiber, laufId: string, urheber: { benutzerId: string; benutzerEmail: string; text: string }): Promise<{ zeilen: number }> {
  const geloescht = await tx.delete(importZeile).where(eq(importZeile.laufId, laufId)).returning({ id: importZeile.id });
  const [lauf] = await tx.select({ zaehler: importLauf.zaehler }).from(importLauf).where(eq(importLauf.id, laufId)).limit(1);
  const zaehler: Record<string, number> = { ...(lauf?.zaehler ?? {}), offen: 0, fehler: 0, verworfen_zeilen: geloescht.length };
  await tx.update(importLauf).set({ status: "verworfen", verworfenAm: new Date(), zaehler, updatedAt: new Date() }).where(eq(importLauf.id, laufId));
  await protokolliere(tx, {
    art: "status_gesetzt",
    entitaet: "import_lauf",
    id: laufId,
    benutzerId: urheber.benutzerId,
    benutzerEmail: urheber.benutzerEmail,
    text: `Import-Lauf verworfen (nie ausgeführt, ${urheber.text}): ${geloescht.length} Zeile(n) gelöscht`,
    importLaufId: laufId,
  });
  return { zeilen: geloescht.length };
}

export interface VerwerfJobErgebnis {
  laeufe: number;
  zeilen: number;
}

/**
 * Liegengebliebene Laeufe (PR g): nie ausgefuehrt und seit
 * import.lauf_inaktiv_tage Tagen ohne Aktivitaet (updated_at) — der Job
 * verwirft sie wie die Hand-Aktion. Eigener Parameter (Migration 0049), weil
 * er das Ende eines nie abgeschlossenen Laufs regelt, nicht die Aufbewahrung
 * von Zwischendaten abgeschlossener Laeufe. Die bereinigte Kopie in R2 geht
 * mit (Roh-Uploads raeumt loescheAlteImportUploads nach 24 h).
 */
export async function verwirfInaktiveLaeufe(db: AppDb, stichtag: string, r2?: { bucket: Pick<BelegeBucket, "delete">; env: string }): Promise<VerwerfJobErgebnis> {
  const faellig = (await db.execute(sql`
    select l.id, l.ersteller_id, b.email,
           parameter_wert('import.lauf_inaktiv_tage', ${stichtag}::date) as tage
      from import_lauf l join benutzer b on b.id = l.ersteller_id
     where l.status in ('angelegt', 'zugeordnet', 'aufgeloest', 'probelauf', 'fehler')
       and (l.updated_at::date + make_interval(days => parameter_wert('import.lauf_inaktiv_tage', ${stichtag}::date))) <= ${stichtag}::date
     order by l.created_at`)) as unknown as { id: string; ersteller_id: string; email: string; tage: number }[];
  let zeilen = 0;
  for (const f of faellig) {
    const erg = await db.transaction((tx) => verwirfLauf(tx as unknown as VerwerfSchreiber, f.id, { benutzerId: f.ersteller_id, benutzerEmail: f.email, text: `vom täglichen Job nach ${f.tage} Tagen ohne Aktivität` }));
    zeilen += erg.zeilen;
    if (r2) await r2.bucket.delete(importBelegKey(r2.env, f.id)).catch((e) => console.error("JOB import-verwerfen: R2-Objekt nicht gelöscht", f.id, e));
  }
  return { laeufe: faellig.length, zeilen };
}
