import { describe, expect, it } from "vitest";

import { INBOX_TYPEN, typFuerArt } from "./register";

describe("Inbox-Register", () => {
  it("aenderung_eintrag entsteht aus geaendert, status_gesetzt, verworfen — sonst nichts", () => {
    expect(typFuerArt("geaendert")).toBe("aenderung_eintrag");
    expect(typFuerArt("status_gesetzt")).toBe("aenderung_eintrag");
    expect(typFuerArt("verworfen")).toBe("aenderung_eintrag");
    for (const art of ["angelegt", "gesperrt", "entsperrt", "zugewiesen", "zuweisung_entfernt", "benutzer_angelegt", "altbestand"] as const) {
      expect(typFuerArt(art)).toBeNull();
    }
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
