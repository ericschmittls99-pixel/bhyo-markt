/**
 * E77 R7: Regeln fuer Profilbild und Anzeigename — reine Funktionen.
 *   1. Quadratischer Ausschnitt: mittig, Kante = kuerzere Seite (quer, hoch, quadratisch, 1 px).
 *   2. Bildtyp aus den Bytes: JPEG/PNG/WebP erkannt, alles andere (SVG, GIF, Text, leer) nicht.
 *   3. Pruefung: zu gross (> 1 MB) und falscher Typ werden mit klarer Meldung abgewiesen,
 *      ein gueltiges Bild liefert seinen Typ; der gemeldete MIME-Typ spielt keine Rolle.
 *   4. Anzeigename: Leerraum zusammengezogen, leer = null, > 80 Zeichen abgewiesen.
 *   5. Key und URL: Praefix profil/<umgebung>/<id>/, Endung aus dem Typ; URL mit Versionszaehler, ohne Version null.
 */
import { describe, expect, it } from "vitest";

import {
  ANZEIGENAME_MAX,
  bildTypAusBytes,
  PROFILBILD_MAX_BYTES,
  profilbildKey,
  profilbildUrl,
  pruefeAnzeigename,
  pruefeProfilbild,
  quadratAusschnitt,
} from "./profil-bild";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe("quadratAusschnitt", () => {
  it("nimmt mittig die kuerzere Seite", () => {
    expect(quadratAusschnitt(400, 300)).toEqual({ x: 50, y: 0, kante: 300 });
    expect(quadratAusschnitt(300, 500)).toEqual({ x: 0, y: 100, kante: 300 });
    expect(quadratAusschnitt(256, 256)).toEqual({ x: 0, y: 0, kante: 256 });
    expect(quadratAusschnitt(1, 1)).toEqual({ x: 0, y: 0, kante: 1 });
  });
});

describe("bildTypAusBytes", () => {
  it("erkennt JPEG, PNG und WebP an den Bytes", () => {
    expect(bildTypAusBytes(JPEG)).toBe("image/jpeg");
    expect(bildTypAusBytes(PNG)).toBe("image/png");
    expect(bildTypAusBytes(WEBP)).toBe("image/webp");
  });
  it("weist GIF, SVG, Text und leere Daten zurueck", () => {
    expect(bildTypAusBytes(GIF)).toBeNull();
    expect(bildTypAusBytes(SVG)).toBeNull();
    expect(bildTypAusBytes(new TextEncoder().encode("kein bild"))).toBeNull();
    expect(bildTypAusBytes(new Uint8Array())).toBeNull();
    // RIFF ohne WEBP-Kennung (z. B. WAV) ist kein Bild.
    expect(bildTypAusBytes(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
  });
});

describe("pruefeProfilbild", () => {
  it("gueltiges Bild: Typ aus den Bytes", () => {
    expect(pruefeProfilbild(PNG)).toEqual({ typ: "image/png" });
  });
  it("zu gross: abgewiesen, auch wenn der Typ stimmt", () => {
    const gross = new Uint8Array(PROFILBILD_MAX_BYTES + 1);
    gross.set(JPEG);
    expect(pruefeProfilbild(gross)).toEqual({ fehler: expect.stringContaining("1 MB") });
    const grenze = new Uint8Array(PROFILBILD_MAX_BYTES);
    grenze.set(JPEG);
    expect(pruefeProfilbild(grenze)).toEqual({ typ: "image/jpeg" });
  });
  it("falscher Typ und leere Datei: abgewiesen", () => {
    expect(pruefeProfilbild(SVG)).toEqual({ fehler: "Nur JPG, PNG oder WebP sind erlaubt." });
    expect(pruefeProfilbild(new Uint8Array())).toEqual({ fehler: "Keine Bilddatei übermittelt." });
  });
});

describe("pruefeAnzeigename", () => {
  it("zieht Leerraum zusammen, leer wird null", () => {
    expect(pruefeAnzeigename("  Eric   Schmitt ")).toEqual({ wert: "Eric Schmitt" });
    expect(pruefeAnzeigename("   ")).toEqual({ wert: null });
    expect(pruefeAnzeigename("")).toEqual({ wert: null });
  });
  it("weist mehr als 80 Zeichen ab statt zu kuerzen", () => {
    expect(pruefeAnzeigename("a".repeat(ANZEIGENAME_MAX))).toEqual({ wert: "a".repeat(80) });
    expect(pruefeAnzeigename("a".repeat(ANZEIGENAME_MAX + 1))).toEqual({ fehler: expect.stringContaining("80") });
  });
});

describe("profilbildKey und profilbildUrl", () => {
  it("Key mit Umgebung, Nutzer-ID und Endung aus dem Typ", () => {
    expect(profilbildKey("preview", "u-1", "k-9", "image/webp")).toBe("profil/preview/u-1/k-9.webp");
    expect(profilbildKey("production", "u-1", "k-9", "image/jpeg")).toBe("profil/production/u-1/k-9.jpg");
  });
  it("URL nur mit Version; ohne Bild null", () => {
    expect(profilbildUrl("u-1", new Date(1700000000000))).toBe("/api/profil/bild/u-1?v=1700000000000");
    expect(profilbildUrl("u-1", 5)).toBe("/api/profil/bild/u-1?v=5");
    expect(profilbildUrl("u-1", null)).toBeNull();
    expect(profilbildUrl("u-1", undefined)).toBeNull();
  });
});
