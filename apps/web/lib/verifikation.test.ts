import { describe, expect, it } from "vitest";

import { fmtDatum } from "./format";
import {
  FAELLIGE_ZUSTAENDE,
  VERIFIKATION_LABEL,
  VERIFIKATION_ZUSTAENDE,
  istVerifikationsZustand,
  verifikationPill,
  verifikationsRang,
} from "./verifikation";

// AP2.4 PR a (E62): die reine Seite des Verifikationsmodells. Die Ableitung
// selbst liegt in strom_verifikation() (Migration 0032) und wird im CI gegen
// die Preview geprueft (packages/db/src/verifikation-check.ts).
describe("Verifikationszustaende (E62)", () => {
  it("die Filterliste nennt jeden Zustand ausser laeuft_bald_ab (PR b) und jeder hat ein Label", () => {
    expect(VERIFIKATION_ZUSTAENDE).toEqual(["ungeprueft", "in_pruefung", "gueltig", "abgelaufen", "als_abgelaufen_markiert", "pruefdatum_unbekannt"]);
    for (const z of VERIFIKATION_ZUSTAENDE) expect(VERIFIKATION_LABEL[z]).toBeTruthy();
    expect(VERIFIKATION_LABEL.laeuft_bald_ab).toBe("läuft bald ab");
    expect(istVerifikationsZustand("gueltig")).toBe(true);
    expect(istVerifikationsZustand("aktiv")).toBe(false);
  });
  it("Pille: gueltig nennt das Datum, die uebrigen den Zustand — keine Ampel", () => {
    expect(verifikationPill({ zustand: "gueltig", verifiziertAm: "2026-09-30T10:00:00Z", verifiziertBis: "2027-03-30" }, fmtDatum)).toEqual({
      text: "gültig bis 30.03.2027.",
      tone: "running",
    });
    expect(verifikationPill({ zustand: "abgelaufen", verifiziertAm: null, verifiziertBis: "2026-01-01" }, fmtDatum).text).toBe("abgelaufen seit 01.01.2026.");
    expect(verifikationPill({ zustand: "als_abgelaufen_markiert", verifiziertAm: null, verifiziertBis: "2027-01-01" }, fmtDatum).text).toBe("abgelaufen.");
    expect(verifikationPill({ zustand: "pruefdatum_unbekannt", verifiziertAm: null, verifiziertBis: null }, fmtDatum).text).toBe("prüfdatum unbekannt.");
    expect(verifikationPill({ zustand: "in_pruefung", verifiziertAm: null, verifiziertBis: null }, fmtDatum).text).toBe("in prüfung.");
    expect(verifikationPill({ zustand: "ungeprueft", verifiziertAm: null, verifiziertBis: null }, fmtDatum).text).toBe("ungeprüft.");
  });
  it("faellig sind abgelaufen und Pruefdatum unbekannt", () => {
    expect(FAELLIGE_ZUSTAENDE).toEqual(["abgelaufen", "pruefdatum_unbekannt"]);
  });
  it("Rang fuer die naechste Verifikation: Abgelaufene zuerst, dann Pruefdatum unbekannt, dann Gueltige nach Datum; ohne Frist kein Rang", () => {
    expect(verifikationsRang({ zustand: "abgelaufen", verifiziertAm: null, verifiziertBis: "2026-01-01" })).toEqual([0, "2026-01-01"]);
    expect(verifikationsRang({ zustand: "pruefdatum_unbekannt", verifiziertAm: null, verifiziertBis: null })).toEqual([1, ""]);
    expect(verifikationsRang({ zustand: "gueltig", verifiziertAm: null, verifiziertBis: "2027-05-01" })).toEqual([2, "2027-05-01"]);
    expect(verifikationsRang({ zustand: "in_pruefung", verifiziertAm: null, verifiziertBis: null })).toBeNull();
    expect(verifikationsRang({ zustand: "ungeprueft", verifiziertAm: null, verifiziertBis: null })).toBeNull();
    expect(verifikationsRang({ zustand: "als_abgelaufen_markiert", verifiziertAm: null, verifiziertBis: null })).toBeNull();
    expect(verifikationsRang(undefined)).toBeNull();
  });
});
