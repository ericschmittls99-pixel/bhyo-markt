import { describe, expect, it } from "vitest";

import { fehlendeMigrationen } from "./schema-stand";

describe("fehlendeMigrationen (E21)", () => {
  const journal = [
    { when: 100, tag: "0000_basis" },
    { when: 200, tag: "0001_akteure" },
    { when: 300, tag: "0002_vergabe" },
  ];

  it("meldet die Tags, deren when in der DB fehlt", () => {
    expect(fehlendeMigrationen(journal, [100, 200])).toEqual(["0002_vergabe"]);
  });

  it("leere Liste, wenn alles angewendet ist", () => {
    expect(fehlendeMigrationen(journal, [100, 200, 300])).toEqual([]);
  });

  it("vertraegt bigint-Strings aus dem Treiber", () => {
    expect(fehlendeMigrationen(journal, ["100", "200", "300"])).toEqual([]);
  });

  it("ohne Migrationstabelle fehlt alles", () => {
    expect(fehlendeMigrationen(journal, [])).toHaveLength(3);
  });
});
