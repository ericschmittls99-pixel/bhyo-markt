import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Jede Materialart aus den Stammdaten hat ein Foto in beiden Groessen
 * (public/fotos/feedstock/{lg,sm}/<code>.webp). Die Codes kommen aus den
 * Stammdaten-Migrationen (0008, 0011), nicht aus einer Liste hier — eine
 * neue Materialart ohne Foto laesst den Test rot werden.
 */
const wurzel = new URL("../../../", import.meta.url);
const migrationen = ["packages/db/migrations/0008_stammdaten.sql", "packages/db/migrations/0011_materialarten_seed_v2.sql"];

function materialartCodes(): string[] {
  const codes = new Set<string>();
  for (const m of migrationen) {
    const sql = readFileSync(new URL(m, wurzel), "utf8");
    for (const block of sql.matchAll(/INSERT INTO "?materialart"?[^;]*?VALUES([\s\S]*?);/gi)) {
      for (const z of block[1]!.matchAll(/\(\s*'([a-z0-9_]+)'/g)) codes.add(z[1]!);
    }
  }
  return [...codes].sort();
}

describe("Fotos je Materialart", () => {
  const codes = materialartCodes();

  it("findet die 46 Materialarten der Stammdaten", () => {
    expect(codes).toHaveLength(46);
  });

  it("jede Materialart hat lg- und sm-Foto", () => {
    const fehlend: string[] = [];
    for (const code of codes) {
      for (const g of ["lg", "sm"]) {
        const pfad = fileURLToPath(new URL(`apps/web/public/fotos/feedstock/${g}/${code}.webp`, wurzel));
        if (!existsSync(pfad)) fehlend.push(`${g}/${code}.webp`);
      }
    }
    expect(fehlend, `fehlende Fotos: ${fehlend.join(", ")}`).toEqual([]);
  });
});
