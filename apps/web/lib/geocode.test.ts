import { describe, expect, it } from "vitest";

import { adresseLabel, dedupeAdressen, nurAdressenUndOrte, photonZuAdresse, waehleTrefferAusPin, type Adresse } from "./geocode";

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
      art: "adresse",
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
      feature({ osm_key: "place", osm_value: "town", name: "Speyer", type: "city", postcode: "67346", state: "Rheinland-Pfalz" }),
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
  const a = (lat: number, lng: number, hausnummer = "12"): Adresse => ({
    art: "adresse",
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

// Sitz-Erfassung b (05.10.2026): Orts- und PLZ-Treffer ohne Strasse, gemessen
// an echten Photon-Antworten vom 05.10.2026.
describe("photonZuAdresse: Orts- und PLZ-Treffer (Sitz-Erfassung b)", () => {
  it("PLZ-Treffer: Photon traegt die PLZ nur im Namen, postcode ist leer", () => {
    const a = photonZuAdresse(
      feature({ osm_key: "place", osm_value: "postcode", type: "other", name: "67346", postcode: null, city: "Speyer", state: "Rheinland-Pfalz" }),
    );
    expect(a).toMatchObject({ art: "plz", plz: "67346", ort: "Speyer", strasse: null });
    expect(adresseLabel(a!)).toBe("67346 Speyer");
  });

  it("Orts-Treffer (place): Name ist der Ort", () => {
    const a = photonZuAdresse(
      feature({ osm_key: "place", osm_value: "village", type: "city", name: "Freiburg (Elbe)", postcode: "21729", county: "Landkreis Stade", state: "Niedersachsen" }),
    );
    expect(a).toMatchObject({ art: "ort", ort: "Freiburg (Elbe)", plz: "21729", strasse: null });
  });

  it("Objekt ohne Strasse (Fluss): kein Ort aus dem Namen, Ort nur aus city", () => {
    const fluss = photonZuAdresse(
      feature({ osm_key: "waterway", osm_value: "river", type: "other", name: "Speyerbach", county: "Landkreis Bad Dürkheim", state: "Rheinland-Pfalz" }),
    );
    expect(fluss).toMatchObject({ art: "objekt", ort: null, strasse: null });
    const bach = photonZuAdresse(
      feature({ osm_key: "waterway", osm_value: "stream", type: "other", name: "Albertgraben", city: "Dannstadt-Schauernheim", state: "Rheinland-Pfalz" }),
    );
    expect(bach).toMatchObject({ art: "objekt", ort: "Dannstadt-Schauernheim", plz: null });
  });

  it("Adresse mit Strasse bleibt art adresse", () => {
    const a = photonZuAdresse(feature({ osm_key: "railway", osm_value: "station", type: "house", name: "Speyer Hauptbahnhof", street: "Bahnhofstraße", postcode: "67346", city: "Speyer" }));
    expect(a).toMatchObject({ art: "adresse", strasse: "Bahnhofstraße", ort: "Speyer" });
  });
});

describe("nurAdressenUndOrte (Suche)", () => {
  it("laesst Adressen, Orte und PLZ durch und verwirft Objekte ohne Strasse", () => {
    const mk = (props: Record<string, unknown>) => photonZuAdresse(feature(props))!;
    const liste = [
      mk({ osm_key: "place", osm_value: "town", type: "city", name: "Speyer", postcode: "67346" }),
      mk({ osm_key: "waterway", osm_value: "river", type: "other", name: "Speyerbach" }),
      mk({ osm_key: "place", osm_value: "postcode", type: "other", name: "67346", city: "Speyer" }),
      mk({ osm_key: "building", osm_value: "train_station", type: "house", name: "Speyer Hauptbahnhof", street: "Bahnhofstraße", postcode: "67346", city: "Speyer" }),
    ];
    expect(nurAdressenUndOrte(liste).map((a) => a.art)).toEqual(["ort", "plz", "adresse"]);
  });
});

// Sitz-Erfassung a, Nachtrag (Eric 05.10.2026): Rueckwaertssuche auf freiem
// Feld — mehrere Treffer, Objekte ignorieren, naechster Treffer mit PLZ im Radius.
describe("waehleTrefferAusPin (Rueckwaertssuche mit mehreren Treffern)", () => {
  const pin = { lng: 8.3, lat: 49.45 };
  const mk = (props: Record<string, unknown>, coords: [number, number]) => photonZuAdresse(feature(props, coords))!;
  // Gemessen 05.10.2026 an lat=49.45 lon=8.30: Bach zuerst, dann Strasse mit PLZ.
  const bach = mk({ osm_key: "waterway", osm_value: "stream", type: "other", name: "Albertgraben", city: "Dannstadt-Schauernheim" }, [8.301, 49.451]);
  const strasse = mk({ osm_key: "highway", osm_value: "secondary", type: "street", name: "Speyerer Straße", postcode: "67125", city: "Dannstadt-Schauernheim" }, [8.31, 49.455]);
  const hausWeit = mk({ osm_key: "building", osm_value: "yes", type: "house", street: "Riedgewanne", housenumber: "2", postcode: "67136", city: "Fußgönheim" }, [8.36, 49.47]);

  it("Strassen-Treffer (type street): Name ist die Strasse, Art adresse", () => {
    expect(strasse).toMatchObject({ art: "adresse", strasse: "Speyerer Straße", plz: "67125", ort: "Dannstadt-Schauernheim" });
  });

  it("freies Feld: Bach als erster Treffer wird ignoriert, PLZ kommt vom naechsten Treffer mit PLZ", () => {
    expect(waehleTrefferAusPin(pin, [bach, strasse, hausWeit], 3)).toBe(strasse);
  });

  it("naechster Treffer zaehlt nach Entfernung, nicht nach Reihenfolge", () => {
    expect(waehleTrefferAusPin(pin, [hausWeit, strasse], 3)).toBe(strasse);
  });

  it("kein Treffer mit PLZ im Radius: null (Feld bleibt leer, Meldung)", () => {
    expect(waehleTrefferAusPin(pin, [bach], 3)).toBeNull();
    expect(waehleTrefferAusPin(pin, [hausWeit], 3)).toBeNull(); // ~4,9 km entfernt
    expect(waehleTrefferAusPin(pin, [], 3)).toBeNull();
  });
});
