import { describe, expect, it } from "vitest";

import { vergleicheJournal, zaehlerPasst } from "./journal-vergleich";

const head = [
  { when: 100, tag: "0001_a" },
  { when: 200, tag: "0002_b" },
];
const PREVIEW = "ep-rough-term-b29rvd6c.c-6.eu-central-1.aws.neon.tech";
const PROD = "ep-purple-glade-b2tra1g7.c-6.eu-central-1.aws.neon.tech";

// Entscheidung Eric 01.10.2026: exakt bei gleichem Journal, Mindestvergleich nur wenn die DB
// nachweislich voraus ist, rot bei Rueckstand oder anderer Abweichung; Production immer exakt.
describe("Journal-Vergleich der DB-Checks", () => {
  it("gleiches Journal → exakt", () => {
    expect(vergleicheJournal(head, [100, 200], PREVIEW).modus).toBe("exakt");
  });
  it("DB traegt spaetere Migrationen → Mindestvergleich mit Nennung", () => {
    const v = vergleicheJournal(head, [100, 200, 300], PREVIEW);
    expect(v.modus).toBe("mindest");
    if (v.modus === "mindest") expect(v.voraus).toEqual([300]);
  });
  it("DB hinter dem Head → rot mit fehlender Migration", () => {
    const v = vergleicheJournal(head, [100], PREVIEW);
    expect(v.modus).toBe("rot");
    if (v.modus === "rot") expect(v.fehlend).toEqual(["0002_b"]);
  });
  it("DB mit unbekannter Migration VOR dem Head-Stand → rot (andere Abweichung)", () => {
    expect(vergleicheJournal(head, [100, 150, 200], PREVIEW).modus).toBe("rot");
  });
  it("Production: auch bei vorauslaufender DB kein Mindestvergleich", () => {
    expect(vergleicheJournal(head, [100, 200, 300], PROD).modus).toBe("rot");
    expect(vergleicheJournal(head, [100, 200], PROD).modus).toBe("exakt");
  });
  it("Zaehler: exakt verlangt Gleichheit, mindest verlangt ist >= soll", () => {
    expect(zaehlerPasst("typen", 11, 10, "exakt")).toBe("typen: 11 statt 10");
    expect(zaehlerPasst("typen", 11, 10, "mindest")).toBeNull();
    expect(zaehlerPasst("typen", 9, 10, "mindest")).toBe("typen: 9 < 10 (Mindestvergleich)");
    expect(zaehlerPasst("typen", 10, 10, "exakt")).toBeNull();
  });
});
