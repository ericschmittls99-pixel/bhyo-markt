import { describe, expect, it } from "vitest";

import { geaenderteFelder, KONTAKT_GRENZEN, NOTIZ_HINWEIS, pruefeKontaktpersonEingabe } from "./kontaktperson-modell";

describe("Kontaktperson-Eingabe (E66)", () => {
  it("Hinweis am Notizfeld und Grenzen wie die DB-CHECKs", () => {
    expect(NOTIZ_HINWEIS).toBe("Keine privaten oder sensiblen Angaben.");
    expect(KONTAKT_GRENZEN).toEqual({ name: 200, funktion: 120, mailDienstlich: 200, telefon: 60, notiz: 1000 });
  });
  it("Rand wird abgeschnitten, leere Felder werden null", () => {
    expect(pruefeKontaktpersonEingabe({ name: " Petra ", funktion: "", telefon: " 0621 ", mail_dienstlich: "p@x.de" })).toEqual({
      ok: true,
      w: { name: "Petra", funktion: null, mailDienstlich: "p@x.de", telefon: "0621", notiz: null },
    });
  });
  it("geaenderte Felder: nur Namen der Felder", () => {
    const alt = { name: "A", funktion: null, mailDienstlich: null, telefon: null, notiz: null };
    expect(geaenderteFelder(alt, { ...alt, funktion: "x", notiz: "y" })).toEqual(["funktion", "notiz"]);
  });
});
