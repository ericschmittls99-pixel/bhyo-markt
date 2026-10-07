import { describe, expect, it } from "vitest";

import { KOMMENTAR_TEXT_MAX, erwaehnungenAus, erwaehnungsMarker, pruefeKommentarText } from "./kommentar-marker";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";

describe("E71 Marker-Parsing", () => {
  it("findet Marker im Fliesstext, in Reihenfolge, auch am Satzende und ohne Leerzeichen", () => {
    expect(erwaehnungenAus(`Bitte ${erwaehnungsMarker(A)} prüfen,${erwaehnungsMarker(B)}übernimmt.`)).toEqual([A, B]);
  });
  it("doppelte Erwaehnung zaehlt einmal; Gross-/Kleinschreibung der UUID wird vereinheitlicht", () => {
    expect(erwaehnungenAus(`${erwaehnungsMarker(A)} und nochmal @[nutzer:${A.toUpperCase()}]`)).toEqual([A]);
  });
  it("nacktes @, fremde Formen und unvollstaendige UUIDs sind Fliesstext", () => {
    expect(erwaehnungenAus("@eric, @[nutzer:eric], @[nutzer:00000000-0000-4000-8000], @[benutzer:" + A + "]")).toEqual([]);
    expect(erwaehnungenAus("ohne Marker")).toEqual([]);
  });
  it("eine fremde UUID wird geparst — ob sie erwaehnbar ist, entscheidet der Schreibweg (nicht das Parsing)", () => {
    expect(erwaehnungenAus(erwaehnungsMarker("ffffffff-ffff-4fff-8fff-ffffffffffff"))).toEqual(["ffffffff-ffff-4fff-8fff-ffffffffffff"]);
  });
});

describe("E71 Textregel (wie CHECK kommentar_text_check)", () => {
  it("leer oder nur Leerraum wird abgewiesen, getrimmt gespeichert", () => {
    expect(pruefeKommentarText("")).toEqual({ ok: false, fehler: "Der Kommentar ist leer." });
    expect(pruefeKommentarText("   \n")).toEqual({ ok: false, fehler: "Der Kommentar ist leer." });
    expect(pruefeKommentarText(undefined).ok).toBe(false);
    expect(pruefeKommentarText("  Hallo  ")).toEqual({ ok: true, text: "Hallo" });
  });
  it("Grenze 2000 Zeichen: 2000 ja, 2001 nein", () => {
    expect(pruefeKommentarText("x".repeat(KOMMENTAR_TEXT_MAX)).ok).toBe(true);
    expect(pruefeKommentarText("x".repeat(KOMMENTAR_TEXT_MAX + 1)).ok).toBe(false);
  });
});
