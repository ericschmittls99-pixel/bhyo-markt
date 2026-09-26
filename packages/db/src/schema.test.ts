import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";

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
  biomassestrom,
  outputBedarf,
  vergabeZeitraum,
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
  it("hat den festgelegten Namen und die sieben Belegtypen in DB-Reihenfolge (Anhaenge-Historie, E34-Rang lebt in lib/qualitaet.ts)", () => {
    expect(belegTyp.enumName).toBe("beleg_typ");
    expect(belegTyp.enumValues).toEqual([
      "dokument",
      "gespraech",
      "angebot",
      "absichtserklaerung",
      "vertrag",
      "betriebsdaten",
      "webrecherche",
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

// AP1j: Vergabe-Modell. Die Tests frieren Spaltennamen und Nullability der
// neuen Strukturen ein — der abgeleitete Verfuegbarkeitsstatus haengt daran.
describe("Tabelle vergabe_zeitraum (AP1j)", () => {
  it("traegt beide Elternbezuege nullable und die Vergabefelder", () => {
    expect(getTableName(vergabeZeitraum)).toBe("vergabe_zeitraum");
    expect(vergabeZeitraum.biomassestromId.name).toBe("biomassestrom_id");
    expect(vergabeZeitraum.biomassestromId.notNull).toBe(false);
    expect(vergabeZeitraum.outputBedarfId.name).toBe("output_bedarf_id");
    expect(vergabeZeitraum.outputBedarfId.notNull).toBe(false);
    expect(vergabeZeitraum.vergebenVon.name).toBe("vergeben_von");
    expect(vergabeZeitraum.vergebenVon.notNull).toBe(false);
    expect(vergabeZeitraum.vergebenBis.name).toBe("vergeben_bis");
    expect(vergabeZeitraum.vergebenBis.notNull).toBe(false);
    expect(vergabeZeitraum.vergebenAn.name).toBe("vergeben_an");
    expect(vergabeZeitraum.anBhyo.name).toBe("an_bhyo");
    expect(vergabeZeitraum.anBhyo.notNull).toBe(true);
    expect(vergabeZeitraum.anBhyo.hasDefault).toBe(true);
  });
});

describe("reserviert_bhyo (AP1j)", () => {
  it("existiert auf beiden Stromtabellen als not-null boolean mit Default", () => {
    for (const spalte of [biomassestrom.reserviertBhyo, outputBedarf.reserviertBhyo]) {
      expect(spalte.name).toBe("reserviert_bhyo");
      expect(spalte.notNull).toBe(true);
      expect(spalte.hasDefault).toBe(true);
    }
  });
});

describe("reserviert_seit (AP1j, Migration 0010)", () => {
  it("existiert auf beiden Stromtabellen als nullbares Datum ohne Default", () => {
    // null = nicht reserviert; der Stempel kommt aus der Server-Action beim
    // Setzen der Checkbox, nie aus einem DB-Default (sonst stempelt jede
    // Migration/jeder Insert faelschlich "heute").
    for (const spalte of [biomassestrom.reserviertSeit, outputBedarf.reserviertSeit]) {
      expect(spalte.name).toBe("reserviert_seit");
      expect(spalte.notNull).toBe(false);
      expect(spalte.hasDefault).toBe(false);
    }
  });
});
