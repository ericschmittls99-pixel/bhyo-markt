import { describe, expect, it } from "vitest";

import {
  belegTyp,
  bereitschaftStufe,
  datensatzStatus,
  feedstockCluster,
  laufStatus,
  outputArt,
  outputGruppe,
  preisHerkunft,
  qualitaetsStufe,
} from "./schema";

// Postgres-Enum-Werte lassen sich anhaengen, aber nicht umbenennen, entfernen
// oder umsortieren. Diese Tests frieren Name, Werte und Reihenfolge exakt nach
// docs/ap0-schema-entscheidungen.md ein.
describe("Enum datensatz_status", () => {
  it("hat den festgelegten Namen und die vier Zustaende in Reihenfolge", () => {
    expect(datensatzStatus.enumName).toBe("datensatz_status");
    expect(datensatzStatus.enumValues).toEqual([
      "entwurf",
      "in_pruefung",
      "geprueft",
      "verworfen",
    ]);
  });
});

describe("Enum beleg_typ", () => {
  it("hat den festgelegten Namen und die sechs Belegtypen in Reihenfolge", () => {
    expect(belegTyp.enumName).toBe("beleg_typ");
    expect(belegTyp.enumValues).toEqual([
      "dokument_link",
      "gespraech",
      "angebot",
      "absichtserklaerung",
      "vertrag",
      "betriebsdaten",
    ]);
  });
});

describe("Enum bereitschaft_stufe", () => {
  it("hat den festgelegten Namen und die vier Stufen in Reihenfolge", () => {
    expect(bereitschaftStufe.enumName).toBe("bereitschaft_stufe");
    expect(bereitschaftStufe.enumValues).toEqual([
      "kein_kontakt",
      "erstgespraech",
      "positives_signal",
      "absichtserklaerung",
    ]);
  });
});

describe("Enum qualitaets_stufe", () => {
  it("hat den festgelegten Namen und die vier Stufen A-D in Reihenfolge", () => {
    expect(qualitaetsStufe.enumName).toBe("qualitaets_stufe");
    expect(qualitaetsStufe.enumValues).toEqual(["A", "B", "C", "D"]);
  });
});

describe("Enum preis_herkunft", () => {
  it("hat den festgelegten Namen und die drei Herkuenfte in Reihenfolge", () => {
    expect(preisHerkunft.enumName).toBe("preis_herkunft");
    expect(preisHerkunft.enumValues).toEqual([
      "eigene_datenbank",
      "marktdaten",
      "schaetzung",
    ]);
  });
});

describe("Enum output_gruppe", () => {
  it("hat den festgelegten Namen und die vier Gruppen in Reihenfolge", () => {
    expect(outputGruppe.enumName).toBe("output_gruppe");
    expect(outputGruppe.enumValues).toEqual([
      "primaerprodukte",
      "wasserstoff",
      "derivate",
      "add_ons",
    ]);
  });
});

describe("Enum output_art", () => {
  it("hat den festgelegten Namen und die zwei Arten in Reihenfolge", () => {
    expect(outputArt.enumName).toBe("output_art");
    expect(outputArt.enumValues).toEqual(["target", "add_on"]);
  });
});

describe("Enum lauf_status", () => {
  it("hat den festgelegten Namen und die zwei Zustaende in Reihenfolge", () => {
    expect(laufStatus.enumName).toBe("lauf_status");
    expect(laufStatus.enumValues).toEqual(["arbeitsfassung", "eingefroren"]);
  });
});

describe("Enum feedstock_cluster", () => {
  it("hat den festgelegten Namen und die fuenf Cluster in Reihenfolge", () => {
    expect(feedstockCluster.enumName).toBe("feedstock_cluster");
    expect(feedstockCluster.enumValues).toEqual([
      "organische_rest_abfallstoffe",
      "lignozellulosische_reststoffe",
      "nachwachsende_rohstoffe",
      "lipide_spezialfeedstocks",
      "polymere_synthetische_c_quellen",
    ]);
  });
});
