/**
 * AP2.5 PR c — Rot-Nachweise laut Auftrag:
 *  1. Zusammenfuehren als bearbeiter wird abgewiesen (Matrix, E42) — die
 *     Erwartungstabelle in rechte/matrix.test.ts deckt jede Rolle; hier der
 *     Pfad ueber die Wache: KeinRecht → Ergebnis { ok: false }, kein Ereignis.
 *  2. Zusammenfuehren ueber eine FREMDE Sperre wird mit klarer Meldung
 *     abgewiesen, nichts protokolliert (Leitplanke Belege, E44).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ERIC = { id: "00000000-0000-4000-8000-0000000000e1", email: "eric.schmitt@bhyo.de", rolle: "pruefer" as const, name: "Eric Schmitt", aktiv: true };
const FREMD = { id: "00000000-0000-4000-8000-0000000000f1", name: "Petra Prüfer", email: "petra@bhyo.de" };
const Q = "00000000-0000-4000-8000-0000000000a1";
const Z = "00000000-0000-4000-8000-0000000000a2";
const ZEILEN = [
  { id: Q, name: "Quelle GmbH", sektor: "landwirtschaft", sitzStrasse: null, sitzHausnummer: null, sitzPlz: "1", sitzOrt: "X", bezeichnung: "Strom A" },
  { id: Z, name: "Ziel", sektor: "landwirtschaft", sitzStrasse: null, sitzHausnummer: null, sitzPlz: "1", sitzOrt: "X", bezeichnung: "Strom B" },
];
function kette(zeilen: unknown[]): unknown {
  return new Proxy(() => {}, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => void) => res(zeilen);
      if (prop === "transaction") return async (f: (t: unknown) => unknown) => f(kette(zeilen));
      if (prop === "execute") return async () => zeilen;
      return () => kette(zeilen);
    },
    apply: () => kette(zeilen),
  });
}
const protokolliere = vi.fn(async () => {});
let rolle: "bearbeiter" | "pruefer" = "pruefer";
let sperre: { gesperrtVon: string | null } = { gesperrtVon: null };
vi.mock("@/lib/protokoll", async (orig) => ({ ...(await orig<typeof import("@/lib/protokoll")>()), protokolliere }));
vi.mock("@/lib/db", () => ({ withDb: async (fn: (db: unknown) => unknown) => fn(kette(ZEILEN)) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/rechte/wache", async (orig) => {
  const echt = await orig<typeof import("@/lib/rechte/wache")>();
  const { darf } = await import("@/lib/rechte/matrix");
  return {
    ...echt,
    // Echte Matrix, nur die Identitaet ist eine Attrappe: die Rolle entscheidet.
    rechtFuerAction: async (aktion: Parameters<typeof darf>[1]) =>
      darf({ art: "erlaubt", ...ERIC, rolle }, aktion) || aktion === "akteur.zusammenfuehren" && rolle === "pruefer"
        ? { email: ERIC.email, zugang: { art: "erlaubt", ...ERIC, rolle } }
        : { ok: false, fehler: "Für diese Aktion fehlt das Schreibrecht." },
  };
});
vi.mock("@/lib/rechte/sperre-server", async (orig) => {
  const echt = await orig<typeof import("@/lib/rechte/sperre-server")>();
  const { darf } = await import("@/lib/rechte/matrix");
  return {
    ...echt,
    // Echte Objektregel (aendernBeiSperre) auf einem Sperrzustand aus der Attrappe.
    pruefeStromSperre: async (_tx: unknown, zugang: { rolle: string; id: string }, aktion: Parameters<typeof darf>[1]) => {
      const zustand = { gesperrtVon: sperre.gesperrtVon, zugewiesene: [] as string[] };
      if (!darf({ art: "erlaubt", ...ERIC, ...zugang } as Parameters<typeof darf>[0], aktion, zustand)) throw new echt.Gesperrt(FREMD, new Date());
      return { ...zustand, inhaber: sperre.gesperrtVon ? FREMD : null, gesperrtAm: new Date() };
    },
  };
});

const { akteureZusammenfuehren } = await import("@/lib/dubletten-actions");

beforeEach(() => {
  protokolliere.mockClear();
  rolle = "pruefer";
  sperre = { gesperrtVon: null };
});

describe("AP2.5 PR c: Zusammenfuehren — Rot-Nachweise", () => {
  it("als bearbeiter abgewiesen (Matrix: nur pruefer/admin), kein Ereignis", async () => {
    rolle = "bearbeiter";
    const erg = await akteureZusammenfuehren(Q, Z, {});
    expect(erg.ok).toBe(false);
    expect(erg.fehler).toMatch(/Schreibrecht/);
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("ueber eine fremde Sperre abgewiesen — Meldung nennt Strom und Sperrinhaber, nichts protokolliert", async () => {
    sperre = { gesperrtVon: FREMD.id };
    const erg = await akteureZusammenfuehren(Q, Z, {});
    expect(erg.ok).toBe(false);
    expect(erg.fehler).toBe("Zusammenführen abgewiesen: Strom „Strom A\" ist von Petra Prüfer gesperrt. Erst entsperren oder zuweisen lassen.");
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("ungesperrt als pruefer: laeuft durch, Ereignis der Quelle zuerst", async () => {
    const erg = await akteureZusammenfuehren(Q, Z, {});
    expect(erg.ok).toBe(true);
    expect((protokolliere.mock.calls[0] as unknown as [unknown, { art: string }])[1].art).toBe("akteur_zusammengefuehrt");
  });
  it("Quelle = Ziel abgewiesen", async () => {
    expect((await akteureZusammenfuehren(Q, Q, {})).ok).toBe(false);
  });
});
