/**
 * E23: Ersteller und Beteiligte aus dem Protokoll — mit und ohne Altbestand.
 */
import { describe, expect, it } from "vitest";

import { beteiligteAus, erstellerAus, type ProtokollZeile } from "./ableitung";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const P = "00000000-0000-4000-8000-00000000000c";
const z = (art: ProtokollZeile["art"], benutzerId: string | null, minute: number): ProtokollZeile => ({
  art,
  benutzerId,
  zeitpunkt: new Date(Date.UTC(2026, 8, 29, 10, minute)),
});

describe("erstellerAus", () => {
  it("ist der Urheber des Ereignisses angelegt", () => {
    expect(erstellerAus([z("geaendert", B, 5), z("angelegt", A, 1)])).toEqual({ art: "bekannt", benutzerId: A });
  });
  it("ist benannt unbekannt ohne angelegt-Ereignis — auch bei reinem Altbestand", () => {
    expect(erstellerAus([])).toEqual({ art: "unbekannt" });
    expect(erstellerAus([z("altbestand", A, 1), z("altbestand", null, 2), z("geaendert", B, 3)])).toEqual({ art: "unbekannt" });
  });
});

describe("beteiligteAus", () => {
  it("sammelt Ersteller, weitere Bearbeiter und den Prüfer mit Statuswechsel — jeden einmal, in Reihenfolge", () => {
    const zeilen = [
      z("status_gesetzt", P, 9),
      z("angelegt", A, 1),
      z("geaendert", B, 3),
      z("geaendert", A, 4),
      z("verworfen", B, 12),
    ];
    expect(beteiligteAus(zeilen)).toEqual([A, B, P]);
  });
  it("zählt Sperren und Zuweisen nicht als Beteiligung und lässt Altbestand heraus", () => {
    const zeilen = [z("gesperrt", P, 1), z("zugewiesen", P, 2), z("altbestand", A, 0), z("altbestand", null, 0), z("entsperrt", P, 3)];
    expect(beteiligteAus(zeilen)).toEqual([]);
  });
  it("Altbestand neben neuen Ereignissen: nur die neuen zählen", () => {
    expect(beteiligteAus([z("altbestand", A, 0), z("geaendert", B, 1)])).toEqual([B]);
  });
});
