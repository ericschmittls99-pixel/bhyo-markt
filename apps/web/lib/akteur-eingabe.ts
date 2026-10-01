/**
 * AP2.5 PR a1 (E66): Pruefung der Akteur-Stammdaten — reine Funktion, von der
 * Inline-Anlage im Beleg (API) und dem Bearbeiten in akteure. (Action)
 * gemeinsam genutzt. Pflicht: Name, Sektor (leer = Systemzeile ohne_sektor),
 * PLZ und Ort des Sitzes, Pin (lat/lng) — denn der Kreis-ARS kommt ueber den
 * E25-Weg aus der Koordinate; PLZ/Ort allein bestimmen ihn nicht. Die DB
 * bekommt NOT NULL fuer Sektor, PLZ und Ort mit a2.
 */
import { sektorAusEingabe } from "./akteur-anlage";

export interface AkteurEingabe {
  name: string;
  sektor: string;
  sitzStrasse: string;
  sitzHausnummer: string;
  sitzPlz: string;
  sitzOrt: string;
  lat: string;
  lng: string;
}

export const OHNE_ORT = "Der Ort ist nicht bestimmbar: PLZ, Ort und ein Pin in Deutschland sind nötig (Kreis-ARS, E25).";

export type AkteurPruefung = { ok: true; w: AkteurEingabe; geom: { lng: number; lat: number } } | { ok: false; fehler: string };

function feld(src: FormData | Record<string, unknown>, k: string): string {
  const v = src instanceof FormData ? src.get(k) : src[k];
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

export function pruefeAkteurEingabe(src: FormData | Record<string, unknown>, aktiveCodes: readonly string[]): AkteurPruefung {
  const w: AkteurEingabe = {
    name: feld(src, "name"),
    sektor: feld(src, "sektor"),
    // Die Sitz-Felder heissen sitz_*; der AdresseBlock (akteure., Bearbeiten) liefert strasse/hausnummer/plz/ort.
    sitzStrasse: feld(src, "sitz_strasse") || feld(src, "strasse"),
    sitzHausnummer: feld(src, "sitz_hausnummer") || feld(src, "hausnummer"),
    sitzPlz: feld(src, "sitz_plz") || feld(src, "plz"),
    sitzOrt: feld(src, "sitz_ort") || feld(src, "ort"),
    lat: feld(src, "lat"),
    lng: feld(src, "lng"),
  };
  if (!w.name) return { ok: false, fehler: "Name ist Pflicht." };
  const sektor = sektorAusEingabe(w.sektor, aktiveCodes);
  if (!sektor.ok) return { ok: false, fehler: sektor.fehler };
  w.sektor = sektor.sektor ?? "ohne_sektor";
  if (!w.sitzPlz || !w.sitzOrt) return { ok: false, fehler: "PLZ und Ort des Sitzes sind Pflicht." };
  const lat = Number(w.lat);
  const lng = Number(w.lng);
  if (!w.lat || !w.lng || !Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, fehler: OHNE_ORT };
  return { ok: true, w, geom: { lng, lat } };
}
