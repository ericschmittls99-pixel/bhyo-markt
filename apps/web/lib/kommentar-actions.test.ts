/**
 * AP2.6 PR a (E71): Die Actions setzen die Wache am Eingang durch — ein
 * Betrachter kommt mit keiner der drei Aktionen durch, bevor eine Transaktion
 * beginnt. Der Baustein selbst ist in kommentar-schreibweg.test.ts geprueft.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rolle: "betrachter" | "bearbeiter" | "pruefer" | "admin" = "betrachter";
let transaktionen = 0;
const ICH = "00000000-0000-4000-8000-000000000001";
const AKTEUR = "00000000-0000-4000-8000-0000000000bb";

vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => "ich@bhyo.de",
  withDb: async (fn: (db: unknown) => unknown) => {
    const kette = (): unknown => {
      const p: Record<string, unknown> = {};
      for (const m of ["from", "where", "limit"]) p[m] = () => kette();
      (p as { then: unknown }).then = (res: (v: unknown) => void) => res([{ id: ICH, rolle, aktiv: true, email: "ich@bhyo.de", name: "Ich" }]);
      return p;
    };
    return fn({
      select: () => kette(),
      transaction: async () => {
        transaktionen += 1;
        throw new Error("Transaktion nicht erwartet");
      },
    });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { kommentarBearbeiten, kommentarErstellen, kommentarLoeschen } = await import("./kommentar-actions");

beforeEach(() => {
  rolle = "betrachter";
  transaktionen = 0;
});

describe("Kommentar-Actions: Wache am Eingang (E42/E71)", () => {
  it("ein Betrachter wird bei erstellen, bearbeiten und loeschen abgewiesen — ohne Transaktion", async () => {
    const fd = new FormData();
    fd.set("text", "Hallo");
    for (const lauf of [() => kommentarErstellen({ art: "akteur", id: AKTEUR }, fd), () => kommentarBearbeiten(AKTEUR, fd), () => kommentarLoeschen(AKTEUR)]) {
      const erg = await lauf();
      expect(erg.ok).toBe(false);
      expect(erg.fehler).toBe("Für diese Aktion fehlt das Schreibrecht.");
    }
    expect(transaktionen).toBe(0);
  });
  it("ein Bearbeiter kommt durch die Wache und erreicht die Transaktion; ein ungueltiger Bezug wird davor abgewiesen", async () => {
    rolle = "bearbeiter";
    const fd = new FormData();
    fd.set("text", "Hallo");
    expect(await kommentarErstellen({ art: "beleg", id: AKTEUR } as never, fd)).toEqual({ ok: false, fehler: "Ungültiger Bezug." });
    expect(transaktionen).toBe(0);
    const erg = await kommentarErstellen({ art: "akteur", id: AKTEUR }, fd);
    expect(erg).toEqual({ ok: false, fehler: "Transaktion nicht erwartet" });
    expect(transaktionen).toBe(1);
  });
});
