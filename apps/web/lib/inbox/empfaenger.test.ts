/**
 * Empfaengerregel „Aenderung an meinem Eintrag" (Entscheidung Eric, AP2.2):
 * Ersteller, weitere Bearbeiter, Pruefer mit Statuswechsel — ausgenommen der
 * Ausloeser, Deaktivierte und Betrachter. Die Beteiligung selbst kommt aus
 * beteiligteAus (Protokoll); hier die Filterung gegen die Benutzer.
 */
import { describe, expect, it } from "vitest";

import { beteiligteAus, type ProtokollZeile } from "@/lib/protokoll/ableitung";

import { filtereEmpfaenger } from "./empfaenger";

const ERSTELLER = "00000000-0000-4000-8000-000000000001";
const BEARBEITER = "00000000-0000-4000-8000-000000000002";
const PRUEFER = "00000000-0000-4000-8000-000000000003";
const BETRACHTER = "00000000-0000-4000-8000-000000000004";
const INAKTIV = "00000000-0000-4000-8000-000000000005";
const SPERRER = "00000000-0000-4000-8000-000000000006";

const z = (art: ProtokollZeile["art"], benutzerId: string, minute: number): ProtokollZeile => ({
  art,
  benutzerId,
  zeitpunkt: new Date(Date.UTC(2026, 8, 29, 12, minute)),
});
const BENUTZER = [
  { id: ERSTELLER, rolle: "bearbeiter", aktiv: true },
  { id: BEARBEITER, rolle: "bearbeiter", aktiv: true },
  { id: PRUEFER, rolle: "pruefer", aktiv: true },
  { id: BETRACHTER, rolle: "betrachter", aktiv: true },
  { id: INAKTIV, rolle: "bearbeiter", aktiv: false },
  { id: SPERRER, rolle: "pruefer", aktiv: true },
];
const PROTOKOLL = [
  z("angelegt", ERSTELLER, 1),
  z("geaendert", BEARBEITER, 2),
  z("status_gesetzt", PRUEFER, 3),
  z("geaendert", BETRACHTER, 4), // frueher Bearbeiter, heute Betrachter
  z("geaendert", INAKTIV, 5),
  z("gesperrt", SPERRER, 6),
  z("zugewiesen", SPERRER, 7),
];

describe("filtereEmpfaenger", () => {
  it("Ersteller, weitere Bearbeiter und Pruefer mit Statuswechsel bekommen den Eintrag", () => {
    const beteiligte = beteiligteAus(PROTOKOLL);
    expect(filtereEmpfaenger(beteiligte, BENUTZER, SPERRER)).toEqual([ERSTELLER, BEARBEITER, PRUEFER]);
  });
  it("der Ausloeser selbst ist ausgenommen", () => {
    expect(filtereEmpfaenger(beteiligteAus(PROTOKOLL), BENUTZER, BEARBEITER)).toEqual([ERSTELLER, PRUEFER]);
  });
  it("Deaktivierte und Betrachter sind ausgenommen, Unbekannte ebenso", () => {
    const beteiligte = [ERSTELLER, BETRACHTER, INAKTIV, "00000000-0000-4000-8000-000000000099"];
    expect(filtereEmpfaenger(beteiligte, BENUTZER, PRUEFER)).toEqual([ERSTELLER]);
  });
  it("Sperren und Zuweisen zaehlen nicht als Beteiligung", () => {
    const nurSperre = [z("gesperrt", SPERRER, 1), z("zugewiesen", SPERRER, 2)];
    expect(filtereEmpfaenger(beteiligteAus(nurSperre), BENUTZER, ERSTELLER)).toEqual([]);
  });
});
