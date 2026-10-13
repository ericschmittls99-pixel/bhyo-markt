import { describe, expect, it } from "vitest";

import { zielFuerZeile } from "./ziel";

const leer = { typ: "aenderung_eintrag" as const, strom: null, akteur: null, kontaktperson: null, importLauf: null, kommentar: null };

describe("E77 R5: zielFuerZeile", () => {
  it("Strom: Detail in inbox. mit Sicht, bestehende Parameter bleiben, Kommentar als Anker", () => {
    expect(zielFuerZeile({ ...leer, strom: { art: "biomasse", id: "s1" } }, new URLSearchParams("zustand=erledigt"))).toBe(
      "/inbox?zustand=erledigt&detail=s1&sicht=feedstock",
    );
    expect(zielFuerZeile({ ...leer, typ: "kommentar", strom: { art: "output", id: "o1" }, kommentar: { id: "k1" } })).toBe(
      "/inbox?detail=o1&sicht=outputs#kommentar-k1",
    );
  });
  it("Kontaktperson, Akteur, Import, Mail-Hinweise, sonst inbox.", () => {
    expect(zielFuerZeile({ ...leer, kontaktperson: { id: "p", name: "P", akteurId: "a9" } })).toBe("/akteure?akteur=a9&reiter=kontaktpersonen");
    expect(zielFuerZeile({ ...leer, typ: "erwaehnung", akteur: { id: "a1", name: "A" }, kommentar: { id: "k2" } })).toBe("/akteure?akteur=a1#kommentar-k2");
    expect(zielFuerZeile({ ...leer, importLauf: { id: "i1", dateiname: "x.xlsx" } })).toBe("/import/i1");
    expect(zielFuerZeile({ ...leer, typ: "mail_stoerung" })).toBe("/einstellungen#roundup");
    expect(zielFuerZeile(leer)).toBe("/inbox");
  });
});
