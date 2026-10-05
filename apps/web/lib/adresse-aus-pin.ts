// Sitz-Erfassung a (AP2.5, 05.10.2026): Was die Rueckwaertssuche aus dem Pin in
// die Adressfelder schreibt. Pure Funktion, damit die Regel ohne Karte und
// Netz testbar ist; der Netz-Aufruf bleibt im AdresseBlock.
//
// Anlass: „Adresse von bestehendem Standort uebernehmen" liess die PLZ leer,
// wenn der Standort keine hatte, und der Hinweis sagte trotzdem „uebernommen".
import type { Adresse } from "./geocode";

export interface AdresseWerte {
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  lat: string;
  lng: string;
}

/**
 * "pin": Klick oder Ziehen — die Koordinate ist fuehrend, alle Adressfelder
 *        kommen aus dem Treffer (fehlt etwas, bleibt das Feld leer).
 * "ergaenzen": Standort uebernommen — Strasse und Hausnummer des Standorts
 *        bleiben, nur eine fehlende PLZ oder ein fehlender Ort kommt aus dem Pin.
 * Der Pin selbst (lat/lng) wird nie veraendert: er bleibt, wo er gesetzt wurde.
 */
export type PinModus = "pin" | "ergaenzen";

export function uebernimmAusPin(
  alt: AdresseWerte,
  treffer: Adresse | null,
  modus: PinModus,
): { werte: AdresseWerte; hinweis: string | null } {
  const werte: AdresseWerte =
    modus === "pin"
      ? {
          ...alt,
          strasse: treffer?.strasse ?? "",
          hausnummer: treffer?.hausnummer ?? "",
          plz: treffer?.plz ?? "",
          ort: treffer?.ort ?? "",
        }
      : {
          ...alt,
          plz: alt.plz || (treffer?.plz ?? ""),
          ort: alt.ort || (treffer?.ort ?? ""),
        };

  const fehlt = [!werte.plz && "PLZ", !werte.ort && "Ort"].filter((x): x is string => Boolean(x));
  if (fehlt.length === 2) {
    return { werte, hinweis: "Am Pin wurde keine Adresse gefunden — PLZ und Ort bitte von Hand eintragen." };
  }
  if (fehlt.length === 1) {
    const f = fehlt[0]!;
    return { werte, hinweis: `Am Pin wurde kein${f === "PLZ" ? "e" : ""} ${f} gefunden — ${f} bitte von Hand eintragen.` };
  }
  if (modus === "pin") return { werte, hinweis: "Adresse aus Pin übernommen." };

  const ergaenzt = [werte.plz !== alt.plz && "PLZ", werte.ort !== alt.ort && "Ort"].filter((x): x is string => Boolean(x));
  if (ergaenzt.length === 0) return { werte, hinweis: null };
  return { werte, hinweis: `${ergaenzt.join(" und ")} aus Pin ergänzt.` };
}
