import { describe, expect, it } from "vitest";

import { adresseLabelMitRegion, kreisKurz, landKuerzel, regionLabel } from "./region-label";

describe("Sitz-Erfassung c: Kreis und Land als Kurzform", () => {
  it("landKuerzel: amtliche Kuerzel der 16 Laender, unbekannt bleibt wie es ist", () => {
    expect(landKuerzel("Niedersachsen")).toBe("NI");
    expect(landKuerzel("Baden-Württemberg")).toBe("BW");
    expect(landKuerzel("Rheinland-Pfalz")).toBe("RP");
    expect(landKuerzel("Freie Hansestadt Bremen")).toBe("HB");
    expect(landKuerzel("Nirgendwo")).toBe("Nirgendwo");
    expect(landKuerzel(null)).toBeNull();
  });

  it("kreisKurz aus Photon-county: Landkreis Stade wird Lkr. Stade, sonst unveraendert", () => {
    expect(kreisKurz("Landkreis Stade")).toBe("Lkr. Stade");
    expect(kreisKurz("Rhein-Pfalz-Kreis")).toBe("Rhein-Pfalz-Kreis");
    expect(kreisKurz("Südliche Weinstraße")).toBe("Südliche Weinstraße");
    expect(kreisKurz(null)).toBeNull();
  });

  it("kreisKurz aus VG250 (name + bez): Landkreis → Lkr., Kreis → Kreis, kreisfreie Stadt entfaellt", () => {
    expect(kreisKurz("Stade", "Landkreis")).toBe("Lkr. Stade");
    expect(kreisKurz("Düren", "Kreis")).toBe("Kreis Düren");
    expect(kreisKurz("Speyer", "Kreisfreie Stadt")).toBeNull();
    expect(kreisKurz("Freiburg im Breisgau", "Stadtkreis")).toBeNull();
    expect(kreisKurz("Saarbrücken", "Regionalverband")).toBe("Regionalverband Saarbrücken");
  });

  it("regionLabel und adresseLabelMitRegion: Freiburg (Elbe) · Lkr. Stade · NI", () => {
    expect(regionLabel({ kreis: "Landkreis Stade", land: "Niedersachsen" })).toBe("Lkr. Stade · NI");
    expect(regionLabel({ kreis: null, land: "Baden-Württemberg" })).toBe("BW");
    expect(regionLabel({ kreis: null, land: null })).toBe("");
    expect(
      adresseLabelMitRegion({ art: "ort", strasse: null, hausnummer: null, plz: "21729", ort: "Freiburg (Elbe)", kreis: "Landkreis Stade", land: "Niedersachsen", lng: 9.3, lat: 53.8 }),
    ).toBe("21729 Freiburg (Elbe) · Lkr. Stade · NI");
    expect(
      adresseLabelMitRegion({ art: "ort", strasse: null, hausnummer: null, plz: null, ort: "Freiburg im Breisgau", kreis: null, land: "Baden-Württemberg", lng: 7.8, lat: 48.0 }),
    ).toBe("Freiburg im Breisgau · BW");
  });
});
