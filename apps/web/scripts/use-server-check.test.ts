/**
 * Rot-Nachweis fuer scripts/use-server-check.ts: Testdateien in einem
 * Wegwerf-Ordner — eine saubere "use server"-Datei ist gruen, Konstante,
 * synchrone Funktion, Re-Export und Default-Export ohne async sind rot mit
 * Datei und Zeile; eine Datei ohne die Direktive darf alles exportieren;
 * Typ-Exporte stoeren nicht. Dazu der echte Baum apps/web: heute gruen.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { pruefeDatei, pruefeUseServer } from "./use-server-check";

const T = mkdtempSync(join(tmpdir(), "use-server-"));
afterAll(() => rmSync(T, { recursive: true, force: true }));

const schreibe = (rel: string, text: string) => {
  const p = join(T, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
};

describe("use-server-check", () => {
  it("saubere Datei: nur async-Funktionen und Typen → keine Luecke", () => {
    const text = '"use server";\n\nimport { x } from "./x";\n\nexport type Erg = { ok: boolean };\nexport interface Foo { a: string }\ntype Intern = string;\nconst HILFE = 1;\nfunction helfer(): Intern { return String(HILFE + x); }\n\nexport async function tuWas(): Promise<Erg> { helfer(); return { ok: true }; }\nexport default async function standard() {}\n';
    expect(pruefeDatei("lib/gut-actions.ts", text)).toEqual([]);
  });
  it("Rot-Nachweis: Konstante, synchrone Funktion, Re-Export, Default ohne async — je mit Zeile", () => {
    const text = '"use server";\n\nexport const KONST = 1;\nexport function sync() { return 1; }\nexport { a } from "./a";\nexport async function ok() {}\nexport default function nichtAsync() {}\n';
    const l = pruefeDatei("lib/schlecht-actions.ts", text);
    expect(l.map((x) => [x.zeile, x.name, x.grund])).toEqual([
      [3, "KONST", "Konstante/Variable exportiert"],
      [4, "sync", "synchrone Funktion exportiert"],
      [5, 'from "./a"', "Re-Export"],
      [7, "nichtAsync", "synchrone Funktion exportiert"],
    ]);
  });
  it("der Befund aus #214 wird erkannt: synchroner Export neben async-Actions", () => {
    const text = '"use server";\n\nexport async function importAusfuehren() {}\n\nexport function formDataAusZeile(felder: Record<string, string>): FormData { return new FormData(); }\n';
    expect(pruefeDatei("lib/import-actions.ts", text)).toMatchObject([{ zeile: 5, name: "formDataAusZeile" }]);
  });
  it("Typ-Re-Export ist erlaubt (import type … + export { X }, export { type X }), Wert-Re-Export nicht", () => {
    expect(pruefeDatei("lib/sperre-actions.ts", 'import type { Gesperrt } from "./sperre";\n"use server";\nexport async function a() {}\nexport { Gesperrt };\n')).toEqual([]);
    expect(pruefeDatei("lib/t.ts", '"use server";\nimport { type A, b } from "./m";\nexport { type A };\nexport async function c() {}\n')).toEqual([]);
    expect(pruefeDatei("lib/w.ts", '"use server";\nimport { b } from "./m";\nexport { b };\n')).toMatchObject([{ zeile: 3, grund: "Re-Export" }]);
  });
  it("ohne Direktive ist alles erlaubt; Direktive nicht im Prolog zaehlt nicht", () => {
    expect(pruefeDatei("lib/frei.ts", 'export const A = 1;\nexport function b() {}\n')).toEqual([]);
    expect(pruefeDatei("lib/spaet.ts", 'import x from "x";\n"use server";\nexport const A = 1;\n')).toEqual([]);
  });
  it("Baum-Pruefung: findet die rote Datei im Wegwerf-Ordner, Tests und fremde Ordner nicht", () => {
    schreibe("lib/gut-actions.ts", '"use server";\nexport async function a() {}\n');
    schreibe("lib/schlecht-actions.ts", '"use server";\nexport const B = 2;\n');
    schreibe("lib/schlecht-actions.test.ts", '"use server";\nexport const C = 3;\n');
    schreibe("scripts/egal.ts", '"use server";\nexport const D = 4;\n');
    const { dateien, luecken } = pruefeUseServer(T);
    expect(dateien).toBe(2);
    expect(luecken).toEqual([{ datei: "lib/schlecht-actions.ts", zeile: 2, name: "B", grund: "Konstante/Variable exportiert" }]);
  });
  it("der echte Baum apps/web ist heute gruen", () => {
    const { dateien, luecken } = pruefeUseServer(process.cwd());
    expect(dateien).toBeGreaterThanOrEqual(10);
    expect(luecken).toEqual([]);
  });
});
