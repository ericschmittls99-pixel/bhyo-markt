import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findeVerstoesse, IMMUTABLE_ENUMS } from "./enum-rename-check";

function ordnerMit(dateien: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "enum-rename-"));
  for (const [name, inhalt] of Object.entries(dateien)) writeFileSync(join(dir, name), inhalt);
  return dir;
}

describe("enum-rename-check", () => {
  it("die echten Migrationen sind sauber", () => {
    expect(findeVerstoesse(join(process.cwd(), "migrations"))).toEqual([]);
  });
  it("meldet RENAME VALUE und RENAME TO an einem gelisteten Enum, auch mit Schema-Praefix", () => {
    const dir = ordnerMit({
      "0099_probe.sql": [
        `ALTER TYPE "public"."inbox_typ" RENAME VALUE 'zugriffsanfrage' TO 'anfrage';`,
        `ALTER TYPE inbox_typ RENAME TO inbox_art;`,
      ].join("\n"),
    });
    const v = findeVerstoesse(dir);
    expect(v.map((x) => x.zeile)).toEqual([1, 2]);
    expect(v[0]!.grund).toMatch(/nicht umbenannt/);
  });
  it("laesst andere Enums (z. B. beleg_typ, 0021) und Kommentare durch", () => {
    const dir = ordnerMit({
      "0021_probe.sql": [
        `-- ALTER TYPE "public"."inbox_typ" RENAME VALUE 'a' TO 'b'; (nur Kommentar)`,
        `ALTER TYPE "public"."beleg_typ" RENAME VALUE 'dokument_link' TO 'dokument';`,
        `ALTER TYPE "public"."inbox_typ" ADD VALUE 'neu';`,
      ].join("\n"),
    });
    expect(findeVerstoesse(dir)).toEqual([]);
  });
  it("die Liste nennt inbox_typ mit der Funktion", () => {
    expect(IMMUTABLE_ENUMS.get("inbox_typ")).toContain("inbox_typ_text");
  });
});
