import { describe, expect, it } from "vitest";

import { AKTIONEN, MATRIX, darf, istAktion, nurAdmin, type Aktion } from "./matrix";
import { ROLLEN, type Rolle } from "./rollen";

/**
 * E42: Jede Kombination Rolle × Aktion hat hier einen AUSDRUECKLICHEN
 * Erwartungswert — die Tabelle ist die zweite, unabhaengige Schreibweise der
 * Matrix. Weicht eine Aenderung an MATRIX davon ab, wird es rot, bevor es
 * Production erreicht. Verhalten wie E30: bearbeiter erfasst, admin
 * verwaltet zusaetzlich, betrachter liest nur.
 */
const ERWARTUNG: Record<Aktion, Record<Rolle, boolean>> = {
  "strom.anlegen": { betrachter: false, bearbeiter: true, admin: true },
  "strom.bearbeiten": { betrachter: false, bearbeiter: true, admin: true },
  "strom.status_setzen": { betrachter: false, bearbeiter: true, admin: true },
  "strom.verwerfen": { betrachter: false, bearbeiter: true, admin: true },
  "akteur.anlegen": { betrachter: false, bearbeiter: true, admin: true },
  "materialart.anlegen": { betrachter: false, bearbeiter: true, admin: true },
  "region.anlegen": { betrachter: false, bearbeiter: true, admin: true },
  "projekt.starten": { betrachter: false, bearbeiter: true, admin: true },
  "benutzer.anlegen": { betrachter: false, bearbeiter: false, admin: true },
  "benutzer.rolle_setzen": { betrachter: false, bearbeiter: false, admin: true },
  "benutzer.aktiv_setzen": { betrachter: false, bearbeiter: false, admin: true },
};

describe("E42 Rechte-Matrix", () => {
  it("die Erwartungstabelle deckt jede Aktion und jede Rolle ab", () => {
    expect(Object.keys(ERWARTUNG).sort()).toEqual([...AKTIONEN].sort());
    for (const a of AKTIONEN) expect(Object.keys(ERWARTUNG[a]).sort()).toEqual([...ROLLEN].sort());
  });

  for (const aktion of AKTIONEN) {
    for (const rolle of ROLLEN) {
      it(`${rolle} × ${aktion} = ${ERWARTUNG[aktion][rolle]}`, () => {
        expect(darf({ rolle }, aktion)).toBe(ERWARTUNG[aktion][rolle]);
        expect(darf({ art: "erlaubt", id: "00000000-0000-4000-8000-000000000001", email: "x@bhyo.de", rolle, name: null }, aktion)).toBe(
          ERWARTUNG[aktion][rolle],
        );
      });
    }
  }

  it("Hierarchie: alles, was bearbeiter darf, darf admin auch; betrachter darf nichts davon", () => {
    for (const a of AKTIONEN) {
      if (darf({ rolle: "bearbeiter" }, a)) expect(darf({ rolle: "admin" }, a)).toBe(true);
      expect(darf({ rolle: "betrachter" }, a)).toBe(false);
    }
  });

  it("fail closed: unbekannte Rolle, unbekannte Aktion, kein Nutzer, kein Zugang", () => {
    expect(darf({ rolle: "superuser" }, "strom.anlegen")).toBe(false);
    expect(darf({ rolle: "admin" }, "strom.loeschen")).toBe(false);
    expect(darf({ rolle: "admin" }, "")).toBe(false);
    expect(darf(null, "strom.anlegen")).toBe(false);
    expect(darf(undefined, "strom.anlegen")).toBe(false);
    expect(darf({ art: "unbekannt", email: "x@bhyo.de" }, "strom.anlegen")).toBe(false);
    expect(darf({ art: "deaktiviert", email: "x@bhyo.de" }, "strom.anlegen")).toBe(false);
    expect(darf({ art: "nicht_angemeldet" }, "strom.anlegen")).toBe(false);
    expect(istAktion("strom.loeschen")).toBe(false);
  });

  it("jede Aktion der Matrix erlaubt mindestens eine Rolle, und nurAdmin stimmt mit der Tabelle ueberein", () => {
    for (const a of AKTIONEN) {
      expect(MATRIX[a].length).toBeGreaterThan(0);
      expect(nurAdmin(a)).toBe(ERWARTUNG[a].bearbeiter === false && ERWARTUNG[a].admin === true);
    }
  });
});
