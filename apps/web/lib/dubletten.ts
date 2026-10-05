/**
 * AP2.5 PR c (E66): Dubletten — Abfragen. Die Aehnlichkeit kommt aus pg_trgm
 * (similarity) ueber akteur_name_norm (Migration 0038); die normalisierten
 * Namen werden je Abfrage einmal materialisiert und paarweise verglichen —
 * Aehnlichkeit ab DUBLETTE_STARK ODER Wort-Teilmenge mit Ortsbezug
 * (akteur_name_wortteilmenge). Der Grad stark/schwach kommt aus
 * lib/akteur-norm.ts (eine Stelle fuer Schwellen und Zusatzregel).
 * Ortsbezug = gleiche PLZ oder Sitz-Abstand <= DUBLETTE_ORT_METER (ST_DWithin
 * ueber sitz_geom als geography; Entscheidung Eric 01.10.2026 — der Kreis
 * allein reicht nicht). Als „keine Dublette" markierte Paare
 * (akteur_keine_dublette) werden nicht vorgeschlagen.
 */
import { sql } from "drizzle-orm";

import { DUBLETTE_ORT_METER, DUBLETTE_STARK, dublettenGrad, type DublettenGrad } from "./akteur-norm";
import type { AppDb } from "./db";

export interface DublettenAkteur {
  id: string;
  name: string;
  sektor: string;
  sektorLabel: string;
  sitzStrasse: string | null;
  sitzHausnummer: string | null;
  sitzPlz: string | null;
  sitzOrt: string | null;
  kreisArs: string | null;
  kreisName: string | null;
  stroeme: number;
  kontaktpersonen: number;
  interessen: number;
}

export interface DublettenPaar {
  a: DublettenAkteur;
  b: DublettenAkteur;
  /** pg_trgm similarity der normalisierten Namen, 0–1 (volle Praezision; gerundet wird in der Anzeige). */
  aehnlichkeit: number;
  gleicherOrt: boolean;
  grad: DublettenGrad;
}

interface Roh {
  [k: string]: unknown;
  sim: number | string;
  teilmenge: boolean | null;
  gleicher_ort: boolean;
}

const SPALTEN = (p: string) => sql.raw(
  `${p}.id as ${p}_id, ${p}.name as ${p}_name, coalesce(${p}.sektor, 'ohne_sektor') as ${p}_sektor,
   case when sk${p}.aktiv then sk${p}.label else coalesce(sk${p}.label || ' (deaktiviert)', 'ohne Sektor') end as ${p}_sektor_label,
   ${p}.sitz_strasse as ${p}_sitz_strasse, ${p}.sitz_hausnummer as ${p}_sitz_hausnummer, ${p}.sitz_plz as ${p}_sitz_plz, ${p}.sitz_ort as ${p}_sitz_ort,
   v${p}.kreis_ars as ${p}_kreis_ars, v${p}.kreis_name as ${p}_kreis_name,
   coalesce(s${p}.n, 0)::int as ${p}_stroeme, coalesce(k${p}.n, 0)::int as ${p}_kontaktpersonen, coalesce(i${p}.n, 0)::int as ${p}_interessen`,
);
const JOINS = (p: string) => sql.raw(
  `left join sektor sk${p} on sk${p}.code = ${p}.sektor
   left join akteur_verwaltung v${p} on v${p}.akteur_id = ${p}.id
   left join (select akteur_id, count(*) as n from (select akteur_id from biomassestrom union all select akteur_id from output_bedarf) u group by akteur_id) s${p} on s${p}.akteur_id = ${p}.id
   left join (select akteur_id, count(*) as n from kontaktperson group by akteur_id) k${p} on k${p}.akteur_id = ${p}.id
   left join (select akteur_id, count(*) as n from akteur_interesse group by akteur_id) i${p} on i${p}.akteur_id = ${p}.id`,
);

