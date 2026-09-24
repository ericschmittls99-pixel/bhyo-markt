/**
 * F8/E30 PR C: Die Aktionen werden AUFGERUFEN, nicht die Oberfläche.
 *
 * Die reinen Regeln stehen in `benutzer-regeln.test.ts`. Hier wird geprüft,
 * dass die Aktionen sie auch anwenden — und dass sie die Datenbank bei einer
 * Ablehnung nicht anfassen. Eine Regel, die nur in der Bibliothek stimmt und
 * in der Aktion nicht aufgerufen wird, schützt niemanden.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Rolle } from "./rollen";

let angemeldet: string | null = null;
let eintrag: { rolle: Rolle; aktiv: boolean; name: string | null } | null = null;
/** Was in der Tabelle steht — Grundlage der Regelprüfung in der Aktion. */
let tabelle: { email: string; rolle: Rolle; aktiv: boolean }[] = [];
/** Jede echte Schreiboperation landet hier; bei Ablehnung muss sie leer sein. */
let schreibvorgaenge: string[] = [];

function fakeDb() {
  const db: Record<string, unknown> = {
    select: () => ({
      from: () => {
        // Zwei Leser derselben Attrappe: die Wache (mit .where().limit())
        // und ladeAlle (ohne where). Ein Promise-artiges Objekt bedient beide.
        const liste = Promise.resolve(tabelle);
        return Object.assign(liste, {
          where: () => ({ limit: async () => (eintrag ? [eintrag] : []) }),
        });
      },
    }),
    update: () => ({
      set: (werte: unknown) => ({
        where: async () => {
          schreibvorgaenge.push(`update ${JSON.stringify(werte)}`);
        },
      }),
    }),
    insert: () => ({
      values: async (werte: unknown) => {
        schreibvorgaenge.push(`insert ${JSON.stringify(werte)}`);
      },
    }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return db;
}

vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => angemeldet,
  withDb: async (fn: (db: unknown) => unknown) => fn(fakeDb()),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { aktivSetzen, rolleSetzen, benutzerAnlegen } = await import("./benutzer-actions");

const ERIC = "eric.schmitt@bhyo.de";

function alsAdmin(weitere: { email: string; rolle: Rolle; aktiv: boolean }[] = []) {
  angemeldet = ERIC;
  eintrag = { rolle: "admin", aktiv: true, name: "Eric Schmitt" };
  tabelle = [{ email: ERIC, rolle: "admin", aktiv: true }, ...weitere];
}

beforeEach(() => {
  angemeldet = null;
  eintrag = null;
  tabelle = [];
  schreibvorgaenge = [];
});

describe("Der letzte aktive Admin kann sich nicht aussperren", () => {
  it("Deaktivieren wird abgewiesen, ohne die Datenbank zu berühren", async () => {
    alsAdmin([{ email: "b@bhyo.de", rolle: "bearbeiter", aktiv: true }]);
    const ergebnis = await aktivSetzen(ERIC, false);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.fehler).toMatch(/letzte aktive Admin/);
    expect(schreibvorgaenge).toEqual([]);
  });

  it("Herabstufen wird abgewiesen, ohne die Datenbank zu berühren", async () => {
    alsAdmin([{ email: "b@bhyo.de", rolle: "bearbeiter", aktiv: true }]);
    const ergebnis = await rolleSetzen(ERIC, "bearbeiter");
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.fehler).toMatch(/letzte aktive Admin/);
    expect(schreibvorgaenge).toEqual([]);
  });

  it("mit einem zweiten aktiven Admin geht beides — und wird geschrieben", async () => {
    alsAdmin([{ email: "zwei@bhyo.de", rolle: "admin", aktiv: true }]);
    await expect(aktivSetzen(ERIC, false)).resolves.toEqual({ ok: true });
    expect(schreibvorgaenge).toHaveLength(1);
  });
});

describe("Verwaltungsrecht", () => {
  it("ein Bearbeiter kommt an keine dieser Aktionen heran", async () => {
    angemeldet = "b@bhyo.de";
    eintrag = { rolle: "bearbeiter", aktiv: true, name: null };
    tabelle = [{ email: ERIC, rolle: "admin", aktiv: true }];

    for (const aufruf of [
      () => aktivSetzen(ERIC, false),
      () => rolleSetzen(ERIC, "betrachter"),
      () => benutzerAnlegen({ ok: false }, formular("neu@bhyo.de", "admin")),
    ]) {
      const ergebnis = await aufruf();
      expect(ergebnis.ok).toBe(false);
      expect(ergebnis.fehler).toBe("Diese Aktion ist Admins vorbehalten.");
    }
    expect(schreibvorgaenge).toEqual([]);
  });
});

describe("Anlegen", () => {
  it("normalisiert die Adresse auf Kleinschreibung", async () => {
    alsAdmin();
    await expect(
      benutzerAnlegen({ ok: false }, formular("Neue.Person@BHYO.de", "bearbeiter")),
    ).resolves.toEqual({ ok: true });
    expect(schreibvorgaenge[0]).toContain('"email":"neue.person@bhyo.de"');
  });

  it("weist eine doppelte Adresse ab", async () => {
    alsAdmin();
    const ergebnis = await benutzerAnlegen({ ok: false }, formular(ERIC, "bearbeiter"));
    expect(ergebnis.ok).toBe(false);
    expect(schreibvorgaenge).toEqual([]);
  });

  it("weist eine unbekannte Rolle ab", async () => {
    alsAdmin();
    const ergebnis = await benutzerAnlegen({ ok: false }, formular("neu@bhyo.de", "chef"));
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.fehler).toBe("Unbekannte Rolle.");
    expect(schreibvorgaenge).toEqual([]);
  });
});

function formular(email: string, rolle: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("rolle", rolle);
  return fd;
}
