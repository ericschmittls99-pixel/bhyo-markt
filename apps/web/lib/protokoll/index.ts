/**
 * AP2.2 PR a: Das Ereignisprotokoll. `aenderung` ist die Tabelle, dieses
 * Modul die EINZIGE Schreibstelle — scripts/protokoll-check.ts erzwingt das
 * in der CI (kein INSERT auf aenderung ausserhalb von lib/protokoll, und
 * jeder Schreibpfad protokolliert).
 *
 * Ein Ereignis wird immer in der Transaktion des Schreibpfads geschrieben:
 * rollt sie zurueck, gibt es auch kein Ereignis. Deshalb nimmt
 * `protokolliere` die Transaktion entgegen und oeffnet nie eine eigene
 * Verbindung.
 */
import { aenderung, ereignisArt } from "@bhyo/db/schema";

import type { AppDb } from "@/lib/db";
import { zustellen } from "@/lib/inbox/zustellung";

export type EreignisArt = (typeof ereignisArt.enumValues)[number];

/** Objektbezug: polymorph, das Protokoll ueberdauert verworfene Objekte. */
export type Entitaet =
  | "biomassestrom"
  | "output_bedarf"
  | "benutzer"
  | "akteur"
  | "region"
  | "analyse_lauf"
  /** AP2.3: Parameterwert (Verlaufszeile) — ueberdauert eine Ruecknahme. */
  | "parameter_wert"
  /** AP2.3 PR b: Sektor der Referenzliste (sektor.id; der Code ist kein uuid). */
  | "sektor";

export interface Ereignis {
  art: Exclude<EreignisArt, "altbestand">;
  entitaet: Entitaet;
  id: string;
  /** Urheber als benutzer.id — Pflicht (CHECK aenderung_urheber_check). */
  benutzerId: string;
  /** Urheber-E-Mail: bleibt vorerst als Spalte und Textpraefix (Anzeige). */
  benutzerEmail: string;
  /** Freitext (Begruendung, Zielstatus, Notiz …); fehlt er, gilt der Standardtext der Art. */
  text?: string;
  /**
   * AP2.2 PR c: die betroffene Person (benutzer.id) — bei zugewiesen der
   * Zugewiesene, bei zugriff_abgelehnt der Anfragende. Die Zustellung braucht
   * sie als Empfaenger; im Protokoll steht sie im Text.
   */
  betrifftId?: string;
}

/** Ein Schreiber ist die Transaktion (oder in Tests eine Attrappe davon). */
export type Schreiber = Pick<AppDb, "insert" | "select" | "update">;

/** Standardtexte je Art — fuer die bestehende Verlaufsanzeige. */
export const STANDARDTEXT: Record<Exclude<EreignisArt, "altbestand">, string> = {
  angelegt: "Ersterfassung",
  geaendert: "Geändert",
  status_gesetzt: "Status gesetzt",
  verworfen: "Strom verworfen (statt gelöscht)",
  gesperrt: "Strom gesperrt",
  entsperrt: "Strom entsperrt (Zuweisungen entfernt)",
  zugewiesen: "Zugewiesen",
  zugriff_angefragt: "Zugriff angefragt",
  zugriff_abgelehnt: "Zugriffsanfrage abgelehnt",
  parameter_gesetzt: "Parameter gesetzt",
  parameter_zurueckgenommen: "Parameteränderung zurückgenommen",
  in_pruefung_gegeben: "In Prüfung gegeben",
  geprueft: "Geprüft",
  zurueckgegeben: "Zurückgegeben (Entwurf)",
  reaktiviert: "Reaktiviert (Entwurf)",
  zurueckgesetzt: "Zurückgesetzt in Prüfung (fachliche Änderung)",
  als_abgelaufen_markiert: "Beleg als abgelaufen markiert",
  abgelaufen_aufgehoben: "Ablauf-Markierung aufgehoben",
  reverifiziert: "Erneut verifiziert",
  sektor_angelegt: "Sektor angelegt",
  sektor_umbenannt: "Sektor umbenannt",
  sektor_deaktiviert: "Sektor deaktiviert",
  sektor_reaktiviert: "Sektor reaktiviert",
  zuweisung_entfernt: "Zuweisung entfernt",
  benutzer_angelegt: "Benutzer angelegt",
  rolle_gesetzt: "Rolle gesetzt",
  benutzer_aktiviert: "Zugang aktiviert",
  benutzer_deaktiviert: "Zugang deaktiviert",
  region_angelegt: "Region angelegt",
  akteur_angelegt: "Akteur angelegt",
  projekt_angelegt: "Projekt gestartet",
};

/**
 * Schreibt genau eine Protokollzeile in der uebergebenen Transaktion.
 * `altbestand` ist keine Art, die Code erzeugt — der Typ laesst sie nicht zu,
 * und zur Laufzeit wird sie trotzdem abgewiesen.
 */
export async function protokolliere(tx: Schreiber, ereignis: Ereignis): Promise<{ id: string }> {
  if ((ereignis.art as string) === "altbestand") {
    throw new Error("altbestand ist Altzeilen vorbehalten und wird nie neu geschrieben.");
  }
  if (!ereignis.benutzerId) throw new Error("Ereignis ohne Urheber (benutzerId).");
  const text = ereignis.text?.trim() || STANDARDTEXT[ereignis.art];
  const [zeile] = await tx
    .insert(aenderung)
    .values({
      entitaetTyp: ereignis.entitaet,
      entitaetId: ereignis.id,
      art: ereignis.art,
      benutzerId: ereignis.benutzerId,
      benutzerEmail: ereignis.benutzerEmail,
      // Praefix bleibt, weil die Verlaufsanzeige ihn heute so zeigt (F8/E30).
      text: `${ereignis.benutzerEmail}: ${text}`,
    })
    .returning({ id: aenderung.id });
  // AP2.2 PR b: Zustellung in derselben Transaktion — Rollback = keine Zustellung.
  await zustellen(tx, {
    id: zeile!.id,
    art: ereignis.art,
    entitaet: ereignis.entitaet,
    entitaetId: ereignis.id,
    ausloeserId: ereignis.benutzerId,
    betrifftId: ereignis.betrifftId ?? null,
    text: ereignis.text?.trim() || null,
  });
  return { id: zeile!.id };
}
