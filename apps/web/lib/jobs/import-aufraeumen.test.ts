/**
 * AP2.7 PR b (E67): Roh-Uploads aelter als 24 h werden geloescht, juengere
 * nicht; nur unter import/; seitenweise; ein Fehler beim Loeschen bricht den
 * Lauf nicht ab.
 */
import { describe, expect, it, vi } from "vitest";

const protokolle: Record<string, unknown>[] = [];
vi.mock("@/lib/protokoll", () => ({ protokolliere: async (_tx: unknown, e: Record<string, unknown>) => { protokolle.push(e); return { id: "e1" }; } }));

import { IMPORT_ROH_AUFBEWAHRUNG_MS, loescheAlteImportUploads, loescheAlteImportZeilen, verwirfInaktiveLaeufe, zuLoeschen } from "./import-aufraeumen";

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

describe("verwirfInaktiveLaeufe (PR g, Parameter import.lauf_inaktiv_tage)", () => {
  it("findet nie ausgefuehrte Laeufe ohne Aktivitaet seit der Frist, loescht ihre Zeilen, setzt „verworfen“, protokolliert im Namen des Erstellers und raeumt die Beleg-Kopie", async () => {
    protokolle.length = 0;
    const ausgefuehrt: string[] = [];
    const updates: Record<string, unknown>[] = [];
    const deletes: string[] = [];
    const r2: string[] = [];
    const texte = (o: unknown, seen = new Set<object>()): string[] => {
      if (!o || typeof o !== "object" || seen.has(o)) return [];
      seen.add(o);
      return Object.values(o as Record<string, unknown>).flatMap((v) => (typeof v === "string" ? [v] : texte(v, seen)));
    };
    const tx = {
      delete: () => ({ where: () => ({ returning: async () => { deletes.push("import_zeile"); return [{ id: "z1" }, { id: "z2" }]; } }) }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ zaehler: { zeilen: 2 } }] }) }) }),
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void updates.push(v) }) }),
      insert: () => ({ values: () => ({ returning: async () => [{ id: "x" }] }) }),
    };
    const db = {
      execute: async (q: unknown) => {
        ausgefuehrt.push(texte(q).join(" "));
        return [{ id: "l1", ersteller_id: "u7", email: "petra@bhyo.de", tage: 30 }];
      },
      transaction: async (f: (t: unknown) => unknown) => f(tx),
    };
    const erg = await verwirfInaktiveLaeufe(db as never, "2026-11-06", { bucket: { delete: async (k: string) => void r2.push(k) }, env: "test" });
    expect(erg).toEqual({ laeufe: 1, zeilen: 2 });
    expect(ausgefuehrt[0]).toContain("parameter_wert('import.lauf_inaktiv_tage'");
    expect(ausgefuehrt[0]).toContain("status in ('angelegt', 'zugeordnet', 'aufgeloest', 'probelauf', 'fehler')");
    expect(ausgefuehrt[0]).toContain("updated_at::date");
    expect(deletes).toEqual(["import_zeile"]);
    expect(updates[0]).toMatchObject({ status: "verworfen", verworfenAm: expect.any(Date), zaehler: expect.objectContaining({ verworfen_zeilen: 2, offen: 0, fehler: 0 }) });
    expect(protokolle[0]).toMatchObject({ art: "status_gesetzt", entitaet: "import_lauf", id: "l1", benutzerId: "u7", importLaufId: "l1", text: "Import-Lauf verworfen (nie ausgeführt, vom täglichen Job nach 30 Tagen ohne Aktivität): 2 Zeile(n) gelöscht" });
    expect(r2).toEqual(["belege/test/import/l1/bereinigt.csv"]);
  });
  it("ohne faellige Laeufe passiert nichts", async () => {
    const db = { execute: async () => [], transaction: async () => { throw new Error("darf nicht laufen"); } };
    expect(await verwirfInaktiveLaeufe(db as never, "2026-11-06")).toEqual({ laeufe: 0, zeilen: 0 });
  });
});
