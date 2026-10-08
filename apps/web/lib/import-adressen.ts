import type { Genauigkeit } from "@/lib/adresse-pruefung";
import type { Adresse } from "@/lib/geocode";
import type { PlzStapelErgebnis } from "@/lib/plz-server";
import { normName } from "@/lib/import-zuordnung";

/**
 * AP2.7 PR b (E67): Sitz neuer Akteure per Adresssuche — je eindeutiger
 * Adresse ein Aufruf (Zwischenspeicher sind die Felder der Zeilen, dadurch
 * fortsetzbar), gedrosselt in kleinen Stapeln je Request. Ohne eindeutigen
 * Treffer bleibt der Sitz offen → Nacharbeit (E66: ohne PLZ, Ort und Pin
 * kein Akteur). Reine Regeln; Netz und DB in import-actions.ts.
 *
 * Felder je Zeile: akteur_sitz_lat / akteur_sitz_lng (Dezimalpunkt, Maschinenwerte),
 * akteur_sitz_quelle = "plz_gebiet" (lokal, E68 PR 3) oder "photon" (genaue Pins),
 * akteur_sitz_genauigkeit wie standort_genauigkeit, akteur_sitz_offen = Grund
 * (PLZ unbekannt, Ort passt nicht …), akteur_sitz_genau_versucht = "1", wenn
 * die genaue Suche ohne besseren Treffer blieb.
 */
export interface ZeileFuerAdresse {
  id: string;
  felder: Record<string, string>;
}

export interface AdressGruppe {
  schluessel: string;
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  zeilenIds: string[];
}

/** Stapelgroesse je Request: Photon braucht 0,5–1,3 s je Anfrage (Messung 06.10.2026) — acht bleiben unter ~10 s. */
export const ADRESSEN_JE_STAPEL = 8;

export function adressSchluessel(f: Record<string, string>): string {
  return normName([f.akteur_sitz_strasse, f.akteur_sitz_hausnummer, f.akteur_sitz_plz, f.akteur_sitz_ort].map((t) => (t ?? "").trim()).join(" "));
}

/** Braucht die Zeile eine Adresssuche? Nur neue Akteure ohne Pin und ohne offenen Befund. */
export function brauchtSitz(f: Record<string, string>): boolean {
  return f.akteur_neu === "1" && !f.akteur_sitz_lat && !f.akteur_sitz_lng && !f.akteur_sitz_offen;
}

/** Offene Adressen je eindeutiger Adresse, Reihenfolge des ersten Auftretens. */
export function adressGruppen(zeilen: readonly ZeileFuerAdresse[]): AdressGruppe[] {
  return adressGruppenNach(zeilen, brauchtSitz);
}

function adressGruppenNach(zeilen: readonly ZeileFuerAdresse[], passt: (f: Record<string, string>) => boolean): AdressGruppe[] {
  const gruppen = new Map<string, AdressGruppe>();
  for (const z of zeilen) {
    if (!passt(z.felder)) continue;
    const schluessel = adressSchluessel(z.felder);
    const g = gruppen.get(schluessel);
    if (g) g.zeilenIds.push(z.id);
    else {
      const f = z.felder;
      gruppen.set(schluessel, {
        schluessel,
        strasse: (f.akteur_sitz_strasse ?? "").trim(),
        hausnummer: (f.akteur_sitz_hausnummer ?? "").trim(),
        plz: (f.akteur_sitz_plz ?? "").trim(),
        ort: (f.akteur_sitz_ort ?? "").trim(),
        zeilenIds: [z.id],
      });
    }
  }
  return [...gruppen.values()];
}

/** Suchtext wie ein Mensch ihn tippt: „Dorfstraße 3, 67346 Speyer"; leer, wenn gar nichts da ist. */
export function adressText(g: Pick<AdressGruppe, "strasse" | "hausnummer" | "plz" | "ort">): string {
  const strasse = [g.strasse, g.hausnummer].filter(Boolean).join(" ");
  const ort = [g.plz, g.ort].filter(Boolean).join(" ");
  return [strasse, ort].filter(Boolean).join(", ");
}

export type SitzErgebnis = { lat: number; lng: number; plz: string; ort: string; genauigkeit?: Genauigkeit; quelle?: "plz_gebiet" | "photon" } | { offen: string };

/**
 * E68 PR 3: lokale Zuordnung ohne Netz — PLZ muss bekannt sein, der Ort muss
 * zur PLZ passen (Kurzform erlaubt); fehlt der Ort, gilt der einzige Ort der
 * PLZ, bei mehreren bleibt die Zeile offen mit der Liste. Der Pin ist ein
 * Punkt im PLZ-Gebiet, Genauigkeit plz_gebiet. Jeder Befund ist ein Satz fuer
 * die Nacharbeit („Meinten Sie …?").
 */
