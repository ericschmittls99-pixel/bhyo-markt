"use server";

import { importLauf } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";

import { getBelegeBucket, getEnvironment, withDb, type AppDb } from "@/lib/db";
import { dateiErlaubt, IMPORT_MAX_BYTES, ImportDateiFehler, parseImportDatei, sha256Hex } from "@/lib/import-datei";
import { pruefeImportLaufEingabe, type ImportLaufEingabe, type ImportLaufFehler } from "@/lib/import-modell";
import { importRohKey } from "@/lib/import-server";
import { protokolliere } from "@/lib/protokoll";
import { rechtFuerAction } from "@/lib/rechte/wache";

/**
 * AP2.7 PR a/b (E67): die Schreibpfade des Imports bis zum Lauf. Nur Pruefer
 * und Admin (import.ausfuehren); die Wache sitzt vor jeder Wirkung. Jedes
 * Ereignis traegt die Lauf-ID (aenderung.import_lauf_id). Zuordnen und
 * Probelauf folgen in diesem PR, Ausfuehren in PR c.
 */
export interface ImportLaufErgebnis {
  ok?: boolean;
  id?: string;
  feldFehler?: ImportLaufFehler;
  fehler?: string;
  /** Gleicher Datei-Hash wie ein frueherer Lauf (E67: Warnung vor dem Start). */
  gleicheDatei?: { laufId: string; dateiname: string; createdAt: string }[];
}

type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

/** Lauf-Zeile plus Ereignis — eine Stelle fuer beide Actions. */
async function laufAnlegenInTx(
  tx: Tx,
  handelnder: { id: string; email: string },
  eingabe: ImportLaufEingabe,
  extra: { id?: string; zaehler?: Record<string, number> },
): Promise<{ id: string; gleiche: { laufId: string; dateiname: string; createdAt: string }[] }> {
  const gleiche = await tx
    .select({ laufId: importLauf.id, dateiname: importLauf.dateiname, createdAt: importLauf.createdAt })
    .from(importLauf)
    .where(eq(importLauf.dateiHash, eingabe.dateiHash));
  const [row] = await tx
    .insert(importLauf)
    .values({
      ...(extra.id ? { id: extra.id } : {}),
      art: eingabe.art,
      dateiname: eingabe.dateiname.trim(),
      dateiHash: eingabe.dateiHash,
      belegTyp: eingabe.belegTyp as typeof importLauf.$inferInsert.belegTyp,
      standardSektor: eingabe.standardSektor,
      vorlageId: eingabe.vorlageId ?? null,
      erstellerId: handelnder.id,
      status: "angelegt",
      zaehler: extra.zaehler ?? null,
    })
    .returning({ id: importLauf.id });
  const zeilen = extra.zaehler?.zeilen;
  await protokolliere(tx, {
    art: "angelegt",
    entitaet: "import_lauf",
    id: row!.id,
    benutzerId: handelnder.id,
    benutzerEmail: handelnder.email,
    text: `Import-Lauf angelegt: ${eingabe.dateiname.trim()} (${eingabe.art}${zeilen != null ? `, ${zeilen} Zeilen` : ""})`,
    importLaufId: row!.id,
  });
  return { id: row!.id, gleiche: gleiche.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })) };
}

export async function importLaufAnlegen(eingabe: ImportLaufEingabe): Promise<ImportLaufErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  const feldFehler = pruefeImportLaufEingabe(eingabe);
  if (Object.keys(feldFehler).length > 0) return { feldFehler };

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const { id, gleiche } = await laufAnlegenInTx(tx, { id: wache.zugang.id, email: wache.email }, eingabe, {});
        return { ok: true, id, gleicheDatei: gleiche };
      }),
    );
  } catch (e) {
    console.error("Import-Lauf anlegen fehlgeschlagen:", e);
    return { fehler: "Import-Lauf konnte nicht angelegt werden." };
  }
}

/**
 * Upload (PR b): Datei pruefen und lesen, Hash bilden, Roh-Upload nach R2
 * (eigener Praefix import/, Loeschung nach der Zuordnung bzw. durch den
 * Job), dann Lauf und Ereignis in einer Transaktion. Reihenfolge bewusst:
 * erst R2, dann DB — ein verwaistes R2-Objekt raeumt der Job auf, ein Lauf
 * ohne Datei waere eine Leiche in der Oberflaeche. Zeilen werden hier noch
 * nicht gespeichert: Welche Spalten uebernommen werden, entscheidet die
 * Zuordnung (E67, Personen-Spalten nie).
 */
export async function importDateiHochladen(_prev: ImportLaufErgebnis, formData: FormData): Promise<ImportLaufErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };

  const datei = formData.get("datei");
  if (!(datei instanceof File) || datei.size === 0) return { feldFehler: { dateiname: "Bitte eine CSV- oder Excel-Datei auswählen." } };
  if (!dateiErlaubt(datei.name)) return { feldFehler: { dateiname: "Dateityp nicht unterstützt: erlaubt sind .xlsx, .xlsm, .xls, .csv." } };
  if (datei.size > IMPORT_MAX_BYTES) return { feldFehler: { dateiname: `Datei ist größer als ${IMPORT_MAX_BYTES / 1024 / 1024} MB.` } };

  const text = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const daten = await datei.arrayBuffer();
  const eingabe: ImportLaufEingabe = {
    art: text("art"),
    dateiname: datei.name,
    dateiHash: await sha256Hex(daten),
    belegTyp: text("beleg_typ"),
    standardSektor: text("standard_sektor"),
  };
  const feldFehler = pruefeImportLaufEingabe(eingabe);
  if (Object.keys(feldFehler).length > 0) return { feldFehler };

  let zaehler: Record<string, number>;
  try {
    const tabelle = parseImportDatei(daten, datei.name);
    zaehler = { zeilen: tabelle.zeilen.length, spalten: tabelle.spalten.length };
  } catch (e) {
    if (e instanceof ImportDateiFehler) return { feldFehler: { dateiname: e.message } };
    throw e;
  }

  const laufId = crypto.randomUUID();
  try {
    const env = await getEnvironment();
    const bucket = await getBelegeBucket();
    await bucket.put(importRohKey(env, laufId, datei.name), daten, {
      httpMetadata: { contentType: datei.type || "application/octet-stream" },
    });
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const { id, gleiche } = await laufAnlegenInTx(tx, { id: wache.zugang.id, email: wache.email }, eingabe, { id: laufId, zaehler });
        return { ok: true, id, gleicheDatei: gleiche };
      }),
    );
  } catch (e) {
    console.error("Import-Upload fehlgeschlagen:", e);
    return { fehler: "Die Datei konnte nicht übernommen werden." };
  }
}
