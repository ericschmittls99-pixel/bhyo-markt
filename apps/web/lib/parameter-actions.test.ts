/**
 * AP2.3 PR a: Die Aktionen werden echt aufgerufen — nur admin (serverseitig),
 * Regeln vor jeder Wirkung, Protokoll je Aktion, Zuruecknehmen nur kuenftig.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rolle: "betrachter" | "bearbeiter" | "pruefer" | "admin" = "admin";
const ERIC = { id: "00000000-0000-4000-8000-0000000000e1", email: "eric@bhyo.de", name: "Eric", aktiv: true };
const DEF = { schluessel: "verifikationsfrist.gespraech", bezeichnung: "Gespräch", einheit: "monate", min: 1, max: 120, beschreibung: "" };
let zeile: { id: string; schluessel: string; wert: number; gueltigAb: string } | null = null;
let inserts: Record<string, unknown>[] = [];
let deletes = 0;
let insertFehler: unknown = null;
const protokolliere = vi.fn(async (_tx: unknown, _e: unknown) => ({ id: "e" }));

vi.mock("@/lib/protokoll", async (orig) => ({ ...(await orig<typeof import("@/lib/protokoll")>()), protokolliere }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => ERIC.email,
  withDb: async (fn: (db: unknown) => unknown) => {
    const tx = {
      select: () => ({
        from: () => ({
          where: () => {
            const p = Promise.resolve(zeile ? [zeile] : []) as Promise<unknown> & Record<string, unknown>;
            p.limit = async () => [DEF];
            p.for = async () => (zeile ? [zeile] : []);
            return p;
          },
        }),
      }),
      insert: () => ({
        values: (w: Record<string, unknown>) => ({
          returning: async () => {
            if (insertFehler) throw insertFehler;
            inserts.push(w);
            return [{ id: "neu" }];
          },
        }),
      }),
      delete: () => ({ where: async () => { deletes += 1; } }),
    };
    return fn({ transaction: async (f: (t: unknown) => unknown) => f(tx) });
  },
}));
vi.mock("@/lib/rechte/wache", async (orig) => {
  const echt = await orig<typeof import("@/lib/rechte/wache")>();
  const { darfRolle } = await import("@/lib/rechte/matrix");
  return {
    ...echt,
    // Rollenstufe wie die echte Wache — aus derselben Matrix.
    rechtFuerAction: async (aktion: string) => {
      const zugang = { art: "erlaubt" as const, ...ERIC, rolle };
      if (!darfRolle(zugang, aktion)) return { ok: false, fehler: "Diese Aktion ist Admins vorbehalten." };
      return { email: ERIC.email, zugang };
    },
  };
});

const { parameterSetzen, parameterZuruecknehmen } = await import("./parameter-actions");
const { heuteBerlin } = await import("./parameter");

function formular(felder: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(felder)) fd.set(k, v);
  return fd;
}
const heute = heuteBerlin();

beforeEach(() => {
  rolle = "admin";
  zeile = null;
  inserts = [];
  deletes = 0;
  insertFehler = null;
  protokolliere.mockClear();
});

describe("parameterSetzen", () => {
  it("nur admin — andere Rollen werden vor jeder Wirkung abgewiesen", async () => {
    for (const r of ["betrachter", "bearbeiter", "pruefer"] as const) {
      rolle = r;
      const erg = await parameterSetzen({ ok: false }, formular({ schluessel: DEF.schluessel, wert: "4", gueltig_ab: heute, begruendung: "x" }));
      expect(erg.ok).toBe(false);
    }
    expect(inserts).toEqual([]);
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("legt eine Verlaufszeile ab heute an und protokolliert parameter_gesetzt", async () => {
    expect(await parameterSetzen({ ok: false }, formular({ schluessel: DEF.schluessel, wert: "4", gueltig_ab: heute, begruendung: "Rücksprache" }))).toEqual({ ok: true });
    expect(inserts[0]).toMatchObject({ schluessel: DEF.schluessel, wert: 4, gueltigAb: heute, begruendung: "Rücksprache", erstelltVon: ERIC.id });
    expect(protokolliere.mock.calls[0]![1]).toMatchObject({ art: "parameter_gesetzt", entitaet: "parameter_wert", id: "neu", benutzerId: ERIC.id });
  });
  it("weist rueckwirkend, ausserhalb des Bereichs und ohne Begründung ab — nichts geschrieben", async () => {
    for (const f of [
      { wert: "4", gueltig_ab: "2020-01-01", begruendung: "x" },
      { wert: "999", gueltig_ab: heute, begruendung: "x" },
      { wert: "4", gueltig_ab: heute, begruendung: " " },
    ]) {
      const erg = await parameterSetzen({ ok: false }, formular({ schluessel: DEF.schluessel, ...f }));
      expect(erg.ok).toBe(false);
    }
    expect(inserts).toEqual([]);
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("zweite Änderung am selben Tag: die DB-Eindeutigkeit wird klar gemeldet", async () => {
    insertFehler = Object.assign(new Error("duplicate"), { code: "23505" });
    const erg = await parameterSetzen({ ok: false }, formular({ schluessel: DEF.schluessel, wert: "4", gueltig_ab: heute, begruendung: "x" }));
    expect(erg.fehler).toMatch(/bereits eine Änderung/);
    expect(protokolliere).not.toHaveBeenCalled();
  });
});

describe("parameterZuruecknehmen", () => {
  it("nimmt eine kuenftige Änderung zurück und protokolliert parameter_zurueckgenommen", async () => {
    zeile = { id: "z1", schluessel: DEF.schluessel, wert: 4, gueltigAb: "2099-01-01" };
    expect(await parameterZuruecknehmen("z1")).toEqual({ ok: true });
    expect(deletes).toBe(1);
    expect(protokolliere.mock.calls[0]![1]).toMatchObject({ art: "parameter_zurueckgenommen", entitaet: "parameter_wert", id: "z1" });
  });
  it("eine geltende Änderung (heute, Vergangenheit, seit Einführung) bleibt im Verlauf", async () => {
    for (const ab of [heute, "2020-01-01", "-infinity"]) {
      zeile = { id: "z1", schluessel: DEF.schluessel, wert: 4, gueltigAb: ab };
      const erg = await parameterZuruecknehmen("z1");
      expect(erg.ok).toBe(false);
      expect(erg.fehler).toMatch(/gilt bereits/);
    }
    expect(deletes).toBe(0);
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("unbekannte Zeile: Fehler, nichts geschrieben; nur admin", async () => {
    expect((await parameterZuruecknehmen("nix")).ok).toBe(false);
    rolle = "pruefer";
    zeile = { id: "z1", schluessel: DEF.schluessel, wert: 4, gueltigAb: "2099-01-01" };
    expect((await parameterZuruecknehmen("z1")).ok).toBe(false);
    expect(deletes).toBe(0);
  });
});
