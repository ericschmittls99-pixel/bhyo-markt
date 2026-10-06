import { benutzer, importLauf, importVorlage, importZeile } from "@bhyo/db/schema";
import { and, asc, desc, eq, ne } from "drizzle-orm";

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
  /** AP2.7 PR b: Belegdaten des Lauf-Belegs (Migration 0044), null bis gesetzt. */
  belegErhebungsdatum: string | null;
  belegGueltigBis: string | null;
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
      belegErhebungsdatum: importLauf.belegErhebungsdatum,
      belegGueltigBis: importLauf.belegGueltigBis,
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
      belegErhebungsdatum: importLauf.belegErhebungsdatum,
      belegGueltigBis: importLauf.belegGueltigBis,
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
/** R2-Schluessel der bereinigten Kopie — unter belege/, sie ist die Datei des Lauf-Belegs und bleibt. */
export function importBelegKey(env: string, laufId: string): string {
  return `belege/${env}/import/${laufId}/bereinigt.csv`;
}

export function importRohKey(env: string, laufId: string, dateiname: string): string {
  return `import/${env}/${laufId}/roh${dateiEndung(dateiname) || ".bin"}`;
}

export interface ImportZeileZeile {
  id: string;
  zeilennummer: number;
  felder: Record<string, string>;
  status: string;
  fehlergrund: string | null;
  /** PR c: der angelegte Strom nach dem Ausfuehren. */
  biomassestromId: string | null;
  outputBedarfId: string | null;
}

export function ladeImportZeilen(db: Leser, laufId: string, limit = 5000): Promise<ImportZeileZeile[]> {
  return db
    .select({
      id: importZeile.id,
      zeilennummer: importZeile.zeilennummer,
      felder: importZeile.felder,
      status: importZeile.status,
      fehlergrund: importZeile.fehlergrund,
      biomassestromId: importZeile.biomassestromId,
      outputBedarfId: importZeile.outputBedarfId,
    })
    .from(importZeile)
    .where(eq(importZeile.laufId, laufId))
    .orderBy(asc(importZeile.zeilennummer))
    .limit(limit) as Promise<ImportZeileZeile[]>;
}

export interface ImportVorlageZeile {
  id: string;
  name: string;
  quelle: string | null;
  spalten: Record<string, string>;
  werte: Record<string, Record<string, string>>;
}

/** Vorlagen fuer alle mit Import-Recht, nach Name. */
export function ladeImportVorlagen(db: Leser): Promise<ImportVorlageZeile[]> {
  return db
    .select({ id: importVorlage.id, name: importVorlage.name, quelle: importVorlage.quelle, spalten: importVorlage.spalten, werte: importVorlage.werte })
    .from(importVorlage)
    .orderBy(asc(importVorlage.name));
}
