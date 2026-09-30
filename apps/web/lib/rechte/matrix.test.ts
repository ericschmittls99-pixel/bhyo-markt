import { describe, expect, it } from "vitest";

import {
  AKTIONEN,
  MATRIX,
  brauchtObjekt,
  darf,
  darfZugewiesenWerden,
  istAktion,
  nurAdmin,
  type Aktion,
  type Objekt,
  type StromSperre,
} from "./matrix";
import { ROLLEN, type Rolle } from "./rollen";

/**
 * E42: Jede Kombination Rolle × Aktion hat hier einen AUSDRUECKLICHEN
 * Erwartungswert (Rollenstufe) — die Tabelle ist die zweite, unabhaengige
 * Schreibweise der Matrix. E44: die objektbezogenen Regeln (Sperre) werden
 * darunter je Schreibpfad als Matrix Rolle × gesperrt × Verhaeltnis geprueft.
 */
const ERWARTUNG: Record<Aktion, Record<Rolle, boolean>> = {
  "strom.anlegen": { betrachter: false, bearbeiter: true, pruefer: true, admin: true },
  "strom.bearbeiten": { betrachter: false, bearbeiter: true, pruefer: true, admin: true },
  "strom.status_setzen": { betrachter: false, bearbeiter: true, pruefer: true, admin: true },
  "strom.verwerfen": { betrachter: false, bearbeiter: true, pruefer: true, admin: true },
  "strom.sperren": { betrachter: false, bearbeiter: false, pruefer: true, admin: true },
  "strom.entsperren": { betrachter: false, bearbeiter: false, pruefer: true, admin: true },
  "strom.zuweisen": { betrachter: false, bearbeiter: false, pruefer: true, admin: true },
  "strom.zuweisung_entfernen": { betrachter: false, bearbeiter: false, pruefer: true, admin: true },
  // PR c: Zugriff anfragen — Rolle >= bearbeiter, Objektregel gesperrt/fremd.
  "strom.zugriff_anfragen": { betrachter: false, bearbeiter: true, pruefer: true, admin: true },
  "akteur.anlegen": { betrachter: false, bearbeiter: true, pruefer: true, admin: true },
  "region.anlegen": { betrachter: false, bearbeiter: true, pruefer: true, admin: true },
  "projekt.starten": { betrachter: false, bearbeiter: true, pruefer: true, admin: true },
  "benutzer.anlegen": { betrachter: false, bearbeiter: false, pruefer: false, admin: true },
  "benutzer.rolle_setzen": { betrachter: false, bearbeiter: false, pruefer: false, admin: true },
  "benutzer.aktiv_setzen": { betrachter: false, bearbeiter: false, pruefer: false, admin: true },
  // AP2.2: die Inbox gehoert der Person — jede Rolle, Objektregel „nur Empfaenger".
  "inbox.gelesen": { betrachter: true, bearbeiter: true, pruefer: true, admin: true },
  "inbox.ungelesen": { betrachter: true, bearbeiter: true, pruefer: true, admin: true },
  "inbox.erledigen": { betrachter: true, bearbeiter: true, pruefer: true, admin: true },
  "inbox.verwerfen": { betrachter: true, bearbeiter: true, pruefer: true, admin: true },
  "inbox.alle_erledigen": { betrachter: true, bearbeiter: true, pruefer: true, admin: true },
  "inbox.ablehnen": { betrachter: true, bearbeiter: true, pruefer: true, admin: true },
  // AP2.3: Parameter nur admin.
  "parameter.setzen": { betrachter: false, bearbeiter: false, pruefer: false, admin: true },
  "parameter.zuruecknehmen": { betrachter: false, bearbeiter: false, pruefer: false, admin: true },
};

