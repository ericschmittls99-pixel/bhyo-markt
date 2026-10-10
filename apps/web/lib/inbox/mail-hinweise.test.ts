/**
 * AP2.9 Umschalten: die reinen Teile der Mail-Hinweise — Tage bis zum Ablauf,
 * faellige Stufen (30/7, auch nach dem Ablauf), welche Ursachen eine Stoerung sind.
 */
import { describe, expect, it } from "vitest";

import { faelligeSecretStufen, istStoerung, tageBis } from "./mail-hinweise";

describe("tageBis / faelligeSecretStufen", () => {
  it("zaehlt Kalendertage, auch ueber die Zeitumstellung hinweg", () => {
    expect(tageBis("2026-11-09", "2026-10-10")).toBe(30);
    expect(tageBis("2026-10-10", "2026-10-10")).toBe(0);
    expect(tageBis("2026-10-01", "2026-10-10")).toBe(-9);
  });
  it("Stufe 30 ab 30 Tagen vorher, Stufe 7 ab 7 Tagen; davor nichts, nach dem Ablauf beide", () => {
    expect(faelligeSecretStufen("2026-11-10", "2026-10-10")).toEqual([]);
    expect(faelligeSecretStufen("2026-11-09", "2026-10-10")).toEqual([30]);
    expect(faelligeSecretStufen("2026-10-17", "2026-10-10")).toEqual([30, 7]);
    expect(faelligeSecretStufen("2026-10-01", "2026-10-10")).toEqual([30, 7]);
  });
});

describe("istStoerung", () => {
  it("dauerhafte Ursachen ja, voruebergehende nein", () => {
    for (const u of ["secret_abgelaufen", "secret_ungueltig", "app_unbekannt", "zugriff_verweigert", "postfach_unbekannt", "nicht_konfiguriert"]) expect(istStoerung(u)).toBe(true);
    for (const u of ["gedrosselt", "netz", "token_sonst", "sonst", ""]) expect(istStoerung(u)).toBe(false);
  });
});
