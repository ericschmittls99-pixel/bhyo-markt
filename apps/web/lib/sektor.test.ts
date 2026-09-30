import { describe, expect, it } from "vitest";

import { codeAusLabel, DEAKTIVIERT_SUFFIX, GESPERRTE_CODES, labelSchluessel, pruefeSektorLabel, RESERVIERTE_LABELS, sektorAnzeige } from "./sektor";

const BESTAND = [
  { code: "energie", label: "Energie" },
  { code: "landwirtschaft", label: "Landwirtschaft" },
];

// AP2.3 PR b (E59): Sektorliste pflegbar — Regeln der Vorpruefung.
describe("codeAusLabel", () => {
  it("snake_case ohne Umlaute, wie die Enum-Werte", () => {
    expect(codeAusLabel("Ernährungswirtschaft")).toBe("ernaehrungswirtschaft");
    expect(codeAusLabel(" Öffentliche Hand / Kommunen ")).toBe("oeffentliche_hand_kommunen");
    expect(codeAusLabel("Straßenbau")).toBe("strassenbau");
    expect(codeAusLabel("Café & Co.")).toBe("cafe_co");
    expect(codeAusLabel("---")).toBe("");
  });
});

describe("pruefeSektorLabel", () => {
  it("Neuanlage: Bezeichnung und abgeleiteter Code", () => {
    expect(pruefeSektorLabel("  Chemie  ", BESTAND)).toEqual({ ok: true, label: "Chemie", code: "chemie" });
  });
  it("leer, zu lang, kein Code", () => {
    expect(pruefeSektorLabel("   ", BESTAND).ok).toBe(false);
    expect(pruefeSektorLabel("x".repeat(61), BESTAND).ok).toBe(false);
    expect(pruefeSektorLabel("???", BESTAND).ok).toBe(false);
  });
  it("Dublette ohne Ruecksicht auf Schreibweise und Randleerraum — wie der Index lower(btrim)", () => {
    const r = pruefeSektorLabel(" ENERGIE ", BESTAND);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.text).toContain("Energie");
  });
  it("Code schon vergeben (andere Bezeichnung, gleicher Code)", () => {
    expect(pruefeSektorLabel("Energie!", BESTAND).ok).toBe(false);
  });
  it("E61: „ohne Sektor“ und „Abnehmer“ sind als Code und Bezeichnung reserviert — beim Anlegen und beim Umbenennen", () => {
    expect(GESPERRTE_CODES).toEqual(["ohne_sektor", "abnehmer"]);
    expect(RESERVIERTE_LABELS).toEqual(["abnehmer", "ohne sektor"]);
    expect(pruefeSektorLabel("ohne Sektor", BESTAND).ok).toBe(false);
    expect(pruefeSektorLabel("Ohne  Sektor", BESTAND).ok).toBe(false);
    expect(pruefeSektorLabel("Abnehmer", BESTAND).ok).toBe(false);
    // Umbenennen: der Code bleibt, die Bezeichnung ist trotzdem reserviert.
    expect(pruefeSektorLabel("Abnehmer", BESTAND, "energie").ok).toBe(false);
    expect(pruefeSektorLabel("  ABNEHMER\t", BESTAND, "energie").ok).toBe(false);
    expect(pruefeSektorLabel("ohne Sektor", BESTAND, "energie").ok).toBe(false);
  });
  it("E61: labelSchluessel rechnet wie sektor_label_norm (Leerzeichen, Tab, CR, LF am Rand; Kleinschreibung)", () => {
    expect(labelSchluessel(" \tEnergie\r\n")).toBe("energie");
    expect(labelSchluessel("Energie Wirtschaft")).toBe("energie wirtschaft");
    // Kein trim(): geschuetztes Leerzeichen bleibt, wie in btrim(label, E' \t\r\n').
    expect(labelSchluessel("\u00a0Energie")).toBe("\u00a0energie");
    const r = pruefeSektorLabel("energie\t", BESTAND);
    expect(r.ok).toBe(false);
  });
  it("Umbenennen: der eigene Name zaehlt nicht als Dublette, ein fremder schon; der Code bleibt", () => {
    expect(pruefeSektorLabel("energie", BESTAND, "energie")).toEqual({ ok: true, label: "energie", code: "energie" });
    expect(pruefeSektorLabel("Energiewirtschaft", BESTAND, "energie")).toEqual({ ok: true, label: "Energiewirtschaft", code: "energie" });
    expect(pruefeSektorLabel("Landwirtschaft", BESTAND, "energie").ok).toBe(false);
  });
});

describe("sektorAnzeige", () => {
  it("deaktiviert bleibt sichtbar und benannt", () => {
    expect(sektorAnzeige("Energie", true)).toBe("Energie");
    expect(sektorAnzeige("Energie", false)).toBe(`Energie${DEAKTIVIERT_SUFFIX}`);
  });
});
