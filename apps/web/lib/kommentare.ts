/**
 * AP2.6 PR b (E71): Loader der Kommentare eines Objekts (nur SELECT).
 * Chronologisch aufsteigend (neuester unten); Autor und erwaehnte Nutzer
 * werden zur Lesezeit aus benutzer aufgeloest — gespeichert ist nur die ID
 * (Marker im Text, Zeile in kommentar_erwaehnung). Geloeschte Kommentare
 * bleiben in der Liste (Text NULL), damit der Verlauf „Kommentar geloescht"
 * zeigen kann.
 */
import { sql } from "drizzle-orm";

import type { AppDb } from "./db";
import type { Kommentar, KommentarNutzer } from "./kommentar-modell";
import type { KommentarBezug } from "./kommentar-schreibweg";

export type Leser = Pick<AppDb, "execute">;

interface Roh {
  id: string;
  biomassestrom_id: string | null;
  output_bedarf_id: string | null;
  akteur_id: string | null;
  autor_id: string;
  autor_name: string | null;
  autor_email: string;
  autor_aktiv: boolean;
  text: string | null;
  erstellt_am: string | Date;
  bearbeitet_am: string | Date | null;
  geloescht_am: string | Date | null;
  erwaehnte: unknown;
}

const SPALTE: Record<KommentarBezug["art"], ReturnType<typeof sql>> = {
  biomasse: sql`k.biomassestrom_id`,
  output: sql`k.output_bedarf_id`,
  akteur: sql`k.akteur_id`,
};

function iso(v: string | Date | null): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/** json_agg kommt je Treiber als Objekt oder als Text an (Worker-Treiber, siehe stroeme-zeilen.ts) — hier eine Stelle. */
function erwaehnteAus(v: unknown): KommentarNutzer[] {
  const roh = typeof v === "string" ? (JSON.parse(v) as unknown) : v;
  if (!Array.isArray(roh)) return [];
  return roh.map((e) => ({ id: String(e.id), name: e.name ?? null, email: String(e.email ?? ""), aktiv: e.aktiv !== false }));
}

export async function ladeKommentare(db: Leser, bezug: KommentarBezug): Promise<Kommentar[]> {
  const rows = (await db.execute(sql`
    select k.id, k.biomassestrom_id, k.output_bedarf_id, k.akteur_id, k.autor_id,
           b.name as autor_name, b.email as autor_email, b.aktiv as autor_aktiv,
           k.text, k.erstellt_am, k.bearbeitet_am, k.geloescht_am,
           coalesce((select json_agg(json_build_object('id', n.id, 'name', n.name, 'email', n.email, 'aktiv', n.aktiv) order by n.email)
                       from kommentar_erwaehnung e join benutzer n on n.id = e.nutzer_id where e.kommentar_id = k.id), '[]'::json) as erwaehnte
      from kommentar k
      join benutzer b on b.id = k.autor_id
     where ${SPALTE[bezug.art]} = ${bezug.id}
     order by k.erstellt_am, k.id`)) as unknown as Roh[];
  return rows.map((r) => ({
    id: r.id,
    bezug,
    autor: { id: r.autor_id, name: r.autor_name, email: r.autor_email, aktiv: r.autor_aktiv },
    text: r.text,
    erstelltAm: iso(r.erstellt_am)!,
    bearbeitetAm: iso(r.bearbeitet_am),
    geloeschtAm: iso(r.geloescht_am),
    erwaehnte: erwaehnteAus(r.erwaehnte),
  }));
}
