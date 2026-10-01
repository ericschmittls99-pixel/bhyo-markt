/**
 * AP2.5 PR b (E66): Kontaktpersonen — die Rechte sitzen in der Matrix, die
 * Wache setzt sie serverseitig durch: ein Betrachter kommt mit keiner
 * Schreibaktion durch (Rot-Nachweis: vor dem Eintrag der Aktionen in der
 * Matrix lief das Anlegen durch). Die Actions werden echt aufgerufen, die
 * Datenbank ist eine Attrappe; im Protokoll-Freitext steht nie der Name.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rolle: "betrachter" | "bearbeiter" | "pruefer" | "admin" = "betrachter";
let schreibversuche = 0;
const protokolliere = vi.fn(async () => ({ id: "e" }));
const ZEILE = { id: "00000000-0000-4000-8000-000000000009", akteurId: "00000000-0000-4000-8000-0000000000aa", name: "Petra Person", funktion: "Leitung", mailDienstlich: null, telefon: null, notiz: null };

vi.mock("@/lib/protokoll", async (orig) => ({ ...(await orig<typeof import("@/lib/protokoll")>()), protokolliere }));
vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => "ich@bhyo.de",
  withDb: async (fn: (db: unknown) => unknown) => {
    const kette = (): unknown => {
      const p: Record<string, unknown> = {};
      for (const m of ["from", "where", "limit", "values", "returning", "set"]) p[m] = () => kette();
      (p as { then: unknown }).then = (res: (v: unknown) => void) => res([{ ...ZEILE, rolle, aktiv: true, email: "ich@bhyo.de" }]);
      return p;
    };
    const tx = {
      select: () => kette(),
      insert: () => { schreibversuche += 1; return kette(); },
      update: () => { schreibversuche += 1; return kette(); },
      delete: () => { schreibversuche += 1; return kette(); },
    };
    return fn({ select: () => kette(), transaction: async (f: (t: unknown) => unknown) => f(tx) });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { kontaktpersonAnlegen, kontaktpersonAuskunftErstellen, kontaktpersonBearbeiten, kontaktpersonLoeschen } = await import("./kontaktperson-actions");

const fd = (w: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(w)) f.set(k, v);
  return f;
};

beforeEach(() => {
  rolle = "betrachter";
  schreibversuche = 0;
  protokolliere.mockClear();
});

describe("Kontaktpersonen: Rechte serverseitig (E66)", () => {
  it("ein Betrachter schreibt keine Kontaktperson — anlegen, bearbeiten, loeschen abgewiesen, nichts geschrieben", async () => {
    for (const lauf of [() => kontaktpersonAnlegen(ZEILE.akteurId, fd({ name: "Neu" })), () => kontaktpersonBearbeiten(ZEILE.id, fd({ name: "Neu" })), () => kontaktpersonLoeschen(ZEILE.id)]) {
      const erg = await lauf();
      expect(erg.ok).toBe(false);
      expect(erg.fehler).toBe("Für diese Aktion fehlt das Schreibrecht.");
    }
    expect(schreibversuche).toBe(0);
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("ein Bearbeiter legt an und bearbeitet, darf aber nicht loeschen; Pruefer loescht", async () => {
    rolle = "bearbeiter";
    expect((await kontaktpersonAnlegen(ZEILE.akteurId, fd({ name: "Neu" }))).ok).toBe(true);
    expect((await kontaktpersonBearbeiten(ZEILE.id, fd({ name: "Petra Person", funktion: "Geschäftsführung" }))).ok).toBe(true);
    expect((await kontaktpersonLoeschen(ZEILE.id)).fehler).toBe("Für diese Aktion fehlt das Schreibrecht.");
    rolle = "pruefer";
    expect((await kontaktpersonLoeschen(ZEILE.id)).ok).toBe(true);
  });
  it("Protokoll traegt nur IDs und Feldnamen, nie den Namen (E57)", async () => {
    rolle = "bearbeiter";
    await kontaktpersonBearbeiten(ZEILE.id, fd({ name: "Petra Person", funktion: "Geschäftsführung" }));
    const e = (protokolliere.mock.calls[0] as unknown as [unknown, { art: string; entitaet: string; text?: string }])[1];
    expect(e).toMatchObject({ art: "kontaktperson_geaendert", entitaet: "kontaktperson", text: "Felder: funktion" });
    expect(e.text).not.toContain("Petra");
  });
  it("Auskunft erstellen: nur Admin; schreibt auskunft_erstellt (nur IDs) und liefert die Ereignis-ID", async () => {
    for (const r of ["betrachter", "bearbeiter", "pruefer"] as const) {
      rolle = r;
      expect((await kontaktpersonAuskunftErstellen(ZEILE.id)).ok).toBe(false);
    }
    expect(protokolliere).not.toHaveBeenCalled();
    rolle = "admin";
    const erg = await kontaktpersonAuskunftErstellen(ZEILE.id);
    expect(erg).toMatchObject({ ok: true, ereignisId: "e", akteurId: ZEILE.akteurId });
    const e = (protokolliere.mock.calls[0] as unknown as [unknown, { art: string; entitaet: string; text?: string }])[1];
    expect(e).toMatchObject({ art: "auskunft_erstellt", entitaet: "kontaktperson", text: `Akteur ${ZEILE.akteurId}` });
    expect(e.text).not.toContain("Petra");
  });
  it("Eingabe: Name Pflicht, Laengen, E-Mail-Form; Umhaengen gibt es nicht (akteur_id wird nie gesetzt)", async () => {
    rolle = "bearbeiter";
    expect((await kontaktpersonAnlegen(ZEILE.akteurId, fd({ name: " " }))).fehler).toBe("Name ist Pflicht.");
    expect((await kontaktpersonAnlegen(ZEILE.akteurId, fd({ name: "x".repeat(201) }))).fehler).toMatch(/höchstens 200/);
    expect((await kontaktpersonAnlegen(ZEILE.akteurId, fd({ name: "N", mail_dienstlich: "keine-mail" }))).fehler).toMatch(/ungültig/);
    expect((await kontaktpersonAnlegen(ZEILE.akteurId, fd({ name: "N", notiz: "n".repeat(1001) }))).fehler).toMatch(/höchstens 1000/);
  });
});
