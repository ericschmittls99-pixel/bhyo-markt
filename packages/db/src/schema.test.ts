import { describe, expect, it } from "vitest";

import { belegTyp, bereitschaftStufe, datensatzStatus } from "./schema";

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
  it("hat den festgelegten Namen und die fuenf Belegtypen in Reihenfolge", () => {
    expect(belegTyp.enumName).toBe("beleg_typ");
    expect(belegTyp.enumValues).toEqual([
      "dokument_link",
      "gespraech",
      "angebot",
      "absichtserklaerung",
      "vertrag",
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
