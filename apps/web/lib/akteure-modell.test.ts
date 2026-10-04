import { describe, expect, it } from "vitest";

import { filterAkteure, sitzText, zustaendeAus, type AkteurZeile } from "./akteure-modell";

const basis: AkteurZeile = {
  id: "a1", name: "Hof Müller", sektor: "landwirtschaft", sektorLabel: "Landwirtschaft",
  sitzStrasse: "Hauptstraße", sitzHausnummer: "1", sitzPlz: "74889", sitzOrt: "Sinsheim", sitzLng: 8.88, sitzLat: 49.25,
  kreisArs: "08226", kreisName: "Rhein-Neckar-Kreis", regionIds: ["r1"], stroeme: 2, mitBeleg: 1, verwaistSeit: null, erstelltAm: "2026-01-01",
};

// AP2.5 PR a1 (E66): abgeleitete Zustaende und der Filter der Akteurliste.
describe("Akteur-Zustaende (E66)", () => {
  it("vollstaendig: Adresse, Stroeme mit Beleg", () => {
    expect(zustaendeAus(basis)).toEqual([]);
  });
  it("unvollstaendig heisst: keine Adresse (Strasse fehlt); ein fehlender Pin ist seit a2 nicht mehr moeglich", () => {
    expect(zustaendeAus({ ...basis, sitzStrasse: null })).toEqual(["unvollstaendig"]);
    expect(zustaendeAus({ ...basis, sitzLng: null, sitzLat: null })).toEqual([]);
  });
  it("ohne Beleg: Stroeme vorhanden, keiner mit Beleg; verwaist: kein Strom", () => {
    expect(zustaendeAus({ ...basis, mitBeleg: 0 })).toEqual(["ohne_beleg"]);
    expect(zustaendeAus({ ...basis, stroeme: 0, mitBeleg: 0 })).toEqual(["verwaist"]);
  });
  it("Filter: Sitz in Region, Sektor (ohne_sektor), Akteur, Zustand, Suche", () => {
    const pool = [basis, { ...basis, id: "a2", name: "Stadt Speyer", sektor: "ohne_sektor", regionIds: [], stroeme: 0, mitBeleg: 0, sitzOrt: "Speyer" }];
    const leer = { q: "", region: [], sektor: [], akteur: [], akteur_zustand: [] };
    expect(filterAkteure(pool, { ...leer, region: ["r1"] }).map((a) => a.id)).toEqual(["a1"]);
    expect(filterAkteure(pool, { ...leer, sektor: ["ohne_sektor"] }).map((a) => a.id)).toEqual(["a2"]);
    expect(filterAkteure(pool, { ...leer, akteur: ["a2"] }).map((a) => a.id)).toEqual(["a2"]);
    expect(filterAkteure(pool, { ...leer, akteur_zustand: ["verwaist"] }).map((a) => a.id)).toEqual(["a2"]);
    expect(filterAkteure(pool, { ...leer, q: "speyer" }).map((a) => a.id)).toEqual(["a2"]);
  });
  it("Sitz als Text", () => {
    expect(sitzText(basis)).toBe("Hauptstraße 1, 74889 Sinsheim");
    expect(sitzText({ sitzStrasse: null, sitzHausnummer: null, sitzPlz: "74889", sitzOrt: "Sinsheim" })).toBe("74889 Sinsheim");
  });
});
