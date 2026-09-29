/**
 * F8/E30 PR C: Die Aktionen werden AUFGERUFEN, nicht die Oberfläche.
 *
 * Die reinen Regeln stehen in `benutzer-regeln.test.ts`. Hier wird geprüft,
 * dass die Aktionen sie auch anwenden — und dass sie die Datenbank bei einer
 * Ablehnung nicht anfassen. Eine Regel, die nur in der Bibliothek stimmt und
 * in der Aktion nicht aufgerufen wird, schützt niemanden.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Rolle } from "./rechte/rollen";

let angemeldet: string | null = null;
let eintrag: { rolle: Rolle; aktiv: boolean; name: string | null } | null = null;
/** Was in der Tabelle steht — Grundlage der Regelprüfung in der Aktion. */
let tabelle: { email: string; rolle: Rolle; aktiv: boolean }[] = [];
/** Jede echte Schreiboperation landet hier; bei Ablehnung muss sie leer sein. */
let schreibvorgaenge: string[] = [];
/** Wirft die Attrappe beim INSERT diesen Fehler? (Datenbank-Constraint schlaegt zu.) */
let insertFehler: unknown = null;

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
        if (insertFehler) throw insertFehler;
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
  insertFehler = null;
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

  // Production-Fehler 29.09.2026: Die Vorpruefung las (ueber den Hyperdrive-
  // Abfrage-Cache) einen veralteten Stand, das INSERT lief in den Primaer-
  // schluessel — SQLSTATE 23505 kam ungefangen als 500 beim Nutzer an. Die
  // DB-Constraint ist die Wahrheit; die Aktion muss ihre Antwort verstehen.
  it("fängt die Unique-Verletzung der Datenbank ab und meldet sie klar", async () => {
    alsAdmin();
    insertFehler = Object.assign(new Error("duplicate key value"), { code: "23505" });
    const ergebnis = await benutzerAnlegen({ ok: false }, formular("neu@bhyo.de", "bearbeiter"));
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.fehler).toMatch(/bereits eingetragen/);
  });

  it("erkennt die Unique-Verletzung auch eingepackt (DrizzleQueryError → cause)", async () => {
    alsAdmin();
    insertFehler = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("duplicate key value"), { code: "23505" }),
    });
    const ergebnis = await benutzerAnlegen({ ok: false }, formular("neu@bhyo.de", "bearbeiter"));
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.fehler).toMatch(/bereits eingetragen/);
  });

  it("verschluckt andere Datenbankfehler nicht", async () => {
    alsAdmin();
    insertFehler = Object.assign(new Error("connection lost"), { code: "08006" });
    await expect(
      benutzerAnlegen({ ok: false }, formular("neu@bhyo.de", "bearbeiter")),
    ).rejects.toThrow("connection lost");
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

describe("Aktualisierung der Liste", () => {
  it("revalidiert den Pfad, unter dem die Seite wirklich liegt", async () => {
    // Befund aus dem Preview-Test (24.09.2026): Der Pfad lautete
    // "/einstellungen/benutzer" — diese Route gibt es nicht. Die Aktion
    // schrieb, die Liste blieb stehen und das kontrollierte Select sprang
    // auf den alten Wert zurueck: fuer den Nutzer sah es aus, als sei
    // nichts passiert, obwohl die Datenbank sich geaendert hatte.
    const quelle = readFileSync(join(process.cwd(), "lib/benutzer-actions.ts"), "utf8");
    const pfade = [...quelle.matchAll(/revalidatePath\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(pfade.length).toBeGreaterThan(0);
    for (const pfad of pfade) {
      expect(existsSync(join(process.cwd(), "app", pfad, "page.tsx"))).toBe(true);
    }
  });
});
