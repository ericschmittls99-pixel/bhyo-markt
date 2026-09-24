/**
 * F8/E30 PR C: Die Regeln der Benutzerverwaltung als reine Funktionen —
 * ohne Datenbank, ohne Header. Die Aktionen daneben setzen sie durch.
 *
 * Kern ist der Schutz gegen Selbstaussperrung: Der **letzte aktive Admin**
 * darf sich weder herabstufen noch deaktivieren. Ohne ihn gäbe es niemanden
 * mehr, der Rollen vergibt — und weil der Zugang fail closed ist, käme auch
 * niemand mehr herein, um das zu reparieren. Die einzige Rettung wäre dann
 * eine Migration, also ein Deploy.
 */
import type { Rolle } from "@/lib/rollen";

export interface BenutzerZeile {
  email: string;
  rolle: Rolle;
  aktiv: boolean;
}

/** Warum eine Änderung abgelehnt wird — benannt, nicht als blosses `false`. */
export type Ablehnung =
  | { grund: "letzter_admin"; text: string }
  | { grund: "unbekannt"; text: string }
  | { grund: "ungueltige_email"; text: string }
  | { grund: "schon_vorhanden"; text: string };

const LETZTER_ADMIN =
  "Das ist der letzte aktive Admin. Erst eine zweite Person zum Admin machen, " +
  "sonst kann niemand mehr Rollen vergeben.";

/** Zählt, wer nach einer gedachten Änderung noch Rollen vergeben könnte. */
export function aktiveAdmins(alle: BenutzerZeile[]): BenutzerZeile[] {
  return alle.filter((b) => b.rolle === "admin" && b.aktiv);
}

/**
 * Prüft eine Rollenänderung. `alle` ist der Stand VOR der Änderung.
 * Gibt `null` zurück, wenn sie erlaubt ist.
 */
export function pruefeRollenwechsel(
  alle: BenutzerZeile[],
  email: string,
  neueRolle: Rolle,
): Ablehnung | null {
  const ziel = alle.find((b) => b.email === email);
  if (!ziel) return { grund: "unbekannt", text: "Diese Adresse ist nicht eingetragen." };
  if (neueRolle === "admin") return null;

  // Herabstufung: Bleibt danach noch ein aktiver Admin übrig?
  const verbleibend = aktiveAdmins(alle).filter((b) => b.email !== email);
  if (ziel.rolle === "admin" && ziel.aktiv && verbleibend.length === 0) {
    return { grund: "letzter_admin", text: LETZTER_ADMIN };
  }
  return null;
}

/** Prüft das Aktiv-Setzen bzw. Deaktivieren. `alle` ist der Stand VORHER. */
export function pruefeAktivWechsel(
  alle: BenutzerZeile[],
  email: string,
  neuAktiv: boolean,
): Ablehnung | null {
  const ziel = alle.find((b) => b.email === email);
  if (!ziel) return { grund: "unbekannt", text: "Diese Adresse ist nicht eingetragen." };
  if (neuAktiv) return null;

  const verbleibend = aktiveAdmins(alle).filter((b) => b.email !== email);
  if (ziel.rolle === "admin" && ziel.aktiv && verbleibend.length === 0) {
    return { grund: "letzter_admin", text: LETZTER_ADMIN };
  }
  return null;
}

/**
 * Prüft eine Neuanlage. Die Adresse wird kleingeschrieben erwartet (die
 * Aktion normalisiert vorher, die Datenbank erzwingt es per CHECK).
 */
export function pruefeNeuanlage(
  alle: BenutzerZeile[],
  email: string,
): Ablehnung | null {
  if (!istEmail(email)) {
    return { grund: "ungueltige_email", text: "Das ist keine gültige E-Mail-Adresse." };
  }
  if (alle.some((b) => b.email === email)) {
    return {
      grund: "schon_vorhanden",
      text: "Diese Adresse ist bereits eingetragen — dort die Rolle ändern.",
    };
  }
  return null;
}

/**
 * Bewusst genügsam: genau ein @, davor und danach etwas ohne Leerraum, im
 * hinteren Teil mindestens ein Punkt. Access entscheidet ohnehin, wer
 * hereinkommt; diese Prüfung fängt Tippfehler ab, sie ist kein Türsteher.
 */
export function istEmail(wert: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wert);
}
