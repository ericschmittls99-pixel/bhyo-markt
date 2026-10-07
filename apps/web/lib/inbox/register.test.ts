import { describe, expect, it } from "vitest";

import { zeilenText } from "./register";

import { INBOX_TYPEN, typenFuerArt, typFuerArt } from "./register";

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
  // AP2.4 PR a (E62)
  it("in_pruefung_gegeben und zurueckgesetzt → pruefauftrag VOR aenderung_eintrag; geprueft → pruefung_erledigt vor aenderung_eintrag", () => {
    expect(typenFuerArt("in_pruefung_gegeben")).toEqual(["pruefauftrag", "aenderung_eintrag"]);
    expect(typenFuerArt("zurueckgesetzt")).toEqual(["pruefauftrag", "aenderung_eintrag"]);
    expect(typenFuerArt("geprueft")).toEqual(["pruefung_erledigt", "aenderung_eintrag"]);
    expect(typenFuerArt("zurueckgegeben")).toEqual(["aenderung_eintrag"]);
    expect(typenFuerArt("reaktiviert")).toEqual(["aenderung_eintrag"]);
    expect(typenFuerArt("als_abgelaufen_markiert")).toEqual([]);
    expect(typFuerArt("in_pruefung_gegeben")).toBe("pruefauftrag");
    expect(INBOX_TYPEN.pruefauftrag.reinerHinweis).toBe(false);
    expect(INBOX_TYPEN.pruefauftrag.aktionen).not.toContain("inbox.alle_erledigen");
    expect(INBOX_TYPEN.pruefung_erledigt.reinerHinweis).toBe(true);
    const z = { ausloeserName: "Bernd Bearbeiter", belegNr: "B-000012", bezeichnung: "Stroh", anzahl: 1 };
    expect(INBOX_TYPEN.pruefauftrag.text(z)).toBe("Bernd Bearbeiter bittet um Prüfung von B-000012 Stroh");
    expect(INBOX_TYPEN.pruefauftrag.text({ ...z, anzahl: 2 })).toBe("Bernd Bearbeiter bittet um Prüfung von B-000012 Stroh (2. Mal)");
    expect(INBOX_TYPEN.pruefung_erledigt.text({ ...z, ausloeserName: "Petra Prüfer" })).toBe("Petra Prüfer hat B-000012 Stroh geprüft");
  });
  it("Alle erledigt gilt fuer reine Hinweise", () => {
    expect(INBOX_TYPEN.aenderung_eintrag.reinerHinweis).toBe(true);
    expect(INBOX_TYPEN.aenderung_eintrag.aktionen).toContain("inbox.alle_erledigen");
  });
});

// AP2.4 PR c (E63, D5)
describe("Register — Aufgabe (PR c)", () => {
  it("weitergegeben → aufgabe (nur dieser Typ), Aufgabe ist Aufgabe (nicht in Alle erledigt), Text nennt die Aufgabe", () => {
    expect(typenFuerArt("weitergegeben")).toEqual(["aufgabe"]);
    expect(INBOX_TYPEN.aufgabe.reinerHinweis).toBe(false);
    expect(INBOX_TYPEN.aufgabe.aktionen).not.toContain("inbox.alle_erledigen");
    expect(INBOX_TYPEN.aufgabe.text({ ausloeserName: "Petra Prüfer", belegNr: "B-000012", bezeichnung: "Stroh", anzahl: 1, aufgabe: "Bitte aktualisieren" })).toBe(
      "Petra Prüfer bittet dich zu B-000012 Stroh: „Bitte aktualisieren\"",
    );
    for (const t of ["pruefauftrag", "verifikation_laeuft_ab", "verifikation_abgelaufen"] as const) expect(INBOX_TYPEN[t].aktionen).toContain("inbox.weitergeben");
    expect(INBOX_TYPEN.aufgabe.aktionen).not.toContain("inbox.weitergeben");
  });
});

describe("zeilenText: unbekannter Typ eines spaeteren Stands", () => {
  it("liefert einen benannten Platzhalter statt zu werfen", () => {
    const z = { ausloeserName: "", belegNr: null, bezeichnung: "Strom A", anzahl: 1 };
    expect(zeilenText("typ_aus_der_zukunft", z)).toBe("Hinweis eines neueren Stands (typ_aus_der_zukunft) — Strom A");
    expect(zeilenText("freischaltung", { ...z, ausloeserName: "Eric" })).toMatch(/^Eric hat dir Zugriff/);
  });
});

describe("Register — Kommentare (AP2.6 PR c, E71)", () => {
  it("kommentar_erstellt → erwaehnung VOR kommentar; kommentar_bearbeitet → nur erwaehnung; kommentar_geloescht → nichts", () => {
    expect(typenFuerArt("kommentar_erstellt")).toEqual(["erwaehnung", "kommentar"]);
    expect(typenFuerArt("kommentar_bearbeitet")).toEqual(["erwaehnung"]);
    expect(typenFuerArt("kommentar_geloescht")).toEqual([]);
  });
  it("Zeilentexte nennen Ausloeser und Objekt; beide sind reine Hinweise ohne Buendelung", () => {
    const z = { ausloeserName: "Bernd", belegNr: "B-000012", bezeichnung: "Papierschlamm", anzahl: 1 };
    expect(INBOX_TYPEN.kommentar.text(z)).toBe("Bernd hat B-000012 Papierschlamm kommentiert");
    expect(INBOX_TYPEN.erwaehnung.text(z)).toBe("Bernd hat dich in einem Kommentar zu B-000012 Papierschlamm erwähnt");
    expect(INBOX_TYPEN.kommentar.reinerHinweis).toBe(true);
    expect(INBOX_TYPEN.erwaehnung.reinerHinweis).toBe(true);
    expect(INBOX_TYPEN.kommentar.buendelung).toMatch(/keine/);
  });
});

