/**
 * F8/E30 PR C: Die Aktionen werden AUFGERUFEN, nicht die Oberfläche.
 *
 * Die reinen Regeln stehen in `benutzer-regeln.test.ts`. Hier wird geprüft,
 * dass die Aktionen sie auch anwenden — und dass sie die Datenbank bei einer
 * Ablehnung nicht anfassen. Eine Regel, die nur in der Bibliothek stimmt und
 * in der Aktion nicht aufgerufen wird, schützt niemanden.
 *
 * Eric 14.10.2026: Die Deaktivierung löscht das Profilbild (R2-Objekt und
 * Schlüssel) in derselben Transaktion, mit derselben Fehlerlogik wie das
 * Entfernen: Lösch-Störung → Rollback, Fehlermeldung. Der Bucket ist dafür
 * eine echte Ablage (Map), die Auslieferung läuft über die echte Route.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Rolle } from "./rechte/rollen";

let angemeldet: string | null = null;
let eintrag: { id: string; rolle: Rolle; aktiv: boolean; name: string | null } | null = null;
/** Was in der Tabelle steht — Grundlage der Regelprüfung in der Aktion. */
let tabelle: { id: string; email: string; rolle: Rolle; aktiv: boolean; bildKey?: string | null }[] = [];
/** Bild-Schluessel der Zeile, die die Route (where id) liest — die Attrappe kennt nur eine. */
let bildKeyZeile: string | null = null;
/** Echte Ablage fuer Profilbilder: delete entfernt, get liest. */
let ablage = new Map<string, { bytes: ArrayBuffer; typ?: string }>();
/** Schluessel, dessen Loeschen fehlschlaegt (R2-Stoerung fuer genau dieses Objekt). */
let loeschenWirftFuer: string | null = null;
let r2: { op: string; key: string }[] = [];
const ERIC_ID = "00000000-0000-4000-8000-0000000000e1";
const NEU_ID = "00000000-0000-4000-8000-0000000000aa";
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
          where: () => ({ limit: async () => (eintrag ? [{ ...eintrag, bildKey: bildKeyZeile }] : []) }),
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
      // Zwei Nutzer: der Benutzer-INSERT mit .returning(), das Protokoll
      // (lib/protokoll) wartet direkt auf values(). Ein thenable mit returning.
      values: (werte: unknown) => {
        if (insertFehler) throw insertFehler;
        schreibvorgaenge.push(`insert ${JSON.stringify(werte)}`);
        return Object.assign(Promise.resolve(undefined), {
          returning: async () => [{ id: NEU_ID }],
        });
      },
    }),
    // Rollback-Attrappe: wirft fn, verschwinden die Schreibvorgaenge der Transaktion wieder.
    transaction: async (fn: (tx: unknown) => unknown) => {
      const stand = schreibvorgaenge.length;
      try {
        return await fn(db);
      } catch (e) {
        schreibvorgaenge.length = stand;
        throw e;
      }
    },
  };
  return db;
}

vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => angemeldet,
  withDb: async (fn: (db: unknown) => unknown) => fn(fakeDb()),
  getBelegeBucket: async () => ({
    delete: async (key: string) => {
      if (key === loeschenWirftFuer) throw new Error("r2 weg");
      r2.push({ op: "delete", key });
      ablage.delete(key);
    },
    get: async (key: string) => {
      const o = ablage.get(key);
      return o ? { body: new Blob([o.bytes]).stream(), size: o.bytes.byteLength, httpMetadata: { contentType: o.typ } } : null;
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { aktivSetzen, rolleSetzen, benutzerAnlegen } = await import("./benutzer-actions");
const { GET: bildRoute } = await import("@/app/api/profil/bild/[id]/route");

const ERIC = "eric.schmitt@bhyo.de";

function alsAdmin(weitere: { email: string; rolle: Rolle; aktiv: boolean }[] = []) {
  angemeldet = ERIC;
  eintrag = { id: ERIC_ID, rolle: "admin", aktiv: true, name: "Eric Schmitt" };
  tabelle = [
    { id: ERIC_ID, email: ERIC, rolle: "admin", aktiv: true },
    ...weitere.map((w, i) => ({ id: `00000000-0000-4000-8000-0000000000b${i}`, ...w })),
  ];
}

beforeEach(() => {
  angemeldet = null;
  eintrag = null;
  tabelle = [];
  schreibvorgaenge = [];
  insertFehler = null;
  bildKeyZeile = null;
  ablage = new Map();
  loeschenWirftFuer = null;
  r2 = [];
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

  it("mit einem zweiten aktiven Admin geht beides — und wird geschrieben, mit Ereignis", async () => {
    alsAdmin([{ email: "zwei@bhyo.de", rolle: "admin", aktiv: true }]);
    await expect(aktivSetzen(ERIC, false)).resolves.toEqual({ ok: true });
    // AP2.2 PR a: UPDATE plus genau ein Protokoll-Ereignis in derselben Transaktion.
    expect(schreibvorgaenge).toHaveLength(2);
    expect(schreibvorgaenge[0]).toMatch(/^update /);
    expect(schreibvorgaenge[1]).toContain('"art":"benutzer_deaktiviert"');
    expect(schreibvorgaenge[1]).toContain(`"entitaetId":"${ERIC_ID}"`);
    expect(schreibvorgaenge[1]).toContain(`"benutzerId":"${ERIC_ID}"`);
  });
});

describe("Deaktivierung löscht das Profilbild (Eric 14.10.2026)", () => {
  const ALT = "profil/testumgebung/" + ERIC_ID + "/alt.webp";
  /** Eric hat ein Bild; ein zweiter Admin ist da, damit die Deaktivierung erlaubt ist. */
  function ericMitBild() {
    alsAdmin([{ email: "zwei@bhyo.de", rolle: "admin", aktiv: true }]);
    tabelle[0]!.bildKey = ALT;
    bildKeyZeile = ALT;
    ablage.set(ALT, { bytes: new Uint8Array([1, 2, 3]).buffer, typ: "image/webp" });
  }
  async function routeStatus(): Promise<number> {
    const res = await bildRoute(new Request("http://test/api/profil/bild/" + ERIC_ID), { params: Promise.resolve({ id: ERIC_ID }) });
    return res.status;
  }

  it("Deaktivieren: Objekt weg, Schlüssel NULL, Protokoll wie bisher ohne Bildinhalt, alter Schlüssel → 404", async () => {
    ericMitBild();
    expect(await routeStatus()).toBe(200);
    await expect(aktivSetzen(ERIC, false)).resolves.toEqual({ ok: true });
    expect(ablage.has(ALT)).toBe(false);
    expect(r2).toEqual([{ op: "delete", key: ALT }]);
    expect(schreibvorgaenge).toHaveLength(2);
    expect(schreibvorgaenge[0]).toMatch(/^update /);
    expect(schreibvorgaenge[0]).toContain('"aktiv":false');
    expect(schreibvorgaenge[0]).toContain('"bildKey":null');
    expect(schreibvorgaenge[0]).toContain('"bildGeaendertAm":null');
    expect(schreibvorgaenge[1]).toContain('"art":"benutzer_deaktiviert"');
    expect(schreibvorgaenge[1]).not.toContain(ALT);
    // Zeile auf NULL → 404 ohne R2; eine veraltete Zeile mit dem alten Schluessel → 404 (Objekt fehlt).
    bildKeyZeile = null;
    expect(await routeStatus()).toBe(404);
    bildKeyZeile = ALT;
    expect(await routeStatus()).toBe(404);
  });

  it("Deaktivieren ohne Bild: Zeile nur aktiv=false, kein R2-Zugriff", async () => {
    alsAdmin([{ email: "zwei@bhyo.de", rolle: "admin", aktiv: true }]);
    await expect(aktivSetzen(ERIC, false)).resolves.toEqual({ ok: true });
    expect(schreibvorgaenge[0]).not.toContain("bildKey");
    expect(r2).toEqual([]);
  });

  it("Lösch-Störung: Fehlermeldung, Deaktivierung zurückgerollt, Objekt bleibt", async () => {
    ericMitBild();
    loeschenWirftFuer = ALT;
    const ergebnis = await aktivSetzen(ERIC, false);
    expect(ergebnis).toEqual({ ok: false, fehler: expect.stringContaining("nicht gelöscht") });
    expect(schreibvorgaenge).toEqual([]);
    expect(ablage.has(ALT)).toBe(true);
  });

  it("Reaktivieren: nur aktiv=true, Schlüssel bleibt NULL (Initialen), kein R2-Zugriff", async () => {
    alsAdmin([{ email: "zwei@bhyo.de", rolle: "admin", aktiv: true }]);
    tabelle[0]!.aktiv = false;
    await expect(aktivSetzen(ERIC, true)).resolves.toEqual({ ok: true });
    expect(schreibvorgaenge[0]).toContain('"aktiv":true');
    expect(schreibvorgaenge[0]).not.toContain("bildKey");
    expect(schreibvorgaenge[1]).toContain('"art":"benutzer_aktiviert"');
    expect(r2).toEqual([]);
    expect(await routeStatus()).toBe(404);
  });
});

describe("Verwaltungsrecht", () => {
  it("ein Bearbeiter kommt an keine dieser Aktionen heran", async () => {
    angemeldet = "b@bhyo.de";
    eintrag = { id: "00000000-0000-4000-8000-0000000000b9", rolle: "bearbeiter", aktiv: true, name: null };
    tabelle = [{ id: ERIC_ID, email: ERIC, rolle: "admin", aktiv: true }];

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
    // AP2.2 PR a: das Ereignis zeigt auf den NEUEN Benutzer, Urheber ist Eric.
    expect(schreibvorgaenge[1]).toContain('"art":"benutzer_angelegt"');
    expect(schreibvorgaenge[1]).toContain(`"entitaetId":"${NEU_ID}"`);
    expect(schreibvorgaenge[1]).toContain(`"benutzerId":"${ERIC_ID}"`);
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
