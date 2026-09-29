import { describe, expect, it } from "vitest";

import { INBOX_TYPEN, typFuerArt } from "./register";

describe("Inbox-Register", () => {
  it("aenderung_eintrag entsteht aus geaendert, status_gesetzt, verworfen — sonst nichts", () => {
    expect(typFuerArt("geaendert")).toBe("aenderung_eintrag");
    expect(typFuerArt("status_gesetzt")).toBe("aenderung_eintrag");
    expect(typFuerArt("verworfen")).toBe("aenderung_eintrag");
    for (const art of ["angelegt", "gesperrt", "entsperrt", "zuweisung_entfernt", "benutzer_angelegt", "altbestand"] as const) {
      expect(typFuerArt(art)).toBeNull();
    }
  });
  it("PR c: zugriff_angefragt → zugriffsanfrage, zugewiesen → freischaltung, zugriff_abgelehnt → zugriff_abgelehnt", () => {
    expect(typFuerArt("zugriff_angefragt")).toBe("zugriffsanfrage");
    expect(typFuerArt("zugewiesen")).toBe("freischaltung");
    expect(typFuerArt("zugriff_abgelehnt")).toBe("zugriff_abgelehnt");
    expect(INBOX_TYPEN.zugriffsanfrage.reinerHinweis).toBe(false);
    expect(INBOX_TYPEN.zugriffsanfrage.aktionen).toEqual(["inbox.gelesen", "inbox.ungelesen", "strom.zuweisen", "inbox.ablehnen"]);
    expect(INBOX_TYPEN.freischaltung.reinerHinweis).toBe(true);
    expect(INBOX_TYPEN.zugriff_abgelehnt.reinerHinweis).toBe(true);
    const z = { ausloeserName: "Bernd Bearbeiter", belegNr: "B-000012", bezeichnung: "Stroh", anzahl: 1 };
    expect(INBOX_TYPEN.zugriffsanfrage.text(z)).toBe("Bernd Bearbeiter bittet um Zugriff auf B-000012 Stroh");
    expect(INBOX_TYPEN.zugriffsanfrage.text({ ...z, anzahl: 2 })).toBe("Bernd Bearbeiter bittet um Zugriff auf B-000012 Stroh (2. Anfrage)");
    expect(INBOX_TYPEN.freischaltung.text({ ...z, ausloeserName: "Petra Prüfer" })).toBe("Petra Prüfer hat dir Zugriff auf B-000012 Stroh gegeben");
    expect(INBOX_TYPEN.zugriff_abgelehnt.text({ ...z, ausloeserName: "Petra Prüfer" })).toBe("Petra Prüfer hat deine Zugriffsanfrage zu B-000012 Stroh abgelehnt");
  });
  it("Zeilentext: Name, Belegnummer, Bezeichnung, Zusatz bei Buendelung", () => {
    const text = INBOX_TYPEN.aenderung_eintrag.text;
    expect(text({ ausloeserName: "Bernd Bearbeiter", belegNr: "B-000012", bezeichnung: "Stroh Hof Müller", anzahl: 1 })).toBe(
      "Bernd Bearbeiter hat B-000012 Stroh Hof Müller geändert",
    );
    expect(text({ ausloeserName: "Petra Prüfer", belegNr: null, bezeichnung: "Stroh", anzahl: 3 })).toBe(
      "Petra Prüfer hat Stroh geändert (3 Änderungen)",
    );
    expect(text({ ausloeserName: "Petra Prüfer", belegNr: null, bezeichnung: null, anzahl: 1 })).toBe(
      "Petra Prüfer hat einen Eintrag geändert",
    );
  });
  it("Alle erledigt gilt fuer reine Hinweise", () => {
    expect(INBOX_TYPEN.aenderung_eintrag.reinerHinweis).toBe(true);
    expect(INBOX_TYPEN.aenderung_eintrag.aktionen).toContain("inbox.alle_erledigen");
  });
});