function akteurAus(r: Roh, p: string): DublettenAkteur {
  const g = (k: string) => r[`${p}_${k}`];
  return {
    id: String(g("id")),
    name: String(g("name")),
    sektor: String(g("sektor")),
    sektorLabel: String(g("sektor_label")),
    sitzStrasse: (g("sitz_strasse") as string | null) ?? null,
    sitzHausnummer: (g("sitz_hausnummer") as string | null) ?? null,
    sitzPlz: (g("sitz_plz") as string | null) ?? null,
    sitzOrt: (g("sitz_ort") as string | null) ?? null,
    kreisArs: (g("kreis_ars") as string | null) ?? null,
    kreisName: (g("kreis_name") as string | null) ?? null,
    stroeme: Number(g("stroeme")),
    kontaktpersonen: Number(g("kontaktpersonen")),
    interessen: Number(g("interessen")),
  };
}

/** Alle Paare ab der starken Schwelle, ohne markierte „keine Dublette", nach Grad und Aehnlichkeit. */
export async function ladeDubletten(db: AppDb): Promise<DublettenPaar[]> {
  const rows = (await db.execute(sql`
      with n as materialized (
        select id, akteur_name_norm(name) as norm, sitz_plz, sitz_geom from akteur
      ), paar as (
        select x.id as a_id, y.id as b_id,
               similarity(x.norm, y.norm)::float8 as sim,
               akteur_name_wortteilmenge(x.norm, y.norm) as teilmenge,
               ((x.sitz_plz is not null and x.sitz_plz = y.sitz_plz)
                or (x.sitz_geom is not null and y.sitz_geom is not null and ST_DWithin(x.sitz_geom::geography, y.sitz_geom::geography, ${DUBLETTE_ORT_METER}))) as gleicher_ort
          from n x join n y on x.id < y.id
      )
      select ${SPALTEN("a")}, ${SPALTEN("b")}, p.sim, p.teilmenge, p.gleicher_ort
        from paar p
        join akteur a on a.id = p.a_id
        join akteur b on b.id = p.b_id
        ${JOINS("a")}
        ${JOINS("b")}
       where (p.sim >= ${DUBLETTE_STARK} or (p.gleicher_ort and p.teilmenge))
         and not exists (select 1 from akteur_keine_dublette d where d.akteur_a = a.id and d.akteur_b = b.id)`)) as unknown as Roh[];
  const paare: DublettenPaar[] = [];
  for (const r of rows) {
    const sim = Number(r.sim);
    const grad = dublettenGrad(sim, r.gleicher_ort, !!r.teilmenge);
    if (!grad) continue;
    paare.push({ a: akteurAus(r, "a"), b: akteurAus(r, "b"), aehnlichkeit: sim, gleicherOrt: r.gleicher_ort, grad });
  }
  return paare.sort((x, y) => (x.grad === y.grad ? y.aehnlichkeit - x.aehnlichkeit || x.a.name.localeCompare(y.a.name, "de") : x.grad === "stark" ? -1 : 1));
}

export interface Treffer {
  id: string;
  name: string;
  sektor: string;
  sitzPlz: string | null;
  sitzOrt: string | null;
  aehnlichkeit: number;
  grad: DublettenGrad;
}

/**
 * „Meinten Sie …?" beim Anlegen im Beleg: aehnliche Akteure zu einem Namen;
 * Ortsbezug ueber die eingegebene PLZ oder den Abstand des Sitz-Pins
 * (<= DUBLETTE_ORT_METER).
 */
