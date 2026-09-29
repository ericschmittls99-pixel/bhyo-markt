/**
 * Zustellung: je Empfaenger ein Upsert auf dem Buendelungsschluessel, in der
 * uebergebenen Transaktion; nichts fuer Arten ausserhalb des Registers.
 */
import { describe, expect, it } from "vitest";

import { zustellen } from "./zustellung";

const AUSLOESER = "00000000-0000-4000-8000-0000000000a1";
const ERSTELLER = "00000000-0000-4000-8000-0000000000a2";
const BEARBEITER = "00000000-0000-4000-8000-0000000000a3";
const BETRACHTER = "00000000-0000-4000-8000-0000000000a4";
const STROM = "00000000-0000-4000-8000-0000000000c1";
const EREIGNIS = "00000000-0000-4000-8000-0000000000e1";

function attrappe() {
  const upserts: { werte: Record<string, unknown>; konflikt: Record<string, unknown> }[] = [];
  let leser = 0;
  const protokoll = [
    { art: "angelegt", benutzerId: ERSTELLER, zeitpunkt: new Date(1) },
    { art: "geaendert", benutzerId: BEARBEITER, zeitpunkt: new Date(2) },
    { art: "geaendert", benutzerId: BETRACHTER, zeitpunkt: new Date(3) },
    { art: "geaendert", benutzerId: AUSLOESER, zeitpunkt: new Date(4) },
  ];
  const benutzer = [
    { id: ERSTELLER, rolle: "bearbeiter", aktiv: true },
    { id: BEARBEITER, rolle: "pruefer", aktiv: true },
    { id: BETRACHTER, rolle: "betrachter", aktiv: true },
    { id: AUSLOESER, rolle: "bearbeiter", aktiv: true },
  ];
  const kette = (zeilen: unknown[]) => ({ from: () => ({ where: async () => zeilen }) });
  const tx = {
    // Erst das Protokoll des Stroms, dann die Benutzer der Beteiligten.
    select: () => kette(leser++ === 0 ? protokoll : benutzer),
    insert: () => ({
      values: (werte: Record<string, unknown>) => ({
        onConflictDoUpdate: async (konflikt: Record<string, unknown>) => {
          upserts.push({ werte, konflikt });
        },
      }),
    }),
  };
  return { tx: tx as unknown as Parameters<typeof zustellen>[0], upserts };
}

describe("zustellen", () => {
  it("stellt an alle Beteiligten ausser Ausloeser und Betrachter zu — ein Upsert je Empfaenger", async () => {
    const { tx, upserts } = attrappe();
    const n = await zustellen(tx, { id: EREIGNIS, art: "geaendert", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: AUSLOESER });
    expect(n).toBe(2);
    expect(upserts.map((u) => u.werte.empfaengerId)).toEqual([ERSTELLER, BEARBEITER]);
    expect(upserts[0]!.werte).toMatchObject({
      ausloeserId: AUSLOESER,
      typ: "aenderung_eintrag",
      biomassestromId: STROM,
      ereignisId: EREIGNIS,
      anzahl: 1,
      zustand: "offen",
    });
    // Buendelung: Konflikt auf (Empfaenger, Strom) => anzahl + 1, neu ungelesen.
    const set = upserts[0]!.konflikt.set as Record<string, unknown>;
    expect(set.gelesenAm).toBeNull();
    expect(set.ausloeserId).toBe(AUSLOESER);
    expect(set.ereignisId).toBe(EREIGNIS);
    expect(set.anzahl).toBeDefined();
  });
  it("Output-Bedarf laeuft ueber die Output-Spalte", async () => {
    const { tx, upserts } = attrappe();
    await zustellen(tx, { id: EREIGNIS, art: "status_gesetzt", entitaet: "output_bedarf", entitaetId: STROM, ausloeserId: AUSLOESER });
    expect(upserts[0]!.werte.outputBedarfId).toBe(STROM);
    expect(upserts[0]!.werte.biomassestromId).toBeUndefined();
  });
  it("Arten ausserhalb des Registers und Nicht-Stroeme stellen nichts zu", async () => {
    const { tx, upserts } = attrappe();
    expect(await zustellen(tx, { id: EREIGNIS, art: "gesperrt", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: AUSLOESER })).toBe(0);
    expect(await zustellen(tx, { id: EREIGNIS, art: "angelegt", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: AUSLOESER })).toBe(0);
    expect(await zustellen(tx, { id: EREIGNIS, art: "geaendert", entitaet: "benutzer", entitaetId: STROM, ausloeserId: AUSLOESER })).toBe(0);
    expect(upserts).toEqual([]);
  });
});
