/**
 * AP2.5 PR b: Loader fuer Kontaktpersonen (nur SELECT). Die letzte Aktivitaet
 * (E57) ist die juengste Aenderung an der Person oder an einem Beleg
 * (Strom-Eintrag, E48) ihres Akteurs — aus Protokoll und Zeitstempeln
 * abgeleitet, nie gespeichert.
 */
import { sql } from "drizzle-orm";

import type { AppDb } from "./db";
import type { Kontaktperson } from "./kontaktperson-modell";

export type Leser = Pick<AppDb, "execute">;

interface Roh {
  id: string;
  akteur_id: string;
  name: string;
  funktion: string | null;
  mail_dienstlich: string | null;
  telefon: string | null;
  notiz: string | null;
  created_at: string;
  updated_at: string;
  letzte_aktivitaet: string | null;
}

const ABFRAGE = sql`
  with stroeme as (
    select id, akteur_id from biomassestrom union all select id, akteur_id from output_bedarf
  ), beleg_aktivitaet as (
    select s.akteur_id, max(a.zeitpunkt) as zeitpunkt
      from stroeme s join aenderung a on a.entitaet_id = s.id and a.entitaet_typ in ('biomassestrom', 'output_bedarf')
     group by s.akteur_id
  ), person_aktivitaet as (
    select entitaet_id, max(zeitpunkt) as zeitpunkt from aenderung where entitaet_typ = 'kontaktperson' group by entitaet_id
  )
  select k.id, k.akteur_id, k.name, k.funktion, k.mail_dienstlich, k.telefon, k.notiz,
         k.created_at::text as created_at, k.updated_at::text as updated_at,
         (greatest(k.updated_at, coalesce(pa.zeitpunkt, k.created_at), coalesce(ba.zeitpunkt, k.created_at)) at time zone 'Europe/Berlin')::date::text as letzte_aktivitaet
    from kontaktperson k
    left join person_aktivitaet pa on pa.entitaet_id = k.id
    left join beleg_aktivitaet ba on ba.akteur_id = k.akteur_id`;

function zeile(r: Roh): Kontaktperson {
  return {
    id: r.id,
    akteurId: r.akteur_id,
    name: r.name,
    funktion: r.funktion,
    mailDienstlich: r.mail_dienstlich,
    telefon: r.telefon,
    notiz: r.notiz,
    erstelltAm: r.created_at,
    geaendertAm: r.updated_at,
    letzteAktivitaet: r.letzte_aktivitaet,
  };
}

export async function ladeKontaktpersonen(db: Leser, akteurId: string): Promise<Kontaktperson[]> {
  const rows = (await db.execute(sql`${ABFRAGE} where k.akteur_id = ${akteurId} order by k.name`)) as unknown as Roh[];
  return rows.map(zeile);
}

export async function ladeKontaktperson(db: Leser, id: string): Promise<Kontaktperson | null> {
  const rows = (await db.execute(sql`${ABFRAGE} where k.id = ${id}`)) as unknown as Roh[];
  return rows[0] ? zeile(rows[0]) : null;
}

export interface KontaktpersonEreignis {
  zeitpunkt: string;
  art: string;
  text: string;
  benutzerEmail: string | null;
}

/** Alle Protokollereignisse zur Person (Art. 15) — Freitext enthaelt nur IDs und Feldnamen. */
export async function ladeKontaktpersonEreignisse(db: Leser, id: string): Promise<KontaktpersonEreignis[]> {
  const rows = (await db.execute(sql`
    select zeitpunkt::text as zeitpunkt, art::text as art, text, benutzer_email
      from aenderung where entitaet_typ = 'kontaktperson' and entitaet_id = ${id} order by zeitpunkt`)) as unknown as {
    zeitpunkt: string; art: string; text: string; benutzer_email: string | null;
  }[];
  return rows.map((r) => ({ zeitpunkt: r.zeitpunkt, art: r.art, text: r.text, benutzerEmail: r.benutzer_email }));
}
