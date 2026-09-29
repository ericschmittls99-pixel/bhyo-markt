/**
 * PR c: Zugriffsanfrage & Freischaltung in der Zustellung — Empfaenger-
 * Umleitung auf Admins, zwei Anfragende = zwei Eintraege (eigener
 * Buendelungsschluessel), Freischaltung und Ablehnung an die betroffene
 * Person, Abraeumen bei ALLEN Empfaengern (Zuweisen, Ablehnen, Entsperren).
 */
import { describe, expect, it } from "vitest";

import { zustellen } from "./zustellung";

const PETRA = "00000000-0000-4000-8000-0000000000a1"; // Sperrinhaberin (pruefer)
const ADMIN1 = "00000000-0000-4000-8000-0000000000a2";
const ADMIN2 = "00000000-0000-4000-8000-0000000000a3";
const BERND = "00000000-0000-4000-8000-0000000000b1"; // Anfragender
const CARLA = "00000000-0000-4000-8000-0000000000b2"; // zweite Anfragende
const STROM = "00000000-0000-4000-8000-0000000000c1";
const EREIGNIS = "00000000-0000-4000-8000-0000000000e1";

interface Attrappe {
  inhaber: { gesperrtVon: string | null; rolle: string | null; aktiv: boolean | null };
  admins: { id: string }[];
}
function attrappe(a: Attrappe) {
  const upserts: { werte: Record<string, unknown>; konflikt?: Record<string, unknown> }[] = [];
  const abgeraeumt: { set: Record<string, unknown> }[] = [];
  const selectKette = (zeilen: unknown[]) => {
    const p: Record<string, unknown> = {};
    for (const m of ["from", "leftJoin", "where"]) p[m] = () => selectKette(zeilen);
    (p as { then: unknown }).then = (res: (v: unknown) => void) => res(zeilen);
    return p;
  };
  let lesung = 0;
  const tx = {
    // Erst der Strom mit Inhaber (leftJoin), dann ggf. die Admins.
    select: () => selectKette(lesung++ === 0 ? [a.inhaber] : a.admins),
    insert: () => ({
      values: (werte: Record<string, unknown>) => {
        const p = Promise.resolve(undefined) as Promise<unknown> & Record<string, unknown>;
        upserts.push({ werte });
        p.onConflictDoUpdate = async (konflikt: Record<string, unknown>) => {
          upserts[upserts.length - 1]!.konflikt = konflikt;
        };
        return p;
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => ({ returning: async () => { abgeraeumt.push({ set }); return [{ id: "x" }]; } }),
      }),
    }),
  };
  return { tx: tx as unknown as Parameters<typeof zustellen>[0], upserts, abgeraeumt };
}
const gesperrtVonPetra = { gesperrtVon: PETRA, rolle: "pruefer", aktiv: true };

describe("Zugriffsanfrage", () => {
  it("geht an den Sperrinhaber, mit Notiz, eigener Buendelungsschluessel (Empfaenger, Strom, Anfragender)", async () => {
    const { tx, upserts } = attrappe({ inhaber: gesperrtVonPetra, admins: [] });
    const n = await zustellen(tx, { id: EREIGNIS, art: "zugriff_angefragt", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: BERND, text: "Bitte kurz freigeben" });
    expect(n).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.werte).toMatchObject({ empfaengerId: PETRA, ausloeserId: BERND, typ: "zugriffsanfrage", biomassestromId: STROM, notiz: "Bitte kurz freigeben" });
    expect((upserts[0]!.konflikt!.target as unknown[]).length).toBe(3);
  });
  it("Umleitung: ist der Inhaber kein Pruefer mehr oder deaktiviert, an alle aktiven Admins", async () => {
    for (const inhaber of [
      { gesperrtVon: PETRA, rolle: "bearbeiter", aktiv: true },
      { gesperrtVon: PETRA, rolle: "pruefer", aktiv: false },
    ]) {
      const { tx, upserts } = attrappe({ inhaber, admins: [{ id: ADMIN1 }, { id: ADMIN2 }] });
      expect(await zustellen(tx, { id: EREIGNIS, art: "zugriff_angefragt", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: BERND })).toBe(2);
      expect(upserts.map((u) => u.werte.empfaengerId)).toEqual([ADMIN1, ADMIN2]);
    }
  });
  it("zwei Anfragende = zwei Eintraege beim selben Empfaenger (Schluessel enthaelt den Ausloeser)", async () => {
    const a = attrappe({ inhaber: gesperrtVonPetra, admins: [] });
    await zustellen(a.tx, { id: EREIGNIS, art: "zugriff_angefragt", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: BERND });
    const b = attrappe({ inhaber: gesperrtVonPetra, admins: [] });
    await zustellen(b.tx, { id: EREIGNIS, art: "zugriff_angefragt", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: CARLA });
    expect(a.upserts[0]!.werte.ausloeserId).toBe(BERND);
    expect(b.upserts[0]!.werte.ausloeserId).toBe(CARLA);
    expect(a.upserts[0]!.werte.empfaengerId).toBe(b.upserts[0]!.werte.empfaengerId);
  });
});

describe("Freischaltung, Ablehnung, Abraeumen", () => {
  it("Zuweisen: Freischaltung an den Zugewiesenen, seine Anfragen bei ALLEN Empfaengern erledigt", async () => {
    const { tx, upserts, abgeraeumt } = attrappe({ inhaber: gesperrtVonPetra, admins: [] });
    expect(await zustellen(tx, { id: EREIGNIS, art: "zugewiesen", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: PETRA, betrifftId: BERND })).toBe(1);
    expect(upserts[0]!.werte).toMatchObject({ empfaengerId: BERND, typ: "freischaltung", ausloeserId: PETRA });
    expect(upserts[0]!.konflikt).toBeUndefined(); // keine Buendelung
    expect(abgeraeumt).toHaveLength(1);
    expect(abgeraeumt[0]!.set).toMatchObject({ zustand: "erledigt" });
  });
  it("Ablehnen: Antwort an den Anfragenden, seine Anfragen erledigt", async () => {
    const { tx, upserts, abgeraeumt } = attrappe({ inhaber: gesperrtVonPetra, admins: [] });
    expect(await zustellen(tx, { id: EREIGNIS, art: "zugriff_abgelehnt", entitaet: "output_bedarf", entitaetId: STROM, ausloeserId: PETRA, betrifftId: BERND })).toBe(1);
    expect(upserts[0]!.werte).toMatchObject({ empfaengerId: BERND, typ: "zugriff_abgelehnt", outputBedarfId: STROM });
    expect(abgeraeumt).toHaveLength(1);
  });
  it("Entsperren raeumt alle offenen Anfragen zum Strom ab, ohne Mitteilung", async () => {
    const { tx, upserts, abgeraeumt } = attrappe({ inhaber: gesperrtVonPetra, admins: [] });
    expect(await zustellen(tx, { id: EREIGNIS, art: "entsperrt", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: PETRA })).toBe(0);
    expect(upserts).toEqual([]);
    expect(abgeraeumt).toHaveLength(1);
  });
  it("Freischaltung nie an den Ausloeser selbst, ohne betroffene Person nichts", async () => {
    const { tx, upserts } = attrappe({ inhaber: gesperrtVonPetra, admins: [] });
    expect(await zustellen(tx, { id: EREIGNIS, art: "zugewiesen", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: PETRA, betrifftId: PETRA })).toBe(0);
    expect(await zustellen(tx, { id: EREIGNIS, art: "zugewiesen", entitaet: "biomassestrom", entitaetId: STROM, ausloeserId: PETRA })).toBe(0);
    expect(upserts).toEqual([]);
  });
});
