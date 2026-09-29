import { describe, expect, it } from "vitest";

import { protokolliere, STANDARDTEXT, type Ereignis } from "./index";

function attrappe() {
  const zeilen: Record<string, unknown>[] = [];
  const tx = { insert: () => ({ values: async (w: Record<string, unknown>) => { zeilen.push(w); } }) };
  return { tx: tx as unknown as Parameters<typeof protokolliere>[0], zeilen };
}

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
    await protokolliere(tx, BASIS);
    expect(zeilen).toHaveLength(1);
  });
});
