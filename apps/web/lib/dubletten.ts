/**
 * AP2.5 PR c (E66): Dubletten — Abfragen. Die Aehnlichkeit kommt aus pg_trgm
 * ueber akteur_name_norm (Migration 0038): der %-Operator mit der Schwelle
 * DUBLETTE_STARK (set_config in der Transaktion, nutzt den GIN-Index), der
 * Grad stark/schwach aus lib/akteur-norm.ts (eine Stelle fuer die Schwellen).
 * Ortsbezug = gleiche PLZ oder gleicher Kreis-ARS (View akteur_verwaltung,
 * E25-Weg). Als „keine Dublette" markierte Paare (akteur_keine_dublette)
 * werden nicht vorgeschlagen.
 */
import { sql } from "drizzle-orm";

import { DUBLETTE_STARK, dublettenGrad, type DublettenGrad } from "./akteur-norm";
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
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('pg_trgm.similarity_threshold', ${String(DUBLETTE_STARK)}, true)`);
    return (await tx.execute(sql`
      select ${SPALTEN("a")}, ${SPALTEN("b")},
             similarity(akteur_name_norm(a.name), akteur_name_norm(b.name))::float8 as sim,
             ((a.sitz_plz is not null and a.sitz_plz = b.sitz_plz) or (va.kreis_ars is not null and va.kreis_ars = vb.kreis_ars)) as gleicher_ort
        from akteur a
        join akteur b on a.id < b.id and akteur_name_norm(a.name) % akteur_name_norm(b.name)
        ${JOINS("a")}
        ${JOINS("b")}
       where not exists (select 1 from akteur_keine_dublette d where d.akteur_a = a.id and d.akteur_b = b.id)`)) as unknown as Roh[];
  });
  const paare: DublettenPaar[] = [];
  for (const r of rows) {
    const sim = Number(r.sim);
    const grad = dublettenGrad(sim, r.gleicher_ort);
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
 * Ortsbezug ueber die eingegebene PLZ oder den Kreis des Pins (derselbe
 * ST_Covers-Weg wie akteur_verwaltung, E25).
 */
export async function sucheAehnliche(db: AppDb, name: string, plz: string | null, pin: { lng: number; lat: number } | null): Promise<Treffer[]> {
  if (!name.trim()) return [];
  const punkt = pin ? sql`ST_SetSRID(ST_MakePoint(${pin.lng}, ${pin.lat}), 4326)` : sql`null::geometry`;
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('pg_trgm.similarity_threshold', ${String(DUBLETTE_STARK)}, true)`);
    return (await tx.execute(sql`
      with eingabe as (
        select ${plz || null}::text as plz,
               (select k.ars from verwaltungsgebiet k where k.ebene = 'kreis' and ${punkt} is not null and ST_Covers(k.geom, ${punkt}) order by k.ars limit 1) as kreis_ars
      )
      select a.id, a.name, coalesce(a.sektor, 'ohne_sektor') as sektor, a.sitz_plz, a.sitz_ort,
             similarity(akteur_name_norm(a.name), akteur_name_norm(${name})) ::float8 as sim,
             ((e.plz is not null and a.sitz_plz = e.plz) or (e.kreis_ars is not null and v.kreis_ars = e.kreis_ars)) as gleicher_ort
        from akteur a
        cross join eingabe e
        left join akteur_verwaltung v on v.akteur_id = a.id
       where akteur_name_norm(a.name) % akteur_name_norm(${name})
       order by sim desc, a.name
       limit 8`)) as unknown as { id: string; name: string; sektor: string; sitz_plz: string | null; sitz_ort: string | null; sim: number | string; gleicher_ort: boolean | null }[];
  });
  const treffer: Treffer[] = [];
  for (const r of rows) {
    const grad = dublettenGrad(Number(r.sim), !!r.gleicher_ort);
    if (grad) treffer.push({ id: r.id, name: r.name, sektor: r.sektor, sitzPlz: r.sitz_plz, sitzOrt: r.sitz_ort, aehnlichkeit: Number(r.sim), grad });
  }
  return treffer.sort((x, y) => (x.grad === y.grad ? y.aehnlichkeit - x.aehnlichkeit : x.grad === "stark" ? -1 : 1));
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
