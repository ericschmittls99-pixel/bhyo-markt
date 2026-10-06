import type { Adresse } from "@/lib/geocode";
import { normName } from "@/lib/import-zuordnung";

/**
 * AP2.7 PR b (E67): Sitz neuer Akteure per Adresssuche — je eindeutiger
 * Adresse ein Aufruf (Zwischenspeicher sind die Felder der Zeilen, dadurch
 * fortsetzbar), gedrosselt in kleinen Stapeln je Request. Ohne eindeutigen
 * Treffer bleibt der Sitz offen → Nacharbeit (E66: ohne PLZ, Ort und Pin
 * kein Akteur). Reine Regeln; Netz und DB in import-actions.ts.
 *
 * Felder je Zeile: akteur_sitz_lat / akteur_sitz_lng (Dezimalpunkt, Maschinenwerte),
 * akteur_sitz_quelle = "photon", akteur_sitz_offen = Grund (kein Treffer, PLZ weicht ab …).
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
  const gruppen = new Map<string, AdressGruppe>();
  for (const z of zeilen) {
    if (!brauchtSitz(z.felder)) continue;
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

export type SitzErgebnis = { lat: number; lng: number; plz: string; ort: string } | { offen: string };

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
  return { akteur_sitz_lat: String(e.lat), akteur_sitz_lng: String(e.lng), akteur_sitz_plz: e.plz, akteur_sitz_ort: e.ort, akteur_sitz_quelle: "photon" };
}

export interface AdressStandAnzeige {
  gesamt: number;
  gefunden: number;
  offen: number;
  ohneTreffer: { text: string; grund: string; zeilen: number }[];
}

/** Stand fuer die Seite: neue Akteure je Adresse — mit Pin, offen (noch nicht gesucht), ohne Treffer (mit Grund). */
export function adressStand(zeilen: readonly ZeileFuerAdresse[]): AdressStandAnzeige {
  const neue = zeilen.filter((z) => z.felder.akteur_neu === "1");
  const adressen = new Map<string, { text: string; zeilen: number; lat: boolean; grund: string | null }>();
  for (const z of neue) {
    const k = adressSchluessel(z.felder);
    const f = z.felder;
    const a = adressen.get(k) ?? { text: adressText({ strasse: f.akteur_sitz_strasse ?? "", hausnummer: f.akteur_sitz_hausnummer ?? "", plz: f.akteur_sitz_plz ?? "", ort: f.akteur_sitz_ort ?? "" }), zeilen: 0, lat: !!f.akteur_sitz_lat, grund: f.akteur_sitz_offen ?? null };
    a.zeilen += 1;
    adressen.set(k, a);
  }
  const alle = [...adressen.values()];
  return {
    gesamt: alle.length,
    gefunden: alle.filter((a) => a.lat).length,
    offen: alle.filter((a) => !a.lat && !a.grund).length,
    ohneTreffer: alle.filter((a) => a.grund).map((a) => ({ text: a.text, grund: a.grund!, zeilen: a.zeilen })),
  };
}
