import { describe, expect, it } from "vitest";

import { protokollName, vergleicheMitProtokoll, type Zaehlprotokoll } from "./zaehlprotokoll";

const protokoll: Zaehlprotokoll = {
  erstellt: "2026-09-28T02:00:00Z",
  dump: "bhyogenics-2026-09-28.dump",
  snapshot: "00000003-0000001B-1",
  migrationen: 24,
  tabellen: { beleg: 1, biomassestrom: 1, materialart: 46 },
};

describe("Zaehlprotokoll", () => {
  it("gleiche Zahlen: kein Fehler", () => {
    const v = vergleicheMitProtokoll(protokoll, { migrationen: 24, tabellen: { beleg: 1, biomassestrom: 1, materialart: 46 } });
    expect(v.fehler).toEqual([]);
    expect(v.zeilen).toHaveLength(3);
  });
  it("eine verfaelschte Zeile ist rot — und nennt Tabelle, Protokoll und Restore", () => {
    const v = vergleicheMitProtokoll({ ...protokoll, tabellen: { ...protokoll.tabellen, beleg: 2 } }, { migrationen: 24, tabellen: { beleg: 1, biomassestrom: 1, materialart: 46 } });
    expect(v.fehler).toEqual(["beleg: Protokoll 2, Restore 1"]);
  });
  it("fehlende Tabelle und abweichender Migrationsstand sind rot", () => {
    const v = vergleicheMitProtokoll(protokoll, { migrationen: 23, tabellen: { beleg: 1, materialart: 46 } });
    expect(v.fehler).toEqual(["Tabelle fehlt im Restore: biomassestrom", "Migrationsstand: Protokoll 24, Restore 23"]);
  });
  it("Protokollname steht neben dem Dump", () => {
    expect(protokollName("bhyogenics-2026-09-28.dump")).toBe("bhyogenics-2026-09-28.zaehlung.json");
  });
});
