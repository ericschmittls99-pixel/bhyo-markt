/**
 * AP2.6 PR c (E71): Zustellung eines Kommentar-Ereignisses — je Kommentar
 * und Empfaenger ein Eintrag (kein Upsert), Erwaehnte bekommen nur
 * erwaehnung, Verantwortliche und bisherige Kommentatoren kommentar, der
 * Autor nichts, Betrachter und Deaktivierte nichts; beim Bearbeiten nur
 * erwaehnung fuer die neu Erwaehnten. Datenbank als tabellenbewusste Attrappe,
 * Register und Ableitung echt.
 */
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { zustellen } from "./zustellung";

const AUTOR = "00000000-0000-4000-8000-0000000000a1";
const ERSTELLER = "00000000-0000-4000-8000-0000000000a2";
const SPERRINHABER = "00000000-0000-4000-8000-0000000000a3";
const ZUGEWIESEN = "00000000-0000-4000-8000-0000000000a4";
const KOMMENTATOR = "00000000-0000-4000-8000-0000000000a5";
const BETRACHTER = "00000000-0000-4000-8000-0000000000a6";
const INAKTIV = "00000000-0000-4000-8000-0000000000a7";
const ERWAEHNT = "00000000-0000-4000-8000-0000000000a8";
const STROM = "00000000-0000-4000-8000-0000000000c1";
const AKTEUR = "00000000-0000-4000-8000-0000000000d1";
const KOMMENTAR = "00000000-0000-4000-8000-0000000000f1";
const EREIGNIS = "00000000-0000-4000-8000-0000000000e1";

function attrappe(bezug: "strom" | "akteur") {
  const inserts: Record<string, unknown>[] = [];
  const tabellen: Record<string, unknown[]> = {
    kommentar: [
      // der gerade geschriebene Kommentar
      { id: KOMMENTAR, biomassestromId: bezug === "strom" ? STROM : null, outputBedarfId: null, akteurId: bezug === "akteur" ? AKTEUR : null, autorId: AUTOR },
      // ein frueherer Kommentar eines anderen Nutzers (bisheriger Kommentator) und einer vom Betrachter
      { id: "k-alt", autorId: KOMMENTATOR },
      { id: "k-betr", autorId: BETRACHTER },
    ],
    aenderung:
      bezug === "strom"
        ? [
            { art: "angelegt", benutzerId: ERSTELLER, zeitpunkt: new Date(1) },
            { art: "gesperrt", benutzerId: SPERRINHABER, zeitpunkt: new Date(2) }, // Sperren zaehlt nicht als Beteiligung
            { art: "geaendert", benutzerId: INAKTIV, zeitpunkt: new Date(3) },
          ]
        : [
            { art: "akteur_angelegt", benutzerId: ERSTELLER, zeitpunkt: new Date(1) },
            { art: "akteur_geaendert", benutzerId: INAKTIV, zeitpunkt: new Date(2) },
          ],
    biomassestrom: [{ gesperrtVon: SPERRINHABER }],
    strom_zuweisung: [{ nutzerId: ZUGEWIESEN }],
    benutzer: [
      { id: AUTOR, rolle: "bearbeiter", aktiv: true },
      { id: ERSTELLER, rolle: "bearbeiter", aktiv: true },
      { id: SPERRINHABER, rolle: "pruefer", aktiv: true },
      { id: ZUGEWIESEN, rolle: "bearbeiter", aktiv: true },
      { id: KOMMENTATOR, rolle: "pruefer", aktiv: true },
      { id: BETRACHTER, rolle: "betrachter", aktiv: true },
      { id: INAKTIV, rolle: "admin", aktiv: false },
      { id: ERWAEHNT, rolle: "admin", aktiv: true },
    ],
  };
  const kette = (rows: unknown[]) => {
    const k: Record<string, unknown> = {};
    for (const m of ["where", "limit", "for"]) k[m] = () => k;
    k.then = (res: (v: unknown) => void) => res(rows);
    return k;
  };
  const tx = {
    select: () => ({
      from: (t: unknown) => {
        const name = getTableName(t as never);
        if (!(name in tabellen)) throw new Error(`unerwartete Tabelle ${name}`);
        // Die Kommentar-Abfrage nach dem eigenen Kommentar kommt zuerst (eine Zeile), die der Kommentatoren danach (alle ausser dem eigenen).
        if (name === "kommentar") {
          const rows = tabellen.kommentar!;
          return kette(kommentarLesung++ === 0 ? [rows[0]] : rows.slice(1));
        }
        return kette(tabellen[name]!);
      },
    }),
    insert: () => ({ values: async (werte: Record<string, unknown>) => void inserts.push(werte) }),
  };
  let kommentarLesung = 0;
  return { tx: tx as unknown as Parameters<typeof zustellen>[0], inserts };
}

