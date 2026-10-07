/**
 * AP2.6 PR a (E71): Erwaehnungs-Marker im Kommentartext. Gespeichert wird
 * der Marker `@[nutzer:<uuid>]`, angezeigt der aktuelle Name (PR c). Der
 * Server leitet die Erwaehnungen aus dem gespeicherten Text ab — einer
 * Client-Liste wird nicht vertraut. Reine Funktionen, ohne Datenbank.
 */

/** Kommentartext: 1–2000 Zeichen nach btrim (CHECK kommentar_text_check). */
export const KOMMENTAR_TEXT_MAX = 2000;

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
/** Ein Marker, global; die Gruppe ist die UUID. */
const MARKER = new RegExp(`@\\[nutzer:(${UUID})\\]`, "g");

/** Marker fuer einen Nutzer, wie ihn die Oberflaeche in den Text setzt. */
export function erwaehnungsMarker(nutzerId: string): string {
  return `@[nutzer:${nutzerId.toLowerCase()}]`;
}

/**
 * Alle erwaehnten Nutzer-IDs eines Textes — kleingeschrieben, ohne Doppelte,
 * in der Reihenfolge des ersten Auftretens. Was kein vollstaendiger Marker
 * ist (ein nacktes @, eine fremde Form), bleibt Fliesstext und zaehlt nicht.
 */
export function erwaehnungenAus(text: string): string[] {
  const gesehen = new Set<string>();
  const ids: string[] = [];
  for (const m of text.matchAll(MARKER)) {
    const id = m[1]!.toLowerCase();
    if (gesehen.has(id)) continue;
    gesehen.add(id);
    ids.push(id);
  }
  return ids;
}

export type TextPruefung = { ok: true; text: string } | { ok: false; fehler: string };

/** Textregel wie der CHECK: getrimmt nicht leer, hoechstens 2000 Zeichen. */
export function pruefeKommentarText(roh: unknown): TextPruefung {
  const text = typeof roh === "string" ? roh.trim() : "";
  if (text.length === 0) return { ok: false, fehler: "Der Kommentar ist leer." };
  if (text.length > KOMMENTAR_TEXT_MAX) return { ok: false, fehler: `Der Kommentar ist zu lang (höchstens ${KOMMENTAR_TEXT_MAX} Zeichen).` };
  return { ok: true, text };
}