const ICH = "00000000-0000-4000-8000-000000000001";
const ANDERE = "00000000-0000-4000-8000-000000000002";
const DRITTE = "00000000-0000-4000-8000-000000000003";
const FREI: StromSperre = { gesperrtVon: null, zugewiesene: [] };
/** Objekt, an dem die Rollenstufe allein entscheidet: frei bzw. von mir gesperrt. */
const passendesObjekt = (aktion: Aktion): Objekt | undefined => {
  if (!brauchtObjekt(aktion)) return undefined;
  // AP2.2: Inbox-Regeln entscheiden am eigenen Eintrag.
  if (aktion.startsWith("inbox.")) return { empfaengerId: ICH };
  // PR c: anfragen kann nur, wer am gesperrten Strom fremd ist.
  if (aktion === "strom.zugriff_anfragen") return { gesperrtVon: ANDERE, zugewiesene: [DRITTE] };
  return aktion === "strom.entsperren" || aktion === "strom.zuweisen" || aktion === "strom.zuweisung_entfernen"
    ? { gesperrtVon: ICH, zugewiesene: [] }
    : FREI;
};

describe("E42 Rechte-Matrix (Rollenstufe)", () => {
  it("die Erwartungstabelle deckt jede Aktion und jede Rolle ab", () => {
    expect(Object.keys(ERWARTUNG).sort()).toEqual([...AKTIONEN].sort());
    for (const a of AKTIONEN) expect(Object.keys(ERWARTUNG[a]).sort()).toEqual([...ROLLEN].sort());
  });

  for (const aktion of AKTIONEN) {
    for (const rolle of ROLLEN) {
      it(`${rolle} × ${aktion} = ${ERWARTUNG[aktion][rolle]}`, () => {
        const objekt = passendesObjekt(aktion);
        expect(darf({ rolle, id: ICH }, aktion, objekt)).toBe(ERWARTUNG[aktion][rolle]);
        expect(darf({ art: "erlaubt", id: ICH, email: "x@bhyo.de", rolle, name: null }, aktion, objekt)).toBe(
          ERWARTUNG[aktion][rolle],
        );
      });
    }
  }

  it("Hierarchie admin ⊇ pruefer ⊇ bearbeiter ⊇ betrachter", () => {
    for (const a of AKTIONEN) {
      const o = passendesObjekt(a);
      if (darf({ rolle: "bearbeiter", id: ICH }, a, o)) expect(darf({ rolle: "pruefer", id: ICH }, a, o)).toBe(true);
      if (darf({ rolle: "pruefer", id: ICH }, a, o)) expect(darf({ rolle: "admin", id: ICH }, a, o)).toBe(true);
      // Betrachter schreiben nichts Fachliches — ihre eigene Inbox duerfen sie bedienen (AP2.2).
      expect(darf({ rolle: "betrachter", id: ICH }, a, o)).toBe(a.startsWith("inbox."));
    }
  });

  it("fail closed: unbekannte Rolle, unbekannte Aktion, kein Nutzer, kein Zugang, Objektregel ohne Objekt", () => {
    expect(darf({ rolle: "superuser" }, "strom.anlegen")).toBe(false);
    expect(darf({ rolle: "admin" }, "strom.loeschen")).toBe(false);
    expect(darf({ rolle: "admin" }, "")).toBe(false);
    expect(darf(null, "strom.anlegen")).toBe(false);
    expect(darf(undefined, "strom.anlegen")).toBe(false);
    expect(darf({ art: "unbekannt", email: "x@bhyo.de" }, "strom.anlegen")).toBe(false);
    expect(darf({ art: "deaktiviert", email: "x@bhyo.de" }, "strom.anlegen")).toBe(false);
    expect(darf({ art: "nicht_angemeldet" }, "strom.anlegen")).toBe(false);
    expect(istAktion("strom.loeschen")).toBe(false);
    // E44: Wer die Sperre nicht mitgibt, bekommt kein Ja.
    for (const a of AKTIONEN) if (brauchtObjekt(a)) expect(darf({ rolle: "admin", id: ICH }, a)).toBe(false);
  });

  it("jede Aktion der Matrix erlaubt mindestens eine Rolle, und nurAdmin stimmt mit der Tabelle ueberein", () => {
    for (const a of AKTIONEN) {
      expect(MATRIX[a].length).toBeGreaterThan(0);
      expect(nurAdmin(a)).toBe(ERWARTUNG[a].bearbeiter === false && ERWARTUNG[a].pruefer === false && ERWARTUNG[a].admin === true);
    }
  });
});

