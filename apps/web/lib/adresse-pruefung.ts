import { normalisiereOrt } from "@bhyo/db/plz";

import type { Adresse } from "./geocode";

/**
 * E68 PR 2: Entscheidung der Adresspruefung — pure Funktion, damit die Regel
 * ohne Netz und Datenbank testbar ist. Der Ablauf im Server
 * (lib/adresse-pruefung-server.ts): 1. PLZ und Ort lokal pruefen (bei Fehler
 * sofort „Meinten Sie …?" ohne externe Anfrage), 2. EINE Anfrage an den
 * Adressdienst, 3. hier entscheiden: Treffer mit Pin im PLZ-Gebiet -> Pin;
 * Abweichung -> hoechstens drei Kandidaten; nichts oder Zeitlimit -> Punkt
 * im PLZ-Gebiet mit Hinweis.
 */
export type Genauigkeit = "hausnummer" | "strasse" | "plz_gebiet" | "manuell" | "unbekannt";

export const GENAUIGKEIT_LABEL: Record<Genauigkeit, string> = {
  hausnummer: "hausnummer",
  strasse: "straße",
  plz_gebiet: "plz-gebiet",
  manuell: "manuell",
  unbekannt: "unbekannt",
};

export const GENAUIGKEITEN: readonly Genauigkeit[] = ["hausnummer", "strasse", "plz_gebiet", "manuell", "unbekannt"];

export function istGenauigkeit(v: unknown): v is Genauigkeit {
  return typeof v === "string" && (GENAUIGKEITEN as readonly string[]).includes(v);
}

/** Schreibweg: nur ein gueltiger Wert wird gespeichert, alles andere bleibt „unbekannt" (nichts erfinden). */
export function genauigkeitFuerPin(v: unknown): Genauigkeit {
  return istGenauigkeit(v) ? v : "unbekannt";
}

export interface PruefEingabe {
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
}

/** Kandidat des Adressdienstes, vom Server um „liegt im PLZ-Gebiet der Eingabe" ergaenzt. */
export interface Kandidat extends Adresse {
  imGebiet: boolean;
}

export type PruefErgebnis =
  | { status: "ort_fehler"; text: string; orte: string[] }
  | { status: "treffer"; adresse: Adresse; genauigkeit: "hausnummer" | "strasse"; text: string }
  | { status: "kandidaten"; text: string; kandidaten: Adresse[] }
  | { status: "plz_gebiet"; text: string; pin: { lng: number; lat: number }; genauigkeit: "plz_gebiet" }
  | { status: "dienst_fehlt"; text: string };

/** Strassennamen vergleichbar machen: Normalform plus „str."/„str" -> „strasse". */
export function normalisiereStrasse(t: string): string {
  return normalisiereOrt(t.replace(/str\.(?=\s|$)/gi, "strasse"))
    .replace(/(\S)str(?=\s|$)/g, "$1strasse")
    .replace(/\bstr$/g, "strasse")
    .replace(/\bstr\b/g, "strasse");
}

const hausnummerNorm = (h: string) => h.toLowerCase().replace(/\s+/g, "");

/**
 * Entscheidung ueber die Kandidaten. `ausfall` = Dienst nicht erreichbar oder
 * Zeitlimit; dann zaehlt nur der Rueckfall auf das PLZ-Gebiet.
 */
export function entscheideAdresse(
  eingabe: PruefEingabe,
  kandidaten: Kandidat[],
  rueckfall: { lng: number; lat: number } | null,
  ausfall: boolean,
): PruefErgebnis {
  const strasseNorm = normalisiereStrasse(eingabe.strasse);
  const hnr = hausnummerNorm(eingabe.hausnummer);
  const imGebiet = kandidaten.filter((k) => k.imGebiet);

  if (!ausfall && strasseNorm) {
    const passend = imGebiet.filter(
      (k) => k.art === "adresse" && k.strasse != null && normalisiereStrasse(k.strasse) === strasseNorm && (k.plz == null || k.plz === eingabe.plz),
    );
    const mitHausnummer = hnr ? passend.find((k) => k.hausnummer != null && hausnummerNorm(k.hausnummer) === hnr) : undefined;
    if (mitHausnummer) return { status: "treffer", adresse: mitHausnummer, genauigkeit: "hausnummer", text: "Adresse geprüft — Pin an der Hausnummer." };
    const strasseTreffer = passend.find((k) => !hnr || k.hausnummer == null) ?? passend[0];
    if (strasseTreffer) {
      return {
        status: "treffer",
        adresse: strasseTreffer,
        genauigkeit: "strasse",
        text: hnr ? "Straße gefunden, die Hausnummer nicht — Pin an der Straße, bitte auf der Karte feinsetzen." : "Adresse geprüft — Pin an der Straße.",
      };
    }
  }

  if (!ausfall && imGebiet.length > 0) {
    const vorschlaege = imGebiet.filter((k) => k.art === "adresse" || k.art === "ort").slice(0, 3);
    if (vorschlaege.length > 0) {
      return { status: "kandidaten", text: "Adresse nicht eindeutig gefunden — meinten Sie …?", kandidaten: vorschlaege.map(({ imGebiet: _i, ...a }) => a) };
    }
  }

  if (rueckfall) {
    return {
      status: "plz_gebiet",
      text: ausfall
        ? "Adressdienst nicht erreichbar — ungefährer Standort im PLZ-Gebiet, bitte auf der Karte verschieben."
        : "Adresse nicht gefunden — ungefährer Standort im PLZ-Gebiet, bitte auf der Karte verschieben.",
      pin: rueckfall,
      genauigkeit: "plz_gebiet",
    };
  }
  return { status: "dienst_fehlt", text: "Adresse nicht gefunden und kein PLZ-Gebiet vorhanden — Pin bitte von Hand setzen." };
}

/** Eine strukturierte Anfrage aus den Feldern (ein Klick, eine Anfrage). */
export function suchtextAus(e: PruefEingabe): string {
  const strasse = [e.strasse.trim(), e.hausnummer.trim()].filter(Boolean).join(" ");
  const ort = [e.plz.trim(), e.ort.trim()].filter(Boolean).join(" ");
  return [strasse, ort].filter(Boolean).join(", ");
}
