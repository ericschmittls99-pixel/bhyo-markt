/**
 * AP6 (Vormerkung §47, 09.10.2026): pruefeAdresse schickt bei Ortsteil-Form den
 * amtlichen Ort an den Adressdienst, den Ortsteil als Zusatz — Mock-Antwort,
 * kein Netz, keine DB (die lokalen Pruefungen sind Attrappen).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const anfragen: string[] = [];
let orte = ["Mannheim"];
vi.mock("./plz-server", () => ({
  PLZ_BESTAND_FEHLT: "PLZ-Gebiete fehlen",
  plzBestandVorhanden: async () => true,
  pruefePlzOrt: async () => ({ plzBekannt: true, ortPasst: true, orte }),
  pinInPlz: async () => true,
}));
vi.mock("./photon-server", () => ({
  photonSuche: async (q: string) => {
    anfragen.push(q);
    return [{ art: "adresse", strasse: "Rheinstraße", hausnummer: "1", plz: "68199", ort: "Mannheim", kreis: null, land: null, lng: 8.47, lat: 49.45 }];
  },
}));

const { pruefeAdresse } = await import("./adresse-pruefung-server");
// db-Attrappe: plzRueckfallPin/plzKreise fragen db.execute — leer genuegt (kein Rueckfall noetig).
const db = { execute: async () => [] } as never;

beforeEach(() => {
  anfragen.length = 0;
  orte = ["Mannheim"];
});

describe("pruefeAdresse: Ortsteil-Form (AP6)", () => {
  it("„68199 Mannheim-Neckarau“ mit Strasse -> Anfrage „Rheinstraße 1, 68199 Mannheim Neckarau“, Treffer wird uebernommen", async () => {
    const a = await pruefeAdresse(db, { strasse: "Rheinstraße", hausnummer: "1", plz: "68199", ort: "Mannheim-Neckarau" });
    expect(anfragen).toEqual(["Rheinstraße 1, 68199 Mannheim Neckarau"]);
    expect(a.ergebnis.status).toBe("treffer");
    expect("genauigkeit" in a.ergebnis ? a.ergebnis.genauigkeit : null).toBe("hausnummer");
  });
  it("Rot: ohne Ortsteil bleibt die Anfrage wie eingegeben", async () => {
    await pruefeAdresse(db, { strasse: "Rheinstraße", hausnummer: "1", plz: "68199", ort: "Mannheim" });
    expect(anfragen).toEqual(["Rheinstraße 1, 68199 Mannheim"]);
  });
  it("Kurzform („Ludwigshafen“ zu „Ludwigshafen am Rhein“) ist kein Ortsteil — Eingabe bleibt", async () => {
    orte = ["Ludwigshafen am Rhein"];
    await pruefeAdresse(db, { strasse: "Hauptstraße", hausnummer: "2", plz: "67059", ort: "Ludwigshafen" });
    expect(anfragen).toEqual(["Hauptstraße 2, 67059 Ludwigshafen"]);
  });
});
