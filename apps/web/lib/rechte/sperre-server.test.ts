import { describe, expect, it } from "vitest";

import { Gesperrt, pruefeBelegSperre, pruefeStromSperre, type Tx } from "./sperre-server";
import type { Rolle, Zugang } from "./rollen";

/**
 * E44: Objektstufe mit einer nachgebauten Transaktion — die Zeile wird
 * gelesen (FOR UPDATE), die Matrix entscheidet, der Fehlertext nennt den
 * Inhaber. Die Datenbank ist hier ein Skript: erst die Stromzeile, dann die
 * Zuweisungen; bei pruefeBelegSperre zuerst die referenzierenden Zeilen.
 */
const ICH = "00000000-0000-4000-8000-000000000001";
const ANDERE = "00000000-0000-4000-8000-000000000002";
const DRITTE = "00000000-0000-4000-8000-000000000003";

function zugang(rolle: Rolle, id = ICH): Extract<Zugang, { art: "erlaubt" }> {
  return { art: "erlaubt", id, email: "ich@bhyo.de", rolle, name: "Ich" };
}

/** Fake-Transaktion: jede Abfrage nimmt das naechste Ergebnis aus dem Skript. */
function fakeTx(skript: unknown[][]): Tx & { aufrufe: string[] } {
  const aufrufe: string[] = [];
  const naechstes = () => skript.shift() ?? [];
  const kette = (name: string): unknown => {
    aufrufe.push(name);
    const p: Record<string, unknown> = {};
    for (const m of ["from", "leftJoin", "where", "for", "limit", "select", "set", "returning"]) {
      p[m] = () => kette(m);
    }
    // thenable: Abfrage ausfuehren
    (p as { then: unknown }).then = (res: (v: unknown) => void) => res(naechstes());
    return p;
  };
  const tx = {
    aufrufe,
    select: () => kette("select"),
    delete: () => kette("delete"),
    update: () => kette("update"),
    insert: () => kette("insert"),
  };
  return tx as unknown as Tx & { aufrufe: string[] };
}

const zeile = (gesperrtVon: string | null, name = "Petra Prüfer") => ({
  gesperrtVon,
  gesperrtAm: gesperrtVon ? new Date("2026-09-28T10:00:00Z") : null,
  inhaberName: gesperrtVon ? name : null,
  inhaberEmail: gesperrtVon ? "petra@bhyo.de" : null,
});

describe("pruefeStromSperre", () => {
  it("ungesperrt: jeder mit Rollenstufe darf; die Zeile wird mit FOR UPDATE gehalten", async () => {
    const tx = fakeTx([[zeile(null)], []]);
    await expect(pruefeStromSperre(tx, zugang("bearbeiter"), "strom.bearbeiten", "biomasse", "s1")).resolves.toMatchObject({
      gesperrtVon: null,
    });
    expect(tx.aufrufe).toContain("for");
  });
  it("gesperrt von einer anderen Person: fremder Bearbeiter wird mit klarer Meldung abgewiesen", async () => {
    const tx = fakeTx([[zeile(ANDERE)], []]);
    await expect(pruefeStromSperre(tx, zugang("bearbeiter"), "strom.status_setzen", "biomasse", "s1")).rejects.toThrow(
      "Gesperrt von Petra Prüfer.",
    );
    await expect(pruefeStromSperre(fakeTx([[zeile(ANDERE)], []]), zugang("bearbeiter"), "strom.verwerfen", "output", "s1")).rejects.toBeInstanceOf(
      Gesperrt,
    );
  });
  it("Sperrinhaber, Zugewiesene und admin duerfen weiter bearbeiten", async () => {
    await expect(pruefeStromSperre(fakeTx([[zeile(ICH)], []]), zugang("pruefer"), "strom.bearbeiten", "biomasse", "s1")).resolves.toBeTruthy();
    await expect(
      pruefeStromSperre(fakeTx([[zeile(ANDERE)], [{ nutzerId: ICH }]]), zugang("bearbeiter"), "strom.bearbeiten", "biomasse", "s1"),
    ).resolves.toMatchObject({ zugewiesene: [ICH] });
    await expect(pruefeStromSperre(fakeTx([[zeile(ANDERE)], []]), zugang("admin"), "strom.bearbeiten", "biomasse", "s1")).resolves.toBeTruthy();
  });
  it("sperren nur, wenn frei; entsperren nur als Inhaber (pruefer) oder admin", async () => {
    await expect(pruefeStromSperre(fakeTx([[zeile(ANDERE)], []]), zugang("pruefer"), "strom.sperren", "biomasse", "s1")).rejects.toThrow("Gesperrt von");
    await expect(pruefeStromSperre(fakeTx([[zeile(ICH)], []]), zugang("bearbeiter"), "strom.entsperren", "biomasse", "s1")).rejects.toThrow("Gesperrt von");
    await expect(pruefeStromSperre(fakeTx([[zeile(ICH)], []]), zugang("pruefer"), "strom.entsperren", "biomasse", "s1")).resolves.toBeTruthy();
    await expect(pruefeStromSperre(fakeTx([[zeile(ANDERE)], []]), zugang("admin"), "strom.entsperren", "biomasse", "s1")).resolves.toBeTruthy();
  });
  it("fehlender Strom: klarer Fehler statt stillem Durchwinken", async () => {
    await expect(pruefeStromSperre(fakeTx([[]]), zugang("admin"), "strom.bearbeiten", "biomasse", "weg")).rejects.toThrow("Datensatz nicht gefunden.");
  });
});

describe("pruefeBelegSperre (geteilte Belege)", () => {
  it("ein referenzierender Strom ist von jemand anderem gesperrt: der Beleg darf nicht geaendert werden", async () => {
    // Skript: Referenzen biomasse [s1], Referenzen output [], dann Sperre s1 + Zuweisungen.
    const tx = fakeTx([[{ id: "s1" }], [], [zeile(ANDERE)], []]);
    await expect(pruefeBelegSperre(tx, zugang("bearbeiter"), "b1")).rejects.toThrow(
      "Der Beleg gehört auch zu einem Strom, der von Petra Prüfer gesperrt ist.",
    );
  });
  it("referenzierende Stroeme frei oder fuer mich offen (Zuweisung): erlaubt", async () => {
    await expect(pruefeBelegSperre(fakeTx([[{ id: "s1" }], [{ id: "o1" }], [zeile(null)], [], [zeile(ANDERE)], [{ nutzerId: ICH }]]), zugang("bearbeiter"), "b1")).resolves.toBeUndefined();
    await expect(pruefeBelegSperre(fakeTx([[], []]), zugang("bearbeiter"), "b1")).resolves.toBeUndefined();
  });
  it("admin darf auch bei fremder Sperre", async () => {
    await expect(pruefeBelegSperre(fakeTx([[{ id: "s1" }], [], [zeile(DRITTE)], []]), zugang("admin"), "b1")).resolves.toBeUndefined();
  });
});
