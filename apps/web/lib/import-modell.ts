import { IMPORT_PERSONEN_SCHLUESSEL, type ImportLaufStatus } from "@bhyo/db/schema";

import { istBelegTyp } from "@/lib/qualitaet";
import type { StromArt } from "@/lib/stroeme-modell";

/**
 * AP2.7 PR a (E67): reine Regeln des Imports — ohne DB, ohne Request.
 * Der Lauf nennt Art, Datei (Name + SHA-256), Belegtyp und Standard-Sektor;
 * alles Pflicht, weil der Beleg je Lauf entsteht und neue Akteure ohne
 * Sektor-Spalte den Standard bekommen (ohne_sektor erlaubt).
 */
export interface ImportLaufEingabe {
  art: string;
  dateiname: string;
  dateiHash: string;
  belegTyp: string;
  standardSektor: string;
  vorlageId?: string | null;
}

export type ImportLaufFehler = Partial<Record<keyof ImportLaufEingabe, string>>;

export function pruefeImportLaufEingabe(e: ImportLaufEingabe): ImportLaufFehler {
  const f: ImportLaufFehler = {};
  if (e.art !== "biomasse" && e.art !== "output") f.art = "Art des Laufs: Feedstock oder Bedarf";
  if (e.dateiname.trim().length === 0 || e.dateiname.trim().length > 255) f.dateiname = "Dateiname fehlt oder ist zu lang";
  if (!/^[0-9a-f]{64}$/.test(e.dateiHash)) f.dateiHash = "Datei-Hash muss SHA-256 (hex) sein";
  if (!istBelegTyp(e.belegTyp)) f.belegTyp = "Belegtyp ist Pflicht";
  if (e.standardSektor.trim().length === 0) f.standardSektor = "Standard-Sektor ist Pflicht (ohne_sektor erlaubt)";
  return f;
}

export function istStromArt(v: string): v is StromArt {
  return v === "biomasse" || v === "output";
}

/**
 * DSGVO (E67): Schluessel, die eine Personen-Spalte erkennen lassen — Zielfeld
 * oder Quellspalte. Dieselbe Liste wie der CHECK import_zeile_felder_check.
 */
export function istPersonenSchluessel(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/[\s\-.]+/g, "_");
  return (IMPORT_PERSONEN_SCHLUESSEL as readonly string[]).some((p) => n === p || n.startsWith(`${p}_`) || n.endsWith(`_${p}`) || n.includes("ansprech"));
}

/** Anzeige-Labels der Lauf-Zustaende — nur im Frontend, die DB kennt die Codes. */
export const IMPORT_LAUF_STATUS_LABEL: Record<ImportLaufStatus, string> = {
  angelegt: "hochgeladen",
  zugeordnet: "zugeordnet",
  aufgeloest: "Akteure aufgelöst",
  probelauf: "Probelauf",
  ausgefuehrt: "ausgeführt",
  zurueckgenommen: "zurückgenommen",
  fehler: "Fehler",
};

export const IMPORT_ART_LABEL: Record<"biomasse" | "output", string> = { biomasse: "Feedstock", output: "Bedarf" };
