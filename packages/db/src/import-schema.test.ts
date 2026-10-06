/**
 * AP2.7 PR a (E67), Schema-Probe: In den Import-Tabellen gibt es nirgends eine
 * Spalte fuer Personen-Inhalte, und der CHECK auf import_zeile.felder weist
 * Personen-Schluessel ab. Rot gezeigt: eine Spalte `ansprechpartner` in
 * import_zeile laesst den ersten Test fallen.
 */
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { IMPORT_PERSONEN_SCHLUESSEL, importLauf, importVorlage, importZeile } from "./schema";

// „name" allein ist kein Personen-Bezug (import_vorlage.name = Vorlagenname), „dateiname" ebenso wenig.
const PERSONEN = /ansprech|kontakt|person|mail|telefon|mobil|handy|fax|vorname|nachname|personname/i;

describe("Import-Schema ohne Personen-Spalten (E67)", () => {
  it("keine Spalte der Import-Tabellen traegt einen Personen-Bezug", () => {
    for (const t of [importVorlage, importLauf, importZeile]) {
      const spalten = Object.values(getTableColumns(t)).map((c) => c.name);
      const verdaechtig = spalten.filter((n) => PERSONEN.test(n));
      expect(verdaechtig, `${getTableName(t)}: ${verdaechtig.join(", ")}`).toEqual([]);
    }
  });

  it("die Sperrliste der felder-Schluessel ist nicht leer und nennt die Kernbegriffe", () => {
    for (const k of ["ansprechpartner", "kontakt", "email", "telefon", "mobil"]) expect(IMPORT_PERSONEN_SCHLUESSEL).toContain(k);
  });
});
