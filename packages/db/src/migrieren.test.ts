import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fehlerBericht } from "./migrieren";

describe("Migrations-Runner (Betrieb 05.10.2026)", () => {
  it("der Fehlerbericht nennt Meldung, Code, Detail und Statement", () => {
    const text = fehlerBericht({
      message: 'relation "gibt_es_nicht" does not exist',
      code: "42P01",
      detail: undefined,
      query: "ALTER TABLE gibt_es_nicht ADD COLUMN x int",
    });
    expect(text).toContain("Meldung:   relation \"gibt_es_nicht\" does not exist");
    expect(text).toContain("Code:      42P01");
    expect(text).toContain("Statement: ALTER TABLE gibt_es_nicht ADD COLUMN x int");
  });

  it("ein von drizzle verpackter Fehler (cause) liefert Code und Meldung der Ursache und das Statement des Mantels", () => {
    const mantel = Object.assign(new Error("Failed query: ALTER TABLE gibt_es_nicht ADD COLUMN probe integer"), {
      query: "ALTER TABLE gibt_es_nicht ADD COLUMN probe integer",
      cause: Object.assign(new Error('relation "gibt_es_nicht" does not exist'), { code: "42P01", position: "13" }),
    });
    const text = fehlerBericht(mantel);
    expect(text).toContain("Code:      42P01");
    expect(text).toContain('Meldung:   relation "gibt_es_nicht" does not exist');
    expect(text).toContain("Position:  13");
    expect(text).toContain("Statement: ALTER TABLE gibt_es_nicht ADD COLUMN probe integer");
  });

  it("ein Nicht-Postgres-Fehler wird trotzdem lesbar", () => {
    expect(fehlerBericht(new Error("Verbindung weg"))).toContain("Meldung:   Verbindung weg");
    expect(fehlerBericht("x")).toContain("Code:      –");
  });

  it("packages/db migriert ueberall mit dem Runner, nirgends mehr mit drizzle-kit migrate", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.migrate).toBe("tsx src/migrieren.ts");
    const deploy = readFileSync(new URL("../../../.github/workflows/deploy.yml", import.meta.url), "utf8");
    const migrateProd = readFileSync(new URL("../../../.github/workflows/migrate-production.yml", import.meta.url), "utf8");
    expect(deploy).not.toContain("drizzle-kit migrate");
    expect(migrateProd).not.toContain("drizzle-kit migrate");
    expect(migrateProd).toContain("pnpm --filter @bhyo/db migrate");
  });
});