export function sitzAusLokal(g: Pick<AdressGruppe, "plz" | "ort">, e: PlzStapelErgebnis): SitzErgebnis {
  if (!g.plz) return { offen: "Ohne PLZ keine Zuordnung — PLZ in der Zeile ergänzen." };
  if (!e.plzBekannt || !e.pin) return { offen: `PLZ ${g.plz} ist unbekannt — bitte prüfen.` };
  const liste = e.orte.slice(0, 3).join(", ") + (e.orte.length > 3 ? " …" : "");
  if (g.ort) {
    if (!e.ortPasst) return { offen: e.orte.length ? `Ort passt nicht zur PLZ ${g.plz} — meinten Sie ${liste}?` : `Zur PLZ ${g.plz} ist kein Ort hinterlegt.` };
    return { lat: e.pin.lat, lng: e.pin.lng, plz: g.plz, ort: g.ort, genauigkeit: "plz_gebiet", quelle: "plz_gebiet" };
  }
  if (e.orte.length === 1) return { lat: e.pin.lat, lng: e.pin.lng, plz: g.plz, ort: e.orte[0]!, genauigkeit: "plz_gebiet", quelle: "plz_gebiet" };
  if (e.orte.length === 0) return { offen: `Zur PLZ ${g.plz} ist kein Ort hinterlegt — Ort angeben.` };
  return { offen: `PLZ ${g.plz} hat ${e.orte.length} Orte — Ort angeben: ${liste}` };
}

/** Adressen mit ungefaehrem Pin (plz_gebiet), fuer die noch keine genaue Suche lief. */
export function brauchtGenauenPin(f: Record<string, string>): boolean {
  return f.akteur_neu === "1" && f.akteur_sitz_quelle === "plz_gebiet" && !f.akteur_sitz_genau_versucht;
}

export function gruppenFuerGenauePins(zeilen: readonly ZeileFuerAdresse[]): AdressGruppe[] {
  return adressGruppenNach(zeilen, brauchtGenauenPin);
}

/**
 * Auswahl des Treffers — ohne Raten: Mit Strasse muss der Treffer eine
 * Adresse sein, ohne Strasse genuegt Ort/PLZ (E66: unvollstaendiger Sitz).
 * Ist eine PLZ angegeben, muss sie uebereinstimmen; fehlt sie in der Datei,
 * kommt sie aus dem Treffer. Alles andere bleibt offen mit Grund.
 */
export function waehleSitz(g: Pick<AdressGruppe, "strasse" | "hausnummer" | "plz" | "ort">, treffer: readonly Adresse[]): SitzErgebnis {
  if (!adressText(g)) return { offen: "Keine Sitz-Angaben in der Zeile." };
  if (!g.plz && !g.ort) return { offen: "Weder PLZ noch Ort angegeben — die Straße allein bestimmt keinen Sitz." };
  const passtPlz = (a: Adresse) => !g.plz || (a.plz ?? "") === g.plz;
  const kandidaten = g.strasse ? treffer.filter((a) => a.art === "adresse") : treffer.filter((a) => a.art === "ort" || a.art === "plz" || a.art === "adresse");
  if (kandidaten.length === 0) return { offen: treffer.length === 0 ? "Kein Treffer der Adresssuche." : g.strasse ? "Kein Adress-Treffer — nur Ort oder Objekt gefunden." : "Kein Orts-Treffer." };
  const mitPlz = kandidaten.filter(passtPlz);
  if (mitPlz.length === 0) return { offen: `PLZ weicht ab: Treffer hat ${kandidaten[0]!.plz ?? "keine PLZ"}, die Datei ${g.plz}.` };
  const a = mitPlz[0]!;
  const plz = g.plz || a.plz || "";
  const ort = g.ort || a.ort || "";
  if (!plz || !ort) return { offen: "PLZ oder Ort auch im Treffer nicht bestimmbar." };
  return { lat: a.lat, lng: a.lng, plz, ort };
}

/** Feld-Patch aus dem Ergebnis. Zahlen mit Dezimalpunkt — Maschinenwerte fuer pruefeAkteurEingabe (Number). */
export function sitzPatch(e: SitzErgebnis): Record<string, string> {
  if ("offen" in e) return { akteur_sitz_offen: e.offen };
  return {
    akteur_sitz_lat: String(e.lat),
    akteur_sitz_lng: String(e.lng),
    akteur_sitz_plz: e.plz,
    akteur_sitz_ort: e.ort,
    akteur_sitz_quelle: e.quelle ?? "photon",
    akteur_sitz_genauigkeit: e.genauigkeit ?? "unbekannt",
  };
}

