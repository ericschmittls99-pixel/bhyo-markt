import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pruefeJournal, type JournalEintrag } from "./journal-wache";

const journalPfad = new URL("../migrations/meta/_journal.json", import.meta.url);
const journal = JSON.parse(readFileSync(journalPfad, "utf8")) as { entries: JournalEintrag[] };
const dateien = readdirSync(new URL("../migrations/", import.meta.url)).filter((d) => d.endsWith(".sql"));

describe("Journal-Waechter (Eric 08.10.2026): idx lueckenlos, when strikt steigend, Datei je Eintrag", () => {
  it("das echte Journal ist in Ordnung", () => {
    expect(journal.entries.length).toBeGreaterThan(50);
    expect(pruefeJournal(journal.entries, dateien)).toEqual([]);
  });

  it("Rot: zwei vertauschte when (umnummerierte Migration mit altem Zeitstempel) werden gemeldet", () => {
    const kopie = journal.entries.map((e) => ({ ...e }));
    const n = kopie.length;
    const letztes = kopie[n - 1]!.when;
    kopie[n - 1]!.when = kopie[n - 2]!.when;
    kopie[n - 2]!.when = letztes;
    const fehler = pruefeJournal(kopie, dateien);
    expect(fehler).toHaveLength(1);
    expect(fehler[0]).toMatch(/^Eintrag \d+ \(.*\): when \d+ ist nicht groesser als \d+ .* der Migrator wuerde sie ueberspringen$/);
  });

  it("Rot: Luecke in idx, falscher tag-Praefix, gleiches when, fehlende Datei und Datei ohne Eintrag", () => {
    const e = (idx: number, when: number, tag: string) => ({ idx, when, tag });
    expect(pruefeJournal([e(0, 1, "0000_a"), e(2, 2, "0002_b")], ["0000_a.sql", "0002_b.sql"])).toEqual(["Eintrag 1: idx 2 statt 1 (Luecke oder Reihenfolge)"]);
    expect(pruefeJournal([e(0, 1, "0000_a"), e(1, 2, "0002_b")], ["0000_a.sql", "0002_b.sql"])).toEqual(["Eintrag 1: tag „0002_b\" beginnt nicht mit 0001_"]);
    expect(pruefeJournal([e(0, 5, "0000_a"), e(1, 5, "0001_b")], ["0000_a.sql", "0001_b.sql"])).toEqual([
      "Eintrag 1 (0001_b): when 5 ist nicht groesser als 5 (0000_a) — der Migrator wuerde sie ueberspringen",
    ]);
    expect(pruefeJournal([e(0, 1, "0000_a")], [])).toEqual(["Eintrag 0: Datei 0000_a.sql fehlt"]);
    expect(pruefeJournal([e(0, 1, "0000_a")], ["0000_a.sql", "0001_x.sql"])).toEqual(["Datei 0001_x.sql steht nicht im Journal"]);
  });
});
