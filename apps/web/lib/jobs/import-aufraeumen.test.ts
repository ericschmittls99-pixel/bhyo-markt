/**
 * AP2.7 PR b (E67): Roh-Uploads aelter als 24 h werden geloescht, juengere
 * nicht; nur unter import/; seitenweise; ein Fehler beim Loeschen bricht den
 * Lauf nicht ab.
 */
import { describe, expect, it } from "vitest";

import { IMPORT_ROH_AUFBEWAHRUNG_MS, loescheAlteImportUploads, loescheAlteImportZeilen, zuLoeschen } from "./import-aufraeumen";

const jetzt = new Date("2026-10-07T03:00:00Z");
const vor = (ms: number) => new Date(jetzt.getTime() - ms);

describe("zuLoeschen", () => {
  it("nimmt genau die Roh-Uploads, die 24 h oder aelter sind", () => {
    const keys = zuLoeschen(
      [
        { key: "import/production/a/roh.csv", uploaded: vor(IMPORT_ROH_AUFBEWAHRUNG_MS + 1) },
        { key: "import/production/b/roh.xlsx", uploaded: vor(IMPORT_ROH_AUFBEWAHRUNG_MS) },
        { key: "import/production/c/roh.csv", uploaded: vor(IMPORT_ROH_AUFBEWAHRUNG_MS - 1) },
        { key: "belege/production/alt.pdf", uploaded: vor(30 * IMPORT_ROH_AUFBEWAHRUNG_MS) },
      ],
      jetzt,
    );
    expect(keys).toEqual(["import/production/a/roh.csv", "import/production/b/roh.xlsx"]);
  });
});

describe("loescheAlteImportUploads", () => {
  it("liest alle Seiten, loescht die alten, zaehlt Fehler statt abzubrechen", async () => {
    const geloescht: string[] = [];
    const seiten = [
      { objects: [{ key: "import/x/1/roh.csv", uploaded: vor(2 * IMPORT_ROH_AUFBEWAHRUNG_MS) }, { key: "import/x/2/roh.csv", uploaded: vor(1000) }], truncated: true, cursor: "c1" },
      { objects: [{ key: "import/x/3/roh.csv", uploaded: vor(3 * IMPORT_ROH_AUFBEWAHRUNG_MS) }, { key: "import/x/kaputt/roh.csv", uploaded: vor(3 * IMPORT_ROH_AUFBEWAHRUNG_MS) }], truncated: false },
    ];
    const bucket = {
      list: async ({ cursor }: { prefix: string; cursor?: string }) => (cursor ? seiten[1]! : seiten[0]!),
      delete: async (key: string) => {
        if (key.includes("kaputt")) throw new Error("R2 weg");
        geloescht.push(key);
      },
    };
    const erg = await loescheAlteImportUploads(bucket, jetzt);
    expect(erg).toEqual({ gesehen: 4, geloescht: 2, fehler: 1 });
    expect(geloescht).toEqual(["import/x/1/roh.csv", "import/x/3/roh.csv"]);
  });
});

describe("loescheAlteImportZeilen (PR c, Parameter import.zeilen_aufbewahrung_tage)", () => {
  it("ein Statement: faellige Laeufe (ausgefuehrt/zurueckgenommen, abgeschlossen + Frist <= Stichtag) verlieren ihre Zeilen; Zaehlung zurueck", async () => {
    const ausgefuehrt: string[] = [];
    const db = {
      execute: async (q: { queryChunks?: unknown[] }) => {
        const texte = (o: unknown, seen = new Set<object>()): string[] => {
          if (!o || typeof o !== "object" || seen.has(o)) return [];
          seen.add(o);
          return Object.values(o as Record<string, unknown>).flatMap((v) => (typeof v === "string" ? [v] : texte(v, seen)));
        };
        ausgefuehrt.push(texte(q).join(" "));
        return [{ laeufe: 2, zeilen: 150 }];
      },
    };
    const erg = await loescheAlteImportZeilen(db as never, "2026-11-06");
    expect(erg).toEqual({ laeufe: 2, zeilen: 150 });
    expect(ausgefuehrt).toHaveLength(1);
    expect(ausgefuehrt[0]).toContain("parameter_wert('import.zeilen_aufbewahrung_tage'");
    expect(ausgefuehrt[0]).toContain("status in ('ausgefuehrt', 'zurueckgenommen')");
    expect(ausgefuehrt[0]).toContain("delete from import_zeile");
    expect(ausgefuehrt[0]).toContain("2026-11-06");
  });
});