export interface AdressStandAnzeige {
  gesamt: number;
  gefunden: number;
  offen: number;
  /** E68 PR 3: Pins im PLZ-Gebiet (ungefaehr), davon noch nicht genau gesucht. */
  ungefaehr: number;
  genauOffen: number;
  ohneTreffer: { text: string; grund: string; zeilen: number }[];
}

/** Stand fuer die Seite: neue Akteure je Adresse — mit Pin, offen (noch nicht gesucht), ohne Treffer (mit Grund). */
export function adressStand(zeilen: readonly ZeileFuerAdresse[]): AdressStandAnzeige {
  const neue = zeilen.filter((z) => z.felder.akteur_neu === "1");
  const adressen = new Map<string, { text: string; zeilen: number; lat: boolean; grund: string | null; ungefaehr: boolean; genauOffen: boolean }>();
  for (const z of neue) {
    const k = adressSchluessel(z.felder);
    const f = z.felder;
    const a = adressen.get(k) ?? { text: adressText({ strasse: f.akteur_sitz_strasse ?? "", hausnummer: f.akteur_sitz_hausnummer ?? "", plz: f.akteur_sitz_plz ?? "", ort: f.akteur_sitz_ort ?? "" }), zeilen: 0, lat: !!f.akteur_sitz_lat, grund: f.akteur_sitz_offen ?? null , ungefaehr: f.akteur_sitz_quelle === "plz_gebiet", genauOffen: brauchtGenauenPin(f) };
    a.zeilen += 1;
    adressen.set(k, a);
  }
  const alle = [...adressen.values()];
  return {
    gesamt: alle.length,
    gefunden: alle.filter((a) => a.lat).length,
    offen: alle.filter((a) => !a.lat && !a.grund).length,
    ungefaehr: alle.filter((a) => a.lat && a.ungefaehr).length,
    genauOffen: alle.filter((a) => a.genauOffen).length,
    ohneTreffer: alle.filter((a) => a.grund).map((a) => ({ text: a.text, grund: a.grund!, zeilen: a.zeilen })),
  };
}

/**
 * E68 PR 3, Befund Eric 08.10.2026 (Zeile 39): Spalten der Gruppe „Standort"
 * (plz/ort) gehen unveraendert in den Strom — auch bei vorhandenem Akteur.
 * Deshalb laeuft die lokale PLZ/Ort-Pruefung auch fuer sie, je eindeutigem
 * Paar einmal; ein Befund steht als Zeilenfehler am Feld Standort · PLZ
 * (fehler_plz) und fuehrt in die Nacharbeit. Ohne PLZ gibt es nichts zu
 * pruefen (ein Standort darf nur einen Ort tragen, F0a).
 */
export interface StandortGruppe {
  plz: string;
  ort: string;
  zeilenIds: string[];
}

export function standortGruppen(zeilen: readonly ZeileFuerAdresse[]): StandortGruppe[] {
  const gruppen = new Map<string, StandortGruppe>();
  for (const z of zeilen) {
    const plz = (z.felder.plz ?? "").trim();
    if (!plz) continue;
    const ort = (z.felder.ort ?? "").trim();
    const schluessel = `${plz}|${normName(ort)}`;
    const g = gruppen.get(schluessel);
    if (g) g.zeilenIds.push(z.id);
    else gruppen.set(schluessel, { plz, ort, zeilenIds: [z.id] });
  }
  return [...gruppen.values()];
}

/** Befund des Standorts einer Zeile — null, wenn PLZ bekannt ist und der Ort (falls angegeben) passt. */
export function standortBefund(g: Pick<StandortGruppe, "plz" | "ort">, e: PlzStapelErgebnis): string | null {
  if (!e.plzBekannt) return `PLZ ${g.plz} ist unbekannt — bitte prüfen.`;
  if (g.ort && !e.ortPasst) {
    const liste = e.orte.slice(0, 3).join(", ") + (e.orte.length > 3 ? " …" : "");
    return e.orte.length ? `Ort passt nicht zur PLZ ${g.plz} — meinten Sie ${liste}?` : `Zur PLZ ${g.plz} ist kein Ort hinterlegt.`;
  }
  return null;
}

/** Erkennt einen von standortBefund gesetzten Fehler (damit ein Feldformat-Fehler von feldWert nicht ueberschrieben wird). */
export function istStandortBefund(text: string | undefined): boolean {
  return !!text && (text.startsWith("PLZ ") || text.startsWith("Ort passt nicht zur PLZ ") || text.startsWith("Zur PLZ "));
}