// --- E44: Sperre je Schreibpfad ---------------------------------------------
type Verhaeltnis = "inhaber" | "zugewiesen" | "fremd";
const objektFuer = (gesperrt: boolean, v: Verhaeltnis): StromSperre =>
  !gesperrt
    ? FREI
    : v === "inhaber"
      ? { gesperrtVon: ICH, zugewiesene: [DRITTE] }
      : v === "zugewiesen"
        ? { gesperrtVon: ANDERE, zugewiesene: [ICH, DRITTE] }
        : { gesperrtVon: ANDERE, zugewiesene: [DRITTE] };

/** Erwartung je Schreibpfad: Rolle × gesperrt × Verhaeltnis. */
const SCHREIBPFADE: Aktion[] = ["strom.bearbeiten", "strom.status_setzen", "strom.verwerfen"];
const AENDERN_ERWARTUNG: Record<Rolle, Record<"frei" | "inhaber" | "zugewiesen" | "fremd", boolean>> = {
  betrachter: { frei: false, inhaber: false, zugewiesen: false, fremd: false },
  bearbeiter: { frei: true, inhaber: true, zugewiesen: true, fremd: false },
  pruefer: { frei: true, inhaber: true, zugewiesen: true, fremd: false },
  admin: { frei: true, inhaber: true, zugewiesen: true, fremd: true },
};

describe("E44 Sperre: jeder fachliche Schreibpfad", () => {
  for (const aktion of SCHREIBPFADE) {
    for (const rolle of ROLLEN) {
      it(`${aktion} × ${rolle} × ungesperrt = ${AENDERN_ERWARTUNG[rolle].frei}`, () => {
        expect(darf({ rolle, id: ICH }, aktion, objektFuer(false, "fremd"))).toBe(AENDERN_ERWARTUNG[rolle].frei);
      });
      for (const v of ["inhaber", "zugewiesen", "fremd"] as const) {
        it(`${aktion} × ${rolle} × gesperrt/${v} = ${AENDERN_ERWARTUNG[rolle][v]}`, () => {
          expect(darf({ rolle, id: ICH }, aktion, objektFuer(true, v))).toBe(AENDERN_ERWARTUNG[rolle][v]);
        });
      }
    }
  }
  // Ein Bearbeiter, der nur Inhaber "waere" (ID stimmt), aber Rolle bearbeiter hat: Inhaber sein setzt pruefer voraus —
  // fuer das Bearbeiten reicht die Zuweisung/Inhaberschaft ueber die ID (E44 nennt Sperrinhaber, Zugewiesene, Admins).
});

