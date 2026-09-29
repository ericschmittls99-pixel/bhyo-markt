/**
 * E44: Die Sperre wird SERVERSEITIG durchgesetzt — die Actions werden echt
 * aufgerufen (wie wache.test.ts), Infrastruktur ist gemockt. Die Objektstufe
 * (lib/rechte/sperre-server.ts) ist hier ein Mock, der die Sperre eines
 * anderen meldet: Jeder fachliche Schreibpfad muss sie aufrufen UND bei
 * "Gesperrt" abbrechen, ohne zu schreiben. Wird der Aufruf entfernt, laeuft
 * das UPDATE durch — dann ist dieser Test rot (einmal gezeigt, siehe PR).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let angemeldet: string | null = null;
let eintrag: { id: string; rolle: "betrachter" | "bearbeiter" | "pruefer" | "admin"; aktiv: boolean; name: string | null } | null = null;
let schreibversuche = 0;
let sperrpruefungen = 0;

vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => angemeldet,
  withDb: async (fn: (db: unknown) => unknown) => {
    const kette = (): unknown => {
      const p: Record<string, unknown> = {};
      for (const m of ["from", "where", "limit", "leftJoin", "for", "orderBy"]) p[m] = () => kette();
      (p as { then: unknown }).then = (res: (v: unknown) => void) => res(eintrag ? [eintrag] : []);
      return p;
    };
    const tx = {
      select: () => kette(),
      update: () => { schreibversuche += 1; throw new Error("Darf bei Sperre nie erreicht werden."); },
      insert: () => { schreibversuche += 1; throw new Error("Darf bei Sperre nie erreicht werden."); },
      delete: () => { schreibversuche += 1; throw new Error("Darf bei Sperre nie erreicht werden."); },
    };
    const db = { select: () => kette(), transaction: async (f: (t: unknown) => unknown) => f(tx) };
    return fn(db);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/rechte/sperre-server", async (orig) => {
  const echt = await orig<typeof import("@/lib/rechte/sperre-server")>();
  return {
    ...echt,
    pruefeStromSperre: async () => {
      sperrpruefungen += 1;
      throw new echt.Gesperrt({ id: "x", name: "Petra Prüfer", email: "petra@bhyo.de" }, new Date());
    },
    pruefeBelegSperre: async () => {
      sperrpruefungen += 1;
      throw new echt.Gesperrt({ id: "x", name: "Petra Prüfer", email: "petra@bhyo.de" }, new Date());
    },
  };
});

const { statusSetzen, stromVerwerfen } = await import("./stroeme-actions");
const { stromSperren, stromEntsperren, stromZuweisen, zuweisungEntfernen } = await import("./sperre-actions");

beforeEach(() => {
  angemeldet = "fremd@bhyo.de";
  eintrag = { id: "00000000-0000-4000-8000-000000000009", rolle: "bearbeiter", aktiv: true, name: "Fremder Bearbeiter" };
  schreibversuche = 0;
  sperrpruefungen = 0;
});

describe("E44: fremder Bearbeiter an einem gesperrten Strom — serverseitig abgewiesen", () => {
  it("statusSetzen bricht mit Gesperrt-von-Meldung ab, ohne zu schreiben", async () => {
    const erg = await statusSetzen("biomasse", "s1", "in_pruefung");
    expect(erg).toEqual({ ok: false, fehler: "Gesperrt von Petra Prüfer." });
    expect(sperrpruefungen).toBe(1);
    expect(schreibversuche).toBe(0);
  });
  it("stromVerwerfen bricht mit Gesperrt-von-Meldung ab, ohne zu schreiben", async () => {
    const erg = await stromVerwerfen("output", "o1");
    expect(erg).toEqual({ ok: false, fehler: "Gesperrt von Petra Prüfer." });
    expect(sperrpruefungen).toBe(1);
    expect(schreibversuche).toBe(0);
  });
  it("Sperr-Actions eines Pruefers am fremd gesperrten Strom: Objektstufe greift", async () => {
    eintrag = { ...eintrag!, rolle: "pruefer" };
    for (const lauf of [
      () => stromSperren("biomasse", "s1"),
      () => stromEntsperren("biomasse", "s1"),
      () => stromZuweisen("biomasse", "s1", "n1"),
      () => zuweisungEntfernen("biomasse", "s1", "n1"),
    ]) {
      const erg = await lauf();
      expect(erg.ok).toBe(false);
      expect(erg.fehler).toBe("Gesperrt von Petra Prüfer.");
    }
    expect(sperrpruefungen).toBe(4);
    expect(schreibversuche).toBe(0);
  });
  it("Rollenstufe zuerst: ein Bearbeiter darf gar nicht sperren, die Objektstufe wird nicht erst gefragt", async () => {
    const erg = await stromSperren("biomasse", "s1");
    expect(erg.ok).toBe(false);
    expect(erg.fehler).toBe("Für diese Aktion fehlt das Schreibrecht.");
    expect(sperrpruefungen).toBe(0);
  });
});
