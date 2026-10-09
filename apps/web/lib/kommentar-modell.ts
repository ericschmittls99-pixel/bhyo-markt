/**
 * AP2.6 PR b (E71): Anzeige-Modell der Kommentare — was Loader (lib/kommentare.ts)
 * liefert und die Oberflaeche (components/kommentare/Kommentare.tsx) zeigt.
 * Reine Typen und Texte, keine Datenbank.
 */
import type { KommentarBezug } from "@/lib/kommentar-schreibweg";

export interface KommentarNutzer {
  id: string;
  name: string | null;
  email: string;
  aktiv: boolean;
}

export interface Kommentar {
  id: string;
  bezug: KommentarBezug;
  autor: KommentarNutzer;
  /** NULL = weich geloescht (dann steht „Kommentar geloescht" im Verlauf). */
  text: string | null;
  /** ISO-Zeitstempel (UTC) — formatiert mit fmtDatumZeit (Europe/Berlin). */
  erstelltAm: string;
  bearbeitetAm: string | null;
  geloeschtAm: string | null;
  /** Erwaehnte Nutzer mit aktuellem Namen und Zustand (fuer die Anzeige der Marker). */
  erwaehnte: KommentarNutzer[];
}

/** Hinweis unter dem Eingabefeld (E71 Punkt 10, Wortlaut Eric). */
export const KOMMENTAR_HINWEIS = "Keine Kontaktdaten Dritter – dafür Kontaktpersonen nutzen.";
/** Warnung vor dem Speichern, wenn das Kontaktdaten-Muster des Imports anschlaegt — warnt, blockiert nicht. */
export const KONTAKTDATEN_WARNUNG = "Der Text enthält offenbar eine E-Mail-Adresse oder Telefonnummer. Keine Kontaktdaten Dritter – trotzdem speichern?";
export const KOMMENTAR_GELOESCHT = "Kommentar gelöscht";
