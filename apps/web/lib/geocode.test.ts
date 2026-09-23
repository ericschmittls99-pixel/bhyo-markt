import { describe, expect, it } from "vitest";

import { adresseLabel, dedupeAdressen, photonZuAdresse } from "./geocode";

const feature = (props: Record<string, unknown>, coords: [number, number] = [8.43, 49.32]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: coords },
  properties: { countrycode: "DE", ...props },
});

describe("photonZuAdresse", () => {
  it("mappt ein Hausnummern-Ergebnis vollstaendig", () => {
    const a = photonZuAdresse(
      feature({
        street: "Hauptstraße",
        housenumber: "12",
        postcode: "67346",
        city: "Speyer",
        state: "Rheinland-Pfalz",
      }),
    );
    expect(a).toEqual({
      strasse: "Hauptstraße",
      hausnummer: "12",
      plz: "67346",
      ort: "Speyer",
      lng: 8.43,
      lat: 49.32,
    });
  });

  it("nutzt fuer Orts-Treffer den Namen als Ort", () => {
    const a = photonZuAdresse(
      feature({ name: "Speyer", type: "city", postcode: "67346", state: "Rheinland-Pfalz" }),
    );
    expect(a).toMatchObject({ ort: "Speyer", strasse: null, hausnummer: null });
  });

  it("verwirft Treffer ausserhalb Deutschlands und ohne Koordinate", () => {
    expect(photonZuAdresse(feature({ city: "Straßburg", countrycode: "FR" }))).toBeNull();
    expect(
      photonZuAdresse({ type: "Feature", geometry: null, properties: { countrycode: "DE" } }),
    ).toBeNull();
  });
});

describe("adresseLabel", () => {
  it("baut ein kompaktes Label aus den vorhandenen Teilen", () => {
    expect(
      adresseLabel({
        strasse: "Hauptstraße",
        hausnummer: "12",
        plz: "67346",
        ort: "Speyer",
          lng: 8.43,
        lat: 49.32,
      }),
    ).toBe("Hauptstraße 12, 67346 Speyer");
    expect(
      adresseLabel({ strasse: null, hausnummer: null, plz: null, ort: "Speyer", lng: 8.43, lat: 49.32 }),
    ).toBe("Speyer");
  });
});

describe("dedupeAdressen", () => {
  const a = (lat: number, lng: number, hausnummer = "12") => ({
    strasse: "Maximilianstraße",
    hausnummer,
    plz: "67346",
    ort: "Speyer",
    lat,
    lng,
  });

  it("entfernt Photon-Mehrfachtreffer derselben Adresse (Label + ~100-m-Koordinate)", () => {
    // Node, Way-Centroid und POI derselben Hausnummer liegen Meter auseinander.
    const liste = [a(49.3172, 8.4386), a(49.31725, 8.43857), a(49.3173, 8.4386)];
    expect(dedupeAdressen(liste)).toHaveLength(1);
  });

  it("behaelt echte Nachbarn und gleiche Labels an anderen Orten", () => {
    expect(dedupeAdressen([a(49.3172, 8.4386), a(49.3172, 8.4386, "14")])).toHaveLength(2);
    expect(dedupeAdressen([a(49.3172, 8.4386), a(49.5, 8.6)])).toHaveLength(2);
  });
});
