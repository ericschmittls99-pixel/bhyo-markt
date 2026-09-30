/**
 * AP2.3 PR b (E59): Regeln der Sektorliste — rein, ohne Datenbank. Die
 * tragenden Regeln sitzen zusaetzlich in der Datenbank (Migration 0030:
 * eindeutiger Index auf lower(btrim(label)), CHECK auf den Code); hier steht
 * die Vorpruefung mit verstaendlicher Meldung und die Ableitung des Codes.
 */
import { OHNE_SEKTOR } from "./hierarchie-baeume";

export const LABEL_MAX = 60;
/** Anhang in Auswahllisten und Filtern fuer einen deaktivierten Sektor. */
export const DEAKTIVIERT_SUFFIX = " (deaktiviert)";
/**
 * Nie ein Sektor-Code: `ohne_sektor` ist der benannte Filterwert fuer NULL
 * (lib/hierarchie-baeume.ts), `abnehmer` eine Rolle (Migration 0020). Der
 * CHECK sektor_code_check in der Datenbank nennt dieselben beiden.
 */
export const GESPERRTE_CODES: readonly string[] = [OHNE_SEKTOR, "abnehmer"];

export interface SektorEintrag {
  code: string;
  label: string;
}

/** Bezeichnung → Code wie die Enum-Werte: snake_case, ohne Umlaute. */
export function codeAusLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Vergleichsform der Bezeichnung — dieselbe wie der Index (lower(btrim)). */
export function labelSchluessel(label: string): string {
  return label.trim().toLowerCase();
}

export type SektorPruefung = { ok: true; label: string; code: string } | { ok: false; text: string };

/**
 * Prueft eine Bezeichnung fuer Neuanlage (`eigenerCode` leer) oder
 * Umbenennung (`eigenerCode` = der Sektor, der den Namen bekommt).
 */
export function pruefeSektorLabel(roh: string, bestehende: readonly SektorEintrag[], eigenerCode?: string): SektorPruefung {
  const label = roh.trim().replace(/\s+/g, " ");
  if (!label) return { ok: false, text: "Bezeichnung ist Pflicht." };
  if (label.length > LABEL_MAX) return { ok: false, text: `Bezeichnung höchstens ${LABEL_MAX} Zeichen.` };
  const code = eigenerCode ?? codeAusLabel(label);
  if (!code) return { ok: false, text: "Aus der Bezeichnung lässt sich kein Code bilden (Buchstaben oder Ziffern nötig)." };
  if (GESPERRTE_CODES.includes(code) || labelSchluessel(label) === "ohne sektor") {
    return { ok: false, text: "„ohne Sektor“ ist der Zustand ohne Zuordnung und „Abnehmer“ eine Rolle — beides ist kein Sektor." };
  }
  const gleich = bestehende.find((s) => s.code !== eigenerCode && labelSchluessel(s.label) === labelSchluessel(label));
  if (gleich) return { ok: false, text: `„${gleich.label}“ gibt es schon.` };
  if (!eigenerCode && bestehende.some((s) => s.code === code)) {
    return { ok: false, text: `Der Code „${code}“ ist schon vergeben (Sektor „${bestehende.find((s) => s.code === code)!.label}“).` };
  }
  return { ok: true, label, code };
}

/** Anzeige-Label: deaktivierte Sektoren bleiben sichtbar, aber benannt. */
export function sektorAnzeige(label: string, aktiv: boolean): string {
  return aktiv ? label : `${label}${DEAKTIVIERT_SUFFIX}`;
}
