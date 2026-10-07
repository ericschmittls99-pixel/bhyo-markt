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

/** Was die Anzeige ueber einen erwaehnten Nutzer wissen muss (aus benutzer, zur Anzeigezeit aufgeloest). */
export interface ErwaehnterNutzer {
  name: string | null;
  email: string;
  aktiv: boolean;
}

export type KommentarSegment = { art: "text"; text: string } | { art: "erwaehnung"; nutzerId: string; anzeige: string; ehemalig: boolean };

/** Anzeige fuer deaktivierte oder nicht mehr vorhandene Nutzer (E71 Punkt 11). */
export const EHEMALIGER_NUTZER = "ehemaliger Nutzer";

/**
 * Zerlegt den gespeicherten Text in Fliesstext und Erwaehnungen: der Marker
 * bleibt in der Datenbank, angezeigt wird der AKTUELLE Name (PR b/c). Ein
 * Marker auf einen deaktivierten oder nicht (mehr) bekannten Nutzer wird als
 * „ehemaliger Nutzer" gezeigt — nie die UUID.
 */
export function kommentarSegmente(text: string, nutzer: ReadonlyMap<string, ErwaehnterNutzer>): KommentarSegment[] {
  const segmente: KommentarSegment[] = [];
  let pos = 0;
  for (const m of text.matchAll(MARKER)) {
    if (m.index! > pos) segmente.push({ art: "text", text: text.slice(pos, m.index!) });
    const id = m[1]!.toLowerCase();
    const n = nutzer.get(id);
    segmente.push({
      art: "erwaehnung",
      nutzerId: id,
      anzeige: n && n.aktiv ? (n.name ?? n.email) : EHEMALIGER_NUTZER,
      ehemalig: !n || !n.aktiv,
    });
    pos = m.index! + m[0].length;
  }
  if (pos < text.length) segmente.push({ art: "text", text: text.slice(pos) });
  return segmente;
}
