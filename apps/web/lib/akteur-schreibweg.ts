import { genauigkeitFuerPin } from "@/lib/adresse-pruefung";
import { akteur } from "@bhyo/db/schema";
import { sql } from "drizzle-orm";

import { OHNE_ORT, pruefeAkteurEingabe } from "@/lib/akteur-eingabe";
import { kreisArsDesSitzes } from "@/lib/akteure";
import { withDb } from "@/lib/db";
import { protokolliere } from "@/lib/protokoll";
import { darf } from "@/lib/rechte";
import type { Handelnder, Tx } from "@/lib/strom-schreibweg";

/**
 * AP2.7 PR b (E67): Die Akteur-Anlage als Baustein — wie „Strom anlegen" in
 * strom-schreibweg.ts. Die Inline-Anlage aus dem Beleg (POST /api/akteure)
 * und der Import rufen dieselbe Funktion; Rechte (darf), E66-Pflichtfelder,
 * Insert, Kreis-Probe (E25) und Protokoll leben hier genau einmal. Vorher
 * steckte das alles in der API-Route, und der Import haette eine zweite
 * Fassung gebraucht (Eric 06.10.2026).
 *
 * Kein "use server": Baustein, keine Action.
 */
export interface AkteurAnlage {
  /** Rohwerte wie aus Formular oder Import-Zeile; pruefeAkteurEingabe liest sie. */
  eingabe: Record<string, unknown>;
  /** Aktive Sektor-Codes — leer bedeutet Systemzeile ohne_sektor, unbekannt wird abgewiesen. */
  aktiveCodes: readonly string[];
  /** E67: Lauf-ID an jedem Ereignis des Imports (aenderung.import_lauf_id). */
  importLaufId?: string;
}

export interface AkteurNeu {
  id: string;
  name: string;
  sektor: string;
}

/**
 * Fachlicher Fehler der Anlage (Pflichtfeld, Sektor, Ort nicht bestimmbar,
 * kein Recht) — die Route antwortet 400, der Import markiert die Zeile.
 * Alles andere ist ein technischer Fehler und bleibt eine normale Ausnahme.
 */
export class AkteurFehlerAusnahme extends Error {}

export async function akteurAnlegenInTx(tx: Tx, handelnder: Handelnder, a: AkteurAnlage): Promise<AkteurNeu> {
  // F8/E30, E42: Rechte VOR jeder Wirkung — auch hier, nicht nur am Eingang
  // der Route, damit kein Aufrufer am Baustein vorbei schreiben kann.
  if (!darf(handelnder, "akteur.anlegen")) throw new AkteurFehlerAusnahme("Kein Recht für diese Aktion.");
  const pruefung = pruefeAkteurEingabe(a.eingabe, a.aktiveCodes);
  if (!pruefung.ok) throw new AkteurFehlerAusnahme(pruefung.fehler);
  const { w, geom } = pruefung;

  const [row] = await tx
    .insert(akteur)
    .values({
      name: w.name,
      sektor: w.sektor,
      sitzStrasse: w.sitzStrasse || null,
      sitzHausnummer: w.sitzHausnummer || null,
      sitzPlz: w.sitzPlz,
      sitzOrt: w.sitzOrt,
      sitzGeom: sql`ST_SetSRID(ST_MakePoint(${geom.lng}, ${geom.lat}), 4326)`,
      sitzGenauigkeit: genauigkeitFuerPin(w.genauigkeit),
      status: "entwurf",
    })
    .returning({ id: akteur.id, name: akteur.name, sektor: akteur.sektor });
  // E25/E66: Der Kreis-ARS kommt aus der Koordinate (View akteur_verwaltung).
  // Ist keiner bestimmbar, verlaesst die Ausnahme die Transaktion — der
  // Insert wird zurueckgerollt, protokolliert wird nichts.
  const ars = await kreisArsDesSitzes(tx, row!.id);
  if (!ars) throw new AkteurFehlerAusnahme(OHNE_ORT);
  // E57: nur IDs im Protokoll, kein Name.
  await protokolliere(tx, {
    art: "akteur_angelegt",
    entitaet: "akteur",
    id: row!.id,
    benutzerId: handelnder.id,
    benutzerEmail: handelnder.email,
    importLaufId: a.importLaufId,
  });
  return row!;
}

/** Anlegen in eigener Transaktion — der Weg der Inline-Anlage. */
export function akteurAnlegen(handelnder: Handelnder, a: AkteurAnlage): Promise<AkteurNeu> {
  return withDb((db) => db.transaction((tx) => akteurAnlegenInTx(tx, handelnder, a)));
}
