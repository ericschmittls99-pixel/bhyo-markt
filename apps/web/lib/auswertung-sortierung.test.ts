import { describe, expect, it } from "vitest";

import { leseSortierung, sortiereZeilen } from "./auswertung-sortierung";

const zeilen = [
  { label: "Organische Rest- und Abfallstoffe", pct: 49 },
  { label: "Lignozellulosische Reststoffe", pct: 46 },
  { label: "Nachwachsende Rohstoffe", pct: 5 },
  { label: "Ähren (Sonderfall Umlaut)", pct: 5 },
];

describe("E39 Sortierung der Akkordeon-Einträge", () => {
  it("unbekannter Parameter fällt auf den Standard zurück", () => {
    expect(leseSortierung(undefined)).toBe("menge_ab");
    expect(leseSortierung("quatsch")).toBe("menge_ab");
    expect(leseSortierung("name")).toBe("name");
  });
  it("menge_ab lässt die Modellreihenfolge unverändert (Logik bleibt)", () => {
    expect(sortiereZeilen(zeilen, "menge_ab")).toBe(zeilen);
  });
  it("menge_auf: kleinster Anteil zuerst, Gleichstand nach Name", () => {
    expect(sortiereZeilen(zeilen, "menge_auf").map((z) => z.label)).toEqual([
      "Ähren (Sonderfall Umlaut)",
      "Nachwachsende Rohstoffe",
      "Lignozellulosische Reststoffe",
      "Organische Rest- und Abfallstoffe",
    ]);
  });
  it("name: A–Z nach deutscher Sortierung, Umlaute eingereiht", () => {
    expect(sortiereZeilen(zeilen, "name").map((z) => z.label[0])).toEqual(["Ä", "L", "N", "O"]);
  });
});
