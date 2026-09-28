/**
 * Workflow-Wartung (28.09.2026, vor dem 19.10.): Ab dem 19.10. wechselt
 * `ubuntu-latest` still auf Ubuntu 26 — und damit Postgres-Client und GDAL,
 * an denen Backup, Restore und der VG250-Import haengen. Deshalb steht in
 * jedem Workflow eine FESTE Runner-Version; der Umstieg auf 26 geschieht
 * spaeter bewusst, mit Restore- und Import-Lauf als Nachweis. Dieser Test
 * schlaegt fehl, sobald irgendwo wieder `ubuntu-latest` steht — auch in
 * einem kuenftigen Workflow.
 */
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const ordner = new URL("../../../.github/workflows/", import.meta.url);
const dateien = readdirSync(ordner).filter((f) => f.endsWith(".yml"));

describe("Workflows: feste Runner-Version, keine Action auf Node 20", () => {
  it("kein Workflow nutzt ubuntu-latest", () => {
    const treffer = dateien.filter((f) => /runs-on:\s*ubuntu-latest/.test(readFileSync(new URL(f, ordner), "utf8")));
    expect(treffer, `ubuntu-latest in: ${treffer.join(", ")}`).toEqual([]);
  });

  it("jeder Workflow hat mindestens einen Job mit runs-on ubuntu-24.04", () => {
    for (const f of dateien) {
      expect(readFileSync(new URL(f, ordner), "utf8"), f).toMatch(/runs-on:\s*ubuntu-24\.04/);
    }
  });

  it("die Standard-Actions laufen in Node-24-Versionen (checkout v7, setup-node v7, pnpm v6, upload-artifact v7)", () => {
    const veraltet: string[] = [];
    for (const f of dateien) {
      const s = readFileSync(new URL(f, ordner), "utf8");
      for (const m of s.matchAll(/uses:\s*(actions\/checkout|actions\/setup-node|pnpm\/action-setup|actions\/upload-artifact)@v(\d+)/g)) {
        const mindest: Record<string, number> = { "actions/checkout": 7, "actions/setup-node": 7, "pnpm/action-setup": 6, "actions/upload-artifact": 7 };
        if (Number(m[2]) < mindest[m[1]!]!) veraltet.push(`${f}: ${m[1]}@v${m[2]}`);
      }
    }
    expect(veraltet).toEqual([]);
  });
});
