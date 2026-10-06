import { benutzer, importLauf } from "@bhyo/db/schema";
import { and, desc, eq, ne } from "drizzle-orm";

import type { AppDb } from "@/lib/db";
import { dateiEndung } from "@/lib/import-datei";

/**
 * AP2.7 PR b (E67): Lesen rund um den Import-Lauf und der R2-Schluessel des
 * Roh-Uploads. Kein "use server" — Bausteine fuer Seiten und Actions.
 */

export interface ImportLaufZeile {
  id: string;
  art: string;
  dateiname: string;
  dateiHash: string;
  belegTyp: string;
  standardSektor: string;
  status: string;
  zaehler: Record<string, number> | null;
  erstellerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type Leser = Pick<AppDb, "select">;

export function ladeImportLaeufe(db: Leser): Promise<ImportLaufZeile[]> {
  return db
    .select({
      id: importLauf.id,
      art: importLauf.art,
      dateiname: importLauf.dateiname,
      dateiHash: importLauf.dateiHash,
      belegTyp: importLauf.belegTyp,
      standardSektor: importLauf.standardSektor,
      status: importLauf.status,
      zaehler: importLauf.zaehler,
      erstellerEmail: benutzer.email,
      createdAt: importLauf.createdAt,
      updatedAt: importLauf.updatedAt,
    })
    .from(importLauf)
    .leftJoin(benutzer, eq(benutzer.id, importLauf.erstellerId))
    .orderBy(desc(importLauf.createdAt));
}

export async function ladeImportLauf(db: Leser, id: string): Promise<ImportLaufZeile | null> {
  const rows = await db
    .select({
      id: importLauf.id,
      art: importLauf.art,
      dateiname: importLauf.dateiname,
      dateiHash: importLauf.dateiHash,
      belegTyp: importLauf.belegTyp,
      standardSektor: importLauf.standardSektor,
      status: importLauf.status,
      zaehler: importLauf.zaehler,
      erstellerEmail: benutzer.email,
      createdAt: importLauf.createdAt,
      updatedAt: importLauf.updatedAt,
    })
    .from(importLauf)
    .leftJoin(benutzer, eq(benutzer.id, importLauf.erstellerId))
    .where(eq(importLauf.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** E67: Laeufe mit demselben Datei-Hash — die Warnung vor dem Start. */
export function ladeGleicheDatei(db: Leser, dateiHash: string, ausserId: string): Promise<{ id: string; dateiname: string; status: string; createdAt: Date }[]> {
  return db
    .select({ id: importLauf.id, dateiname: importLauf.dateiname, status: importLauf.status, createdAt: importLauf.createdAt })
    .from(importLauf)
    .where(and(eq(importLauf.dateiHash, dateiHash), ne(importLauf.id, ausserId)))
    .orderBy(desc(importLauf.createdAt));
}

/**
 * R2-Schluessel des Roh-Uploads: eigener Praefix `import/`, nie unter
 * `belege/` — die Datei kann Personen-Spalten enthalten und wird nach der
 * Zuordnung geloescht, spaetestens nach 24 h durch den Job (E67).
 */
export function importRohKey(env: string, laufId: string, dateiname: string): string {
  return `import/${env}/${laufId}/roh${dateiEndung(dateiname) || ".bin"}`;
}
