/**
 * AP2.7 PR b (E67): Akteure je eindeutigem Akteur (Normname + PLZ), auch
 * innerhalb des Laufs; Entscheidung aus dem obersten Treffer.
 */
import { describe, expect, it } from "vitest";

import { akteurGruppen, akteurGruppenAnzeige, entscheidungAusTreffer, gruppenSchluessel, offeneAkteurGruppen, sektorKonflikte, type ZeileFuerAkteur } from "./import-akteure";

const zeilen: ZeileFuerAkteur[] = [
  { id: "z1", status: "offen", felder: { akteur_name: "Hof Mustermann", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer" } },
  { id: "z2", status: "offen", felder: { akteur_name: "Biogas Kraichgau GmbH", akteur_sitz_plz: "76646", akteur_sitz_ort: "Bruchsal" } },
  { id: "z3", status: "fehler", felder: { akteur_name: "HOF  Mustermann", akteur_sitz_plz: " 67346 " } },
  { id: "z4", status: "offen", felder: { akteur_name: "Hof Mustermann", akteur_sitz_plz: "67347" } },
  { id: "z5", status: "offen", felder: { materialart_code: "x" } },
];

describe("akteurGruppen", () => {
  it("fasst Zeilen mit gleichem Normnamen und gleicher PLZ zusammen; andere PLZ ist eine andere Gruppe; ohne Namen keine Gruppe", () => {
    const g = akteurGruppen(zeilen);
    expect(g.map((x) => [x.name, x.plz, x.zeilenIds])).toEqual([
      ["Hof Mustermann", "67346", ["z1", "z3"]],
      ["Biogas Kraichgau GmbH", "76646", ["z2"]],
      ["Hof Mustermann", "67347", ["z4"]],
    ]);
    expect(g[0]!.schluessel).toBe(gruppenSchluessel("hof mustermann", "67346"));
    expect(g[0]!.ort).toBe("Speyer");
  });
});

describe("entscheidungAusTreffer", () => {
  it("identisch → Akteur uebernommen, Zeilen bleiben offen", () => {
    expect(entscheidungAusTreffer("k", [{ id: "a1", name: "Hof Mustermann", grad: "identisch" }, { id: "a2", name: "Hof Musterfrau", grad: "stark" }])).toEqual({
      patch: { akteur_gruppe: "k", akteur_id: "a1" },
      ergebnis: "identisch",
      statusOffen: "offen",
    });
  });
  it("stark → Vorschlag wartet auf Bestaetigung (Zeile aehnlich)", () => {
    expect(entscheidungAusTreffer("k", [{ id: "a2", name: "Hof Musterman", grad: "stark" }])).toEqual({
      patch: { akteur_gruppe: "k", akteur_vorschlag_id: "a2", akteur_vorschlag_name: "Hof Musterman", akteur_vorschlag_grad: "stark" },
      ergebnis: "vorschlag",
      statusOffen: "aehnlich",
    });
  });
  it("schwach oder kein Treffer → neuer Akteur", () => {
    expect(entscheidungAusTreffer("k", [{ id: "a3", name: "Hof", grad: "schwach" }]).ergebnis).toBe("neu");
    expect(entscheidungAusTreffer("k", []).patch).toEqual({ akteur_gruppe: "k", akteur_neu: "1" });
  });
});

describe("akteurGruppenAnzeige", () => {
  it("liest den Stand der Gruppe aus der ersten Zeile", () => {
    const anzeige = akteurGruppenAnzeige([
      { id: "a", status: "offen", felder: { akteur_name: "A", akteur_sitz_plz: "1", akteur_id: "x1", akteur_gruppe: "a|1" } },
      { id: "b", status: "aehnlich", felder: { akteur_name: "B", akteur_sitz_plz: "2", akteur_vorschlag_id: "x2", akteur_vorschlag_name: "B GmbH" } },
      { id: "c", status: "offen", felder: { akteur_name: "C", akteur_sitz_plz: "3", akteur_neu: "1" } },
      { id: "d", status: "offen", felder: { akteur_name: "D", akteur_sitz_plz: "4" } },
    ]);
    expect(anzeige.map((g) => [g.name, g.ergebnis, g.akteurId, g.vorschlagName])).toEqual([
      ["A", "identisch", "x1", null],
      ["B", "vorschlag", null, "B GmbH"],
      ["C", "neu", null, null],
      ["D", "offen", null, null],
    ]);
  });
});

describe("offeneAkteurGruppen (fortsetzbar)", () => {
  it("laesst Gruppen aus, deren Zeilen schon eine akteur_gruppe tragen", () => {
    const offen = offeneAkteurGruppen([
      { id: "a", status: "offen", felder: { akteur_name: "A", akteur_sitz_plz: "1", akteur_gruppe: "a|1", akteur_neu: "1" } },
      { id: "b", status: "offen", felder: { akteur_name: "B", akteur_sitz_plz: "2" } },
    ]);
    expect(offen.map((g) => g.name)).toEqual(["B"]);
  });
});

describe("Sektor-Konflikt (PR f, Weggabelung 6)", () => {
  it("verschiedene Sektoren bei einem neuen oder noch offenen Akteur sind ein Konflikt; ein vorhandener Akteur behaelt seinen Sektor", () => {
    const anzeige = akteurGruppenAnzeige([
      { id: "a1", status: "offen", felder: { akteur_name: "Stadtwerke Speyer", akteur_sitz_plz: "67346", akteur_sektor: "energie", akteur_neu: "1" } },
      { id: "a2", status: "offen", felder: { akteur_name: "SW Speyer", akteur_sitz_plz: "67346", akteur_sektor: "kommune", akteur_neu: "1" } },
      { id: "a3", status: "fehler", felder: { akteur_name: "SW Speyer", akteur_sitz_plz: "67346", akteur_sektor: "" } },
      { id: "b1", status: "offen", felder: { akteur_name: "Hof A", akteur_sitz_plz: "1", akteur_sektor: "landwirtschaft", akteur_id: "x1" } },
      { id: "b2", status: "offen", felder: { akteur_name: "Hof A", akteur_sitz_plz: "1", akteur_sektor: "energie", akteur_id: "x1" } },
      { id: "c1", status: "offen", felder: { akteur_name: "Hof C", akteur_sitz_plz: "2", akteur_sektor: "forst", akteur_neu: "1" } },
      { id: "c2", status: "offen", felder: { akteur_name: "Hof C", akteur_sitz_plz: "2", akteur_sektor: "forst", akteur_neu: "1" } },
    ]);
    expect(anzeige.map((g) => [g.name, g.sektoren, g.sektorKonflikt])).toEqual([
      ["Stadtwerke Speyer", ["energie", "kommune"], true],
      ["Hof A", ["landwirtschaft", "energie"], false],
      ["Hof C", ["forst"], false],
    ]);
    expect(sektorKonflikte([]).length).toBe(0);
  });
});
