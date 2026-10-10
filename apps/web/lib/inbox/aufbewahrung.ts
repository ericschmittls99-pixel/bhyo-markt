/**
 * AP2.6 PR d (E71 Punkt 9, D14): Aufbewahrung der Inbox-Eintraege, fuer alle
 * Typen — erledigt (oder verworfen) → nach inbox.aufbewahrung_erledigt_tage
 * Tagen loeschen, gelesen und noch offen → nach inbox.aufbewahrung_gelesen_tage
 * Tagen; ungelesene bleiben. Tagesgenau in Europe/Berlin, die Fristen kommen
 * aus parameter_wert am Stichtag (E60). Ausgefuehrt im taeglichen Job
 * (worker.ts, nach dem Verifikations-Job). Ein Statement, der Stichtag kommt
 * herein (kein Date.now).
 *
 * Ausgenommen sind die zustandsbasierten Hinweise des Jobs: ihre
 * Idempotenz-Indizes gelten ueber alle Zustaende („dauerhaft") — ein
 * geloeschter Eintrag entstuende beim naechsten Lauf als neuer, ungelesener
 * Hinweis, solange seine Bedingung gilt (Stufe 0 „frei seit", abgelaufene
 * Verifikation, verwaister Akteur). Sie werden vom Job selbst erledigt, wenn
 * die Bedingung endet, und bleiben dann als erledigte Zeile (OFFEN im PR).
 *
 * Diese Datei ist die einzige Stelle, die inbox_eintrag loescht (lib/inbox,
 * inbox-check).
 */
import { sql } from "drizzle-orm";

import type { AppDb } from "../db";
import type { InboxTyp } from "./register";

/** Typen, die der taegliche Job zustandsbasiert zustellt und abraeumt (lib/inbox/hinweise.ts). */
export const JOB_HINWEIS_TYPEN = [
  "verifikation_laeuft_ab",
  "verifikation_abgelaufen",
  "akteur_verwaist",
  "kontaktperson_loeschpruefung",
  "biomasse_wird_frei",
  // AP2.9 Umschalten: Hinweise des Roundup-Jobs (lib/inbox/mail-hinweise.ts).
  "mail_stoerung",
  "mail_secret_laeuft_ab",
] as const satisfies readonly InboxTyp[];

export const PARAMETER_ERLEDIGT = "inbox.aufbewahrung_erledigt_tage";
export const PARAMETER_GELESEN = "inbox.aufbewahrung_gelesen_tage";

export interface AufbewahrungErgebnis {
  /** Geloeschte Eintraege im Zustand erledigt oder verworfen. */
  erledigt: number;
  /** Geloeschte offene, gelesene Eintraege. */
  gelesen: number;
}

export async function raeumeInboxAuf(db: Pick<AppDb, "execute">, stichtag: string): Promise<AufbewahrungErgebnis> {
  const ausgenommen = sql.join(
    JOB_HINWEIS_TYPEN.map((t) => sql`${t}`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    with grenzen as (
      select parameter_wert(${PARAMETER_ERLEDIGT}, ${stichtag}::date) as erledigt_tage,
             parameter_wert(${PARAMETER_GELESEN}, ${stichtag}::date) as gelesen_tage
    ),
    weg_erledigt as (
      delete from inbox_eintrag e using grenzen g
       where e.zustand in ('erledigt', 'verworfen')
         and inbox_typ_text(e.typ) not in (${ausgenommen})
         and ((e.zustand_seit at time zone 'Europe/Berlin')::date + make_interval(days => g.erledigt_tage)) <= ${stichtag}::date
       returning e.id
    ),
    weg_gelesen as (
      delete from inbox_eintrag e using grenzen g
       where e.zustand = 'offen'
         and e.gelesen_am is not null
         and inbox_typ_text(e.typ) not in (${ausgenommen})
         and ((e.gelesen_am at time zone 'Europe/Berlin')::date + make_interval(days => g.gelesen_tage)) <= ${stichtag}::date
       returning e.id
    )
    select (select count(*)::int from weg_erledigt) as erledigt, (select count(*)::int from weg_gelesen) as gelesen`)) as unknown as {
    erledigt: number;
    gelesen: number;
  }[];
  return { erledigt: Number(rows[0]?.erledigt ?? 0), gelesen: Number(rows[0]?.gelesen ?? 0) };
}
