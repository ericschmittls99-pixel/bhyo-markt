/**
 * Zustellung: je Empfaenger ein Upsert auf dem Buendelungsschluessel, in der
 * uebergebenen Transaktion; nichts fuer Arten ausserhalb des Registers.
 */
import { describe, expect, it } from "vitest";

import { auftraggeberAus, zustellen } from "./zustellung";

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

// AP2.4 PR a (E62): Pruefauftrag, Rueckmeldung, Abraeumen, keine Doppel-Eintraege (D6).
const PRUEFER2 = "00000000-0000-4000-8000-0000000000a5";
const ADMIN = "00000000-0000-4000-8000-0000000000a6";

/** Attrappe mit vorgegebener Antwortfolge je select() und Aufzeichnung der updates. */
function attrappe2(antworten: unknown[][]) {
  const upserts: { werte: Record<string, unknown> }[] = [];
  const updates: { set: Record<string, unknown> }[] = [];
  let i = 0;
  const kette = (zeilen: unknown[]) => ({
    from: () => ({ where: async () => zeilen, leftJoin: () => ({ where: async () => zeilen }) }),
  });
  const tx = {
    select: () => kette(antworten[i++] ?? []),
    insert: () => ({
      // Ein Thenable, KEIN natives Promise: `await` ruft bei einem nativen
      // Promise dessen eigenes then nicht auf (PromiseResolve-Abkuerzung).
      values: (werte: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          upserts.push({ werte });
        },
        then: (res: (v: unknown) => void) => {
          upserts.push({ werte });
          res(undefined);
        },
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updates.push({ set });
            return [{ id: "x" }];
          },
        }),
      }),
    }),
  };
  return { tx: tx as unknown as Parameters<typeof zustellen>[0], upserts, updates };
}

const PRUEFER_LISTE = [{ id: BEARBEITER }, { id: PRUEFER2 }, { id: ADMIN }];

describe("zustellen — Pruefauftrag (E62)", () => {
  it("in_pruefung_gegeben: pruefauftrag an alle aktiven Pruefer/Admins ausser dem Ausloeser, dann aenderung_eintrag an die uebrigen Beteiligten", async () => {
    const protokoll = [
      { art: "angelegt", benutzerId: ERSTELLER, zeitpunkt: new Date(1) },
      { art: "geaendert", benutzerId: BEARBEITER, zeitpunkt: new Date(2) },
      { art: "in_pruefung_gegeben", benutzerId: AUSLOESER, zeitpunkt: new Date(3) },
    ];
    const benutzer = [
      { id: ERSTELLER, rolle: "bearbeiter", aktiv: true },
      { id: BEARBEITER, rolle: "pruefer", aktiv: true },
      { id: AUSLOESER, rolle: "bearbeiter", aktiv: true },
    ];
    const { tx, upserts } = attrappe2([PRUEFER_LISTE, protokoll, benutzer]);
    const n = await zustellen(tx, { id: EREIGNIS, art: "in_pruefung_gegeben", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: AUSLOESER });
    expect(n).toBe(4);
    expect(upserts.map((u) => [u.werte.typ, u.werte.empfaengerId])).toEqual([
      ["pruefauftrag", BEARBEITER],
      ["pruefauftrag", PRUEFER2],
      ["pruefauftrag", ADMIN],
      // D6: BEARBEITER ist beteiligt UND Pruefer — bekommt nur den pruefauftrag, keinen aenderung_eintrag.
      ["aenderung_eintrag", ERSTELLER],
    ]);
  });
  it("zurueckgesetzt loest denselben Pruefauftrag aus; ein Pruefer als Ausloeser bekommt keinen", async () => {
    const { tx, upserts } = attrappe2([PRUEFER_LISTE, [], []]);
    await zustellen(tx, { id: EREIGNIS, art: "zurueckgesetzt", entitaet: "output_bedarf", entitaetId: STROM, ausloeserId: PRUEFER2 });
    expect(upserts.map((u) => [u.werte.typ, u.werte.empfaengerId, u.werte.outputBedarfId])).toEqual([
      ["pruefauftrag", BEARBEITER, STROM],
      ["pruefauftrag", ADMIN, STROM],
    ]);
  });
  it("geprueft: raeumt den Pruefauftrag bei allen ab, meldet dem Auftraggeber (pruefung_erledigt) und informiert die uebrigen Beteiligten", async () => {
    const protokoll = [
      { art: "angelegt", benutzerId: ERSTELLER, zeitpunkt: new Date(1) },
      { art: "in_pruefung_gegeben", benutzerId: BEARBEITER, zeitpunkt: new Date(2) },
      { art: "geprueft", benutzerId: AUSLOESER, zeitpunkt: new Date(3) },
    ];
    const benutzer = [
      { id: ERSTELLER, rolle: "bearbeiter", aktiv: true },
      { id: BEARBEITER, rolle: "bearbeiter", aktiv: true },
      { id: AUSLOESER, rolle: "pruefer", aktiv: true },
    ];
    const { tx, upserts, updates } = attrappe2([protokoll, [benutzer[1]], protokoll, benutzer]);
    const n = await zustellen(tx, { id: EREIGNIS, art: "geprueft", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: AUSLOESER });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.set.zustand).toBe("erledigt");
    expect(n).toBe(2);
    expect(upserts.map((u) => [u.werte.typ, u.werte.empfaengerId])).toEqual([
      ["pruefung_erledigt", BEARBEITER],
      ["aenderung_eintrag", ERSTELLER],
    ]);
  });
  it("prueft der Auftraggeber selbst, gibt es keine Rueckmeldung; zurueckgegeben und verworfen raeumen ebenfalls ab", async () => {
    const protokoll = [{ art: "in_pruefung_gegeben", benutzerId: AUSLOESER, zeitpunkt: new Date(2) }];
    const { tx, upserts } = attrappe2([protokoll, [], protokoll, [{ id: AUSLOESER, rolle: "admin", aktiv: true }]]);
    expect(await zustellen(tx, { id: EREIGNIS, art: "geprueft", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: AUSLOESER })).toBe(0);
    expect(upserts).toEqual([]);
    for (const art of ["zurueckgegeben", "verworfen"] as const) {
      const a = attrappe2([[], []]);
      await zustellen(a.tx, { id: EREIGNIS, art, entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: AUSLOESER });
      expect(a.updates.map((u) => u.set.zustand)).toEqual(["erledigt"]);
    }
  });
  it("auftraggeberAus: Urheber des letzten in_pruefung_gegeben/zurueckgesetzt", () => {
    expect(
      auftraggeberAus([
        { art: "in_pruefung_gegeben", benutzerId: ERSTELLER, zeitpunkt: new Date(1) },
        { art: "zurueckgesetzt", benutzerId: BEARBEITER, zeitpunkt: new Date(5) },
        { art: "geprueft", benutzerId: AUSLOESER, zeitpunkt: new Date(6) },
      ]),
    ).toBe(BEARBEITER);
    expect(auftraggeberAus([{ art: "geaendert", benutzerId: ERSTELLER, zeitpunkt: new Date(1) }])).toBeNull();
  });
});
