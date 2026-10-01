/**
 * AP2.5 PR a1 (E66): Loader fuer akteure. — Liste und Detail, mengenbasiert.
 * Der Kreis-ARS des Sitzes kommt aus der View akteur_verwaltung (E25-Weg,
 * Migration 0035); „seit wann verwaist" aus dem Protokoll (akteur_angelegt
 * oder akteur_geaendert), fuer Altbestand ohne Anlage-Ereignis aus created_at
 * (namentliche Ausnahme, Entscheidung Eric 01.10.2026).
 */
import { sql } from "drizzle-orm";

import type { AppDb } from "./db";
import type { AkteurZeile } from "./akteure-modell";

export type Leser = Pick<AppDb, "execute">;

interface Roh {
  id: string;
  name: string;
  sektor: string | null;
  sektor_label: string | null;
  sitz_strasse: string | null;
  sitz_hausnummer: string | null;
  sitz_plz: string | null;
  sitz_ort: string | null;
  sitz_lng: number | string | null;
  sitz_lat: number | string | null;
  kreis_ars: string | null;
  kreis_name: string | null;
  stroeme: number | string;
  mit_beleg: number | string;
  verwaist_seit: string | null;
  erstellt_am: string;
}

const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

function zeileAus(r: Roh): AkteurZeile {
  return {
    id: r.id,
    name: r.name,
    sektor: r.sektor ?? "ohne_sektor",
    sektorLabel: r.sektor_label ?? "ohne Sektor",
    sitzStrasse: r.sitz_strasse,
    sitzHausnummer: r.sitz_hausnummer,
    sitzPlz: r.sitz_plz,
    sitzOrt: r.sitz_ort,
    sitzLng: num(r.sitz_lng),
    sitzLat: num(r.sitz_lat),
    kreisArs: r.kreis_ars,
    kreisName: r.kreis_name,
    stroeme: Number(r.stroeme),
    mitBeleg: Number(r.mit_beleg),
    verwaistSeit: r.verwaist_seit,
    erstelltAm: r.erstellt_am,
  };
}

/** Grundabfrage: ein Datensatz je Akteur mit Zaehlern, Verwaltung und Verwaist-Datum. */
const ABFRAGE = sql`
  with s as (
    select akteur_id, beleg_id from biomassestrom
    union all
    select akteur_id, beleg_id from output_bedarf
  ), z as (
    select akteur_id, count(*)::int as stroeme, count(beleg_id)::int as mit_beleg from s group by akteur_id
  ), p as (
    select entitaet_id, max(zeitpunkt) as zeitpunkt from aenderung
     where entitaet_typ = 'akteur' and art::text in ('akteur_angelegt', 'akteur_geaendert')
     group by entitaet_id
  )
  select a.id, a.name, a.sektor,
         case when sk.aktiv then sk.label else sk.label || ' (deaktiviert)' end as sektor_label,
         a.sitz_strasse, a.sitz_hausnummer, a.sitz_plz, a.sitz_ort,
         ST_X(a.sitz_geom::geometry) as sitz_lng, ST_Y(a.sitz_geom::geometry) as sitz_lat,
         v.kreis_ars, v.kreis_name,
         coalesce(z.stroeme, 0) as stroeme, coalesce(z.mit_beleg, 0) as mit_beleg,
         case when coalesce(z.stroeme, 0) = 0
              then (coalesce(p.zeitpunkt, a.created_at) at time zone 'Europe/Berlin')::date::text end as verwaist_seit,
         a.created_at::text as erstellt_am
    from akteur a
    left join sektor sk on sk.code = a.sektor
    left join z on z.akteur_id = a.id
    left join p on p.entitaet_id = a.id
    left join akteur_verwaltung v on v.akteur_id = a.id`;

export async function ladeAkteure(db: Leser): Promise<AkteurZeile[]> {
  const rows = (await db.execute(sql`${ABFRAGE} order by a.name`)) as unknown as Roh[];
  return rows.map(zeileAus);
}

export async function ladeAkteur(db: Leser, id: string): Promise<AkteurZeile | null> {
  const rows = (await db.execute(sql`${ABFRAGE} where a.id = ${id}`)) as unknown as Roh[];
  return rows[0] ? zeileAus(rows[0]) : null;
}

export interface AkteurStrom {
  id: string;
  art: "biomasse" | "output";
  bezeichnung: string | null;
  status: string;
  belegNr: string | null;
  belegTyp: string | null;
  ort: string | null;
  lng: number | null;
  lat: number | null;
}

/** Die Stroeme (Belege) eines Akteurs mit Standort — fuer Detail und Karte. */
export async function ladeAkteurStroeme(db: Leser, id: string): Promise<AkteurStrom[]> {
  const rows = (await db.execute(sql`
    select s.id, s.art, s.bezeichnung, s.status::text as status, b.beleg_nr, b.typ::text as beleg_typ, s.ort,
           ST_X(s.standort_geom::geometry) as lng, ST_Y(s.standort_geom::geometry) as lat
      from (
        select id, 'biomasse' as art, bezeichnung, status, beleg_id, ort, standort_geom, created_at from biomassestrom where akteur_id = ${id}
        union all
        select id, 'output', bezeichnung, status, beleg_id, ort, standort_geom, created_at from output_bedarf where akteur_id = ${id}
      ) s
      left join beleg b on b.id = s.beleg_id
     order by s.created_at desc`)) as unknown as {
    id: string; art: "biomasse" | "output"; bezeichnung: string | null; status: string; beleg_nr: string | null; beleg_typ: string | null;
    ort: string | null; lng: number | string | null; lat: number | string | null;
  }[];
  return rows.map((r) => ({ id: r.id, art: r.art, bezeichnung: r.bezeichnung, status: r.status, belegNr: r.beleg_nr, belegTyp: r.beleg_typ, ort: r.ort, lng: num(r.lng), lat: num(r.lat) }));
}

/** Kreis-ARS des Sitzes (E25-Weg) — null, wenn kein Pin oder kein Kreis ihn deckt. */
export async function kreisArsDesSitzes(db: Leser, id: string): Promise<string | null> {
  const rows = (await db.execute(sql`select kreis_ars from akteur_verwaltung where akteur_id = ${id}`)) as unknown as { kreis_ars: string | null }[];
  return rows[0]?.kreis_ars ?? null;
}