const erstellt = (erwaehnteIds: string[]) => ({
  id: EREIGNIS,
  art: "kommentar_erstellt" as const,
  entitaet: "kommentar" as const,
  entitaetId: KOMMENTAR,
  ausloeserId: AUTOR,
  erwaehnteIds,
});

describe("E71 Zustellung Kommentar (Strom)", () => {
  it("erstellt: Erwaehnte bekommen nur erwaehnung; Ersteller, Sperrinhaber, Zugewiesener, bisheriger Kommentator bekommen kommentar; Autor, Betrachter, Deaktivierte nichts", async () => {
    const { tx, inserts } = attrappe("strom");
    const n = await zustellen(tx, erstellt([ERWAEHNT, SPERRINHABER, AUTOR]));
    const je = Object.fromEntries(inserts.map((i) => [i.empfaengerId as string, i.typ]));
    expect(je).toEqual({
      [ERWAEHNT]: "erwaehnung",
      [SPERRINHABER]: "erwaehnung", // erwaehnt UND verantwortlich → nur die Erwaehnung (D6, keine Doppelzustellung)
      [ERSTELLER]: "kommentar",
      [ZUGEWIESEN]: "kommentar",
      [KOMMENTATOR]: "kommentar",
    });
    expect(n).toBe(5);
    expect(inserts.every((i) => i.kommentarId === KOMMENTAR && i.ereignisId === EREIGNIS && i.ausloeserId === AUTOR && i.anzahl === 1 && i.zustand === "offen")).toBe(true);
    expect(inserts.every((i) => !("biomassestromId" in i))).toBe(true);
  });
  it("Autor erhaelt nichts — auch nicht, wenn er sich selbst erwaehnt; ohne Erwaehnung nur kommentar", async () => {
    const { tx, inserts } = attrappe("strom");
    await zustellen(tx, erstellt([AUTOR]));
    expect(inserts.map((i) => i.empfaengerId)).not.toContain(AUTOR);
    expect(inserts.every((i) => i.typ === "kommentar")).toBe(true);
  });
  it("bearbeitet: nur erwaehnung fuer die neu Erwaehnten, keine kommentar-Eintraege", async () => {
    const { tx, inserts } = attrappe("strom");
    const n = await zustellen(tx, { ...erstellt([ERWAEHNT]), art: "kommentar_bearbeitet" });
    expect(n).toBe(1);
    expect(inserts).toEqual([expect.objectContaining({ empfaengerId: ERWAEHNT, typ: "erwaehnung", kommentarId: KOMMENTAR })]);
  });
  it("geloescht: keine Zustellung", async () => {
    const { tx, inserts } = attrappe("strom");
    expect(await zustellen(tx, { ...erstellt([ERWAEHNT]), art: "kommentar_geloescht" })).toBe(0);
    expect(inserts).toEqual([]);
  });
});

describe("E71 Zustellung Kommentar (Akteur)", () => {
  it("Verantwortliche des Akteurs sind die Urheber seiner Protokollereignisse; Deaktivierte und Betrachter fallen heraus", async () => {
    const { tx, inserts } = attrappe("akteur");
    await zustellen(tx, erstellt([]));
    expect(Object.fromEntries(inserts.map((i) => [i.empfaengerId as string, i.typ]))).toEqual({
      [ERSTELLER]: "kommentar",
      [KOMMENTATOR]: "kommentar",
    });
  });
});