describe("E44 Sperren, Entsperren, Zuweisen", () => {
  it("sperren: pruefer und admin, nur auf ungesperrten Stroemen", () => {
    expect(darf({ rolle: "pruefer", id: ICH }, "strom.sperren", FREI)).toBe(true);
    expect(darf({ rolle: "admin", id: ICH }, "strom.sperren", FREI)).toBe(true);
    expect(darf({ rolle: "bearbeiter", id: ICH }, "strom.sperren", FREI)).toBe(false);
    expect(darf({ rolle: "pruefer", id: ICH }, "strom.sperren", objektFuer(true, "inhaber"))).toBe(false);
    expect(darf({ rolle: "admin", id: ICH }, "strom.sperren", objektFuer(true, "fremd"))).toBe(false);
  });
  for (const aktion of ["strom.entsperren", "strom.zuweisen", "strom.zuweisung_entfernen"] as const) {
    it(`${aktion}: Sperrinhaber (als pruefer) oder admin; nie auf ungesperrten Stroemen`, () => {
      expect(darf({ rolle: "pruefer", id: ICH }, aktion, objektFuer(true, "inhaber"))).toBe(true);
      expect(darf({ rolle: "admin", id: ICH }, aktion, objektFuer(true, "fremd"))).toBe(true);
      expect(darf({ rolle: "pruefer", id: ICH }, aktion, objektFuer(true, "fremd"))).toBe(false);
      expect(darf({ rolle: "pruefer", id: ICH }, aktion, objektFuer(true, "zugewiesen"))).toBe(false);
      expect(darf({ rolle: "pruefer", id: ICH }, aktion, FREI)).toBe(false);
      expect(darf({ rolle: "admin", id: ICH }, aktion, FREI)).toBe(false);
    });
  }
  it("verliert der Inhaber die Rolle pruefer, bleibt die Sperre — loesen kann sie nur admin", () => {
    const gesperrtVonMir = objektFuer(true, "inhaber");
    expect(darf({ rolle: "bearbeiter", id: ICH }, "strom.entsperren", gesperrtVonMir)).toBe(false);
    expect(darf({ rolle: "bearbeiter", id: ICH }, "strom.bearbeiten", gesperrtVonMir)).toBe(true);
    expect(darf({ rolle: "admin", id: ANDERE }, "strom.entsperren", gesperrtVonMir)).toBe(true);
  });
  it("zuweisen nur an aktive Nutzer mit Rolle >= bearbeiter", () => {
    expect(darfZugewiesenWerden({ rolle: "bearbeiter", aktiv: true })).toBe(true);
    expect(darfZugewiesenWerden({ rolle: "pruefer", aktiv: true })).toBe(true);
    expect(darfZugewiesenWerden({ rolle: "admin", aktiv: true })).toBe(true);
    expect(darfZugewiesenWerden({ rolle: "betrachter", aktiv: true })).toBe(false);
    expect(darfZugewiesenWerden({ rolle: "bearbeiter", aktiv: false })).toBe(false);
    expect(darfZugewiesenWerden(null)).toBe(false);
    expect(darfZugewiesenWerden({ rolle: "superuser", aktiv: true })).toBe(false);
  });
});

// --- AP2.2: Inbox — nur der Empfaenger --------------------------------------
describe("AP2.2 Inbox: Objektregel nur Empfaenger", () => {
  for (const aktion of ["inbox.gelesen", "inbox.ungelesen", "inbox.erledigen", "inbox.verwerfen", "inbox.ablehnen"] as const) {
    it(`${aktion}: eigener Eintrag ja, fremder nein — auch fuer admin; ohne Objekt nie`, () => {
      for (const rolle of ROLLEN) {
        expect(darf({ rolle, id: ICH }, aktion, { empfaengerId: ICH })).toBe(true);
        expect(darf({ rolle, id: ICH }, aktion, { empfaengerId: ANDERE })).toBe(false);
        expect(darf({ rolle, id: ICH }, aktion)).toBe(false);
      }
      // Ein Sperr-Objekt ist fuer eine Inbox-Regel kein Objekt.
      expect(darf({ rolle: "admin", id: ICH }, aktion, FREI)).toBe(false);
    });
  }
  it("inbox.alle_erledigen hat keine Objektregel (wirkt nur auf eigene Eintraege per WHERE)", () => {
    expect(brauchtObjekt("inbox.alle_erledigen")).toBe(false);
    expect(darf({ rolle: "betrachter", id: ICH }, "inbox.alle_erledigen")).toBe(true);
  });
});

// --- PR c: Zugriff anfragen -------------------------------------------------
describe("PR c strom.zugriff_anfragen", () => {
  it("nur am gesperrten Strom, nur wer weder Inhaber noch zugewiesen ist; Betrachter nie", () => {
    for (const rolle of ["bearbeiter", "pruefer", "admin"] as const) {
      expect(darf({ rolle, id: ICH }, "strom.zugriff_anfragen", objektFuer(true, "fremd"))).toBe(true);
      expect(darf({ rolle, id: ICH }, "strom.zugriff_anfragen", objektFuer(true, "inhaber"))).toBe(false);
      expect(darf({ rolle, id: ICH }, "strom.zugriff_anfragen", objektFuer(true, "zugewiesen"))).toBe(false);
      expect(darf({ rolle, id: ICH }, "strom.zugriff_anfragen", FREI)).toBe(false);
    }
    expect(darf({ rolle: "betrachter", id: ICH }, "strom.zugriff_anfragen", objektFuer(true, "fremd"))).toBe(false);
    expect(darf({ rolle: "bearbeiter", id: ICH }, "strom.zugriff_anfragen")).toBe(false);
  });
});
