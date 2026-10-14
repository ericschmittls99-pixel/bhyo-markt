/**
 * E77 R5: Wohin „Oeffnen" fuehrt — EIN Ursprung fuer die Liste in inbox. und
 * das Pop-up an der Glocke. Rein: Zeile und bestehende Suchparameter herein,
 * Pfad heraus (inbox. haengt das Detail an seine Parameter, das Pop-up hat keine).
 */
import type { InboxZeile } from "./server";

export type ZielZeile = Pick<InboxZeile, "typ" | "strom" | "akteur" | "kontaktperson" | "importLauf" | "kommentar">;

export function zielFuerZeile(z: ZielZeile, bestehend: URLSearchParams = new URLSearchParams()): string {
  // AP2.5: Hinweise zum Akteur oeffnen die Akteur-Seite; alles andere das Detail-Panel in inbox.
  const p = new URLSearchParams(bestehend.toString());
  if (z.strom) {
    p.set("detail", z.strom.id);
    p.set("sicht", z.strom.art === "output" ? "outputs" : "feedstock");
  }
  // AP2.6 PR c (E71): Kommentar und Erwaehnung springen zum Kommentar im Objekt (Anker #kommentar-<id>).
  const anker = z.kommentar ? `#kommentar-${z.kommentar.id}` : "";
  if (z.strom) return `/inbox?${p.toString()}${anker}`;
  // E77 R6: der Akteur ist eine Sidebar ueber akteure. (`?detail=`, wie bei stroeme.), der Reiter rollt zum Abschnitt.
  if (z.kontaktperson) return `/akteure?detail=${z.kontaktperson.akteurId}&reiter=kontaktpersonen`;
  if (z.akteur) return `/akteure?detail=${z.akteur.id}${anker}`;
  if (z.importLauf) return `/import/${z.importLauf.id}`;
  // AP2.9 Umschalten: die Mail-Hinweise fuehren zur Tages-Mail-Sektion (Testversand).
  if (z.typ === "mail_stoerung" || z.typ === "mail_secret_laeuft_ab") return "/einstellungen#roundup";
  return "/inbox";
}