export async function sucheAehnliche(db: AppDb, name: string, plz: string | null, pin: { lng: number; lat: number } | null): Promise<Treffer[]> {
  if (!name.trim()) return [];
  const punkt = pin ? sql`ST_SetSRID(ST_MakePoint(${pin.lng}, ${pin.lat}), 4326)` : sql`null::geometry`;
  const rows = (await db.execute(sql`
      with eingabe as (select akteur_name_norm(${name}) as norm, ${plz || null}::text as plz, ${punkt} as punkt),
      k as (
        select a.id, a.name, coalesce(a.sektor, 'ohne_sektor') as sektor, a.sitz_plz, a.sitz_ort,
               similarity(akteur_name_norm(a.name), e.norm)::float8 as sim,
               akteur_name_wortteilmenge(akteur_name_norm(a.name), e.norm) as teilmenge,
               ((e.plz is not null and a.sitz_plz = e.plz)
                or (e.punkt is not null and a.sitz_geom is not null and ST_DWithin(a.sitz_geom::geography, e.punkt::geography, ${DUBLETTE_ORT_METER}))) as gleicher_ort
          from akteur a cross join eingabe e
      )
      select * from k
       where sim >= ${DUBLETTE_STARK} or (gleicher_ort and teilmenge)
       order by sim desc, name
       limit 8`)) as unknown as { id: string; name: string; sektor: string; sitz_plz: string | null; sitz_ort: string | null; sim: number | string; teilmenge: boolean | null; gleicher_ort: boolean | null }[];
  const treffer: Treffer[] = [];
  for (const r of rows) {
    const grad = dublettenGrad(Number(r.sim), !!r.gleicher_ort, !!r.teilmenge);
    if (grad) treffer.push({ id: r.id, name: r.name, sektor: r.sektor, sitzPlz: r.sitz_plz, sitzOrt: r.sitz_ort, aehnlichkeit: Number(r.sim), grad });
  }
  return treffer.sort((x, y) => (x.grad === y.grad ? y.aehnlichkeit - x.aehnlichkeit : x.grad === "stark" ? -1 : 1));
}

export interface KeineDublette {
  id: string;
  a: DublettenAkteur;
  b: DublettenAkteur;
  seit: string;
}

/** Als „keine Dublette" markierte Paare — zum Aufheben (nur Pruefer/Admin). */
export async function ladeKeineDubletten(db: AppDb): Promise<KeineDublette[]> {
  const rows = (await db.execute(sql`
    select d.id as paar_id, d.created_at::text as seit, ${SPALTEN("a")}, ${SPALTEN("b")}
      from akteur_keine_dublette d
      join akteur a on a.id = d.akteur_a
      join akteur b on b.id = d.akteur_b
      ${JOINS("a")}
      ${JOINS("b")}
     order by d.created_at desc`)) as unknown as (Roh & { paar_id: string; seit: string })[];
  return rows.map((r) => ({ id: r.paar_id, a: akteurAus(r, "a"), b: akteurAus(r, "b"), seit: r.seit }));
}

/** Text des Zusammenfuehrungs-Ereignisses — nur IDs (E57); der Trigger liest „Ziel <id>". */
export function zusammenfuehrungsText(quelleId: string, zielId: string): string {
  return `Quelle ${quelleId} → Ziel ${zielId}`;
}

/**
 * Alte Links zur Quelle leiten ueber das Protokoll aufs Ziel: das Ereignis
 * akteur_zusammengefuehrt der Quelle nennt das Ziel; ist das Ziel selbst
 * spaeter zusammengefuehrt worden, wird der Kette gefolgt (hoechstens 10).
 */
export async function zielNachZusammenfuehrung(db: Pick<AppDb, "execute">, id: string): Promise<string | null> {
  let aktuell = id;
  for (let i = 0; i < 10; i++) {
    const rows = (await db.execute(sql`
      select text from aenderung
       where entitaet_typ = 'akteur' and entitaet_id = ${aktuell} and art::text = 'akteur_zusammengefuehrt'
       order by zeitpunkt desc limit 1`)) as unknown as { text: string }[];
    const ziel = rows[0]?.text.match(/Ziel ([0-9a-f-]{36})/)?.[1];
    if (!ziel) return aktuell === id ? null : aktuell;
    const [existiert] = (await db.execute(sql`select 1 as x from akteur where id = ${ziel}`)) as unknown as { x: number }[];
    if (existiert) return ziel;
    aktuell = ziel;
  }
  return null;
}
