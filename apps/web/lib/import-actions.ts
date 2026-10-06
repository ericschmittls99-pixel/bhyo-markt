"use server";

import { importLauf } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";

import { withDb } from "@/lib/db";
import { pruefeImportLaufEingabe, type ImportLaufEingabe, type ImportLaufFehler } from "@/lib/import-modell";
import { protokolliere } from "@/lib/protokoll";
import { rechtFuerAction } from "@/lib/rechte/wache";

/**
 * AP2.7 PR a (E67): der erste Schreibpfad des Imports — einen Lauf anlegen.
 * Nur Pruefer und Admin (import.ausfuehren); die Wache sitzt vor jeder
 * Wirkung. Das Ereignis traegt die Lauf-ID (aenderung.import_lauf_id).
 * Hochladen, Zuordnen und Probelauf kommen in PR b, Ausfuehren in PR c.
 */
export interface ImportLaufErgebnis {
  ok?: boolean;
  id?: string;
  feldFehler?: ImportLaufFehler;
  fehler?: string;
  /** Gleicher Datei-Hash wie ein frueherer Lauf (E67: Warnung vor dem Start). */
  gleicheDatei?: { laufId: string; dateiname: string; createdAt: string }[];
}

export async function importLaufAnlegen(eingabe: ImportLaufEingabe): Promise<ImportLaufErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  const feldFehler = pruefeImportLaufEingabe(eingabe);
  if (Object.keys(feldFehler).length > 0) return { feldFehler };

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const gleiche = await tx
          .select({ laufId: importLauf.id, dateiname: importLauf.dateiname, createdAt: importLauf.createdAt })
          .from(importLauf)
          .where(eq(importLauf.dateiHash, eingabe.dateiHash));
        const [row] = await tx
          .insert(importLauf)
          .values({
            art: eingabe.art,
            dateiname: eingabe.dateiname.trim(),
            dateiHash: eingabe.dateiHash,
            belegTyp: eingabe.belegTyp as typeof importLauf.$inferInsert.belegTyp,
            standardSektor: eingabe.standardSektor,
            vorlageId: eingabe.vorlageId ?? null,
            erstellerId: wache.zugang.id,
            status: "angelegt",
          })
          .returning({ id: importLauf.id });
        await protokolliere(tx, {
          art: "angelegt",
          entitaet: "import_lauf",
          id: row!.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Import-Lauf angelegt: ${eingabe.dateiname.trim()} (${eingabe.art})`,
          importLaufId: row!.id,
        });
        return {
          ok: true,
          id: row!.id,
          gleicheDatei: gleiche.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })),
        };
      }),
    );
  } catch (e) {
    console.error("Import-Lauf anlegen fehlgeschlagen:", e);
    return { fehler: "Import-Lauf konnte nicht angelegt werden." };
  }
}
