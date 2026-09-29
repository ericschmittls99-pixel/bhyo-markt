import { beforeEach, describe, expect, it, vi } from "vitest";

// AP2.2 PR b: Die Zustellung haengt an protokolliere — hier nur aufgezeichnet.
const zustellen = vi.fn(async (_tx: unknown, _e: unknown) => 0);
vi.mock("@/lib/inbox/zustellung", () => ({ zustellen }));

const { protokolliere, STANDARDTEXT } = await import("./index");
type Ereignis = import("./index").Ereignis;

const EREIGNIS_ID = "00000000-0000-4000-8000-0000000000ee";
function attrappe() {
  const zeilen: Record<string, unknown>[] = [];
  const tx = {
    insert: () => ({
      values: (w: Record<string, unknown>) => {
        zeilen.push(w);
        return { returning: async () => [{ id: EREIGNIS_ID }] };
      },
    }),
    select: () => { throw new Error("kein select erwartet"); },
  };
  return { tx: tx as unknown as Parameters<typeof protokolliere>[0], zeilen };
}

beforeEach(() => zustellen.mockClear());

const BASIS: Ereignis = {
  art: "gesperrt",
  entitaet: "biomassestrom",
  id: "00000000-0000-4000-8000-000000000001",
  benutzerId: "00000000-0000-4000-8000-0000000000e1",
  benutzerEmail: "petra@bhyo.de",
};

describe("protokolliere", () => {
  it("schreibt genau eine Zeile mit Art, Objektbezug, Urheber-ID und -E-Mail", async () => {
    const { tx, zeilen } = attrappe();
    await protokolliere(tx, BASIS);
    expect(zeilen).toEqual([
      {
        entitaetTyp: "biomassestrom",
        entitaetId: BASIS.id,
        art: "gesperrt",
        benutzerId: BASIS.benutzerId,
        benutzerEmail: "petra@bhyo.de",
        text: `petra@bhyo.de: ${STANDARDTEXT.gesperrt}`,
      },
    ]);
  });

  it("nimmt den Freitext, sonst den Standardtext der Art — Präfix bleibt für die Anzeige", async () => {
    const { tx, zeilen } = attrappe();
    await protokolliere(tx, { ...BASIS, art: "geaendert", text: "  Menge korrigiert " });
    await protokolliere(tx, { ...BASIS, art: "geaendert", text: "   " });
    expect(zeilen.map((z) => z.text)).toEqual(["petra@bhyo.de: Menge korrigiert", "petra@bhyo.de: Geändert"]);
  });

  it("weist altbestand und Ereignisse ohne Urheber ab, ohne zu schreiben", async () => {
    const { tx, zeilen } = attrappe();
    await expect(protokolliere(tx, { ...BASIS, art: "altbestand" as never })).rejects.toThrow(/altbestand/);
    await expect(protokolliere(tx, { ...BASIS, benutzerId: "" })).rejects.toThrow(/Urheber/);
    expect(zeilen).toEqual([]);
  });

  it("schreibt über die übergebene Transaktion, nie über eine eigene Verbindung", async () => {
    // Rollback = kein Ereignis: Das gilt nur, wenn das Ereignis in der Transaktion
    // des Schreibpfads landet. Die Attrappe ist die einzige Verbindung, die es gibt.
    const { tx, zeilen } = attrappe();
    await expect(protokolliere(tx, BASIS)).resolves.toEqual({ id: EREIGNIS_ID });
    expect(zeilen).toHaveLength(1);
  });

  it("stellt in derselben Transaktion zu — mit der Ereignis-ID, Art, Objektbezug und Auslöser (AP2.2)", async () => {
    const { tx } = attrappe();
    await protokolliere(tx, { ...BASIS, art: "geaendert" });
    expect(zustellen).toHaveBeenCalledTimes(1);
    expect(zustellen.mock.calls[0]![0]).toBe(tx);
    expect(zustellen.mock.calls[0]![1]).toEqual({
      id: EREIGNIS_ID,
      art: "geaendert",
      entitaet: "biomassestrom",
      entitaetId: BASIS.id,
      ausloeserId: BASIS.benutzerId,
    });
  });
});
