/**
 * AP2.7 PR a (E67): Rot zeigen — ein Bearbeiter startet einen Import und wird
 * abgewiesen, bevor irgendetwas geschrieben wird. Die Action wird echt
 * aufgerufen, Infrastruktur ist gemockt (Muster stroeme-actions.beleg.test.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let rolle = "bearbeiter";
let schreibversuche = 0;
const protokolle: unknown[] = [];
const inserts: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
const uploads: { key: string; bytes: number; contentType?: string }[] = [];
const geloescht: string[] = [];
/** Antworten auf db.select(...) in Aufrufreihenfolge; leer → der Benutzer (Zugangspruefung). */
const dbSelects: unknown[][] = [];
let r2Inhalt: ArrayBuffer | null = null;

vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => "petra@bhyo.de",
  getEnvironment: async () => "test",
  getBelegeBucket: async () => ({
    put: async (key: string, daten: ArrayBuffer, o?: { httpMetadata?: { contentType?: string } }) => {
      uploads.push({ key, bytes: daten.byteLength, contentType: o?.httpMetadata?.contentType });
    },
    get: async () => (r2Inhalt ? { body: new Blob([r2Inhalt]).stream(), size: r2Inhalt.byteLength } : null),
    delete: async (key: string) => void geloescht.push(key),
    list: async () => ({ objects: [], truncated: false }),
  }),
  withDb: async (fn: (db: unknown) => unknown) => {
    const tx = {
      select: () => ({ from: () => ({ where: async () => [] }) }),
      insert: () => ({
        values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
          const p = {
            returning: async () => {
              schreibversuche += 1;
              inserts.push(...(Array.isArray(v) ? v : [v]));
              return [{ id: ((Array.isArray(v) ? v[0] : v)?.id as string | undefined) ?? "lauf-1" }];
            },
            then: (res: (x: unknown) => void) => {
              schreibversuche += 1;
              inserts.push(...(Array.isArray(v) ? v : [v]));
              res(undefined);
            },
          };
          return p;
        },
      }),
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void updates.push(v) }) }),
    };
    // Die Zugangspruefung liest benutzer ohne Join; die Lauf-Lader joinen
    // benutzer an import_lauf (leftJoin) — daran erkennt die Attrappe, welche
    // Antwort faellig ist.
    const kette = (join = false): unknown => {
      const p: Record<string, unknown> = {};
      for (const m of ["from", "where", "limit", "orderBy"]) p[m] = () => kette(join);
      p.leftJoin = () => kette(true);
      (p as { then: unknown }).then = (res: (v: unknown) => void) => res(join ? (dbSelects.shift() ?? []) : [{ id: "u1", rolle, aktiv: true, name: "Petra" }]);
      return p;
    };
    return fn({ select: () => kette(), transaction: async (f: (t: unknown) => unknown) => f(tx) });
  },
}));
vi.mock("@/lib/protokoll", () => ({ protokolliere: async (_tx: unknown, e: unknown) => { protokolle.push(e); return { id: "e1" }; } }));

const { importDateiHochladen, importLaufAnlegen, importZuordnungSpeichern } = await import("./import-actions");
const { vorschlagZuordnung } = await import("./import-zuordnung");

const BEISPIELE = join(__dirname, "..", "..", "..", "docs", "beispiele");
function upload(felder: Record<string, string>, datei: File | null): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(felder)) fd.set(k, v);
  if (datei) fd.set("datei", datei);
  return fd;
}
const csvDatei = () => new File([readFileSync(join(BEISPIELE, "import-biomasse.csv"))], "import-biomasse.csv", { type: "text/csv" });
const laufFelder = { art: "biomasse", beleg_typ: "betriebsdaten", standard_sektor: "ohne_sektor" };

const eingabe = { art: "biomasse", dateiname: "stroeme-2026.xlsx", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor" };

beforeEach(() => { schreibversuche = 0; protokolle.length = 0; inserts.length = 0; updates.length = 0; uploads.length = 0; geloescht.length = 0; dbSelects.length = 0; r2Inhalt = null; });

describe("importLaufAnlegen (import.ausfuehren)", () => {
  it("Rot: ein Bearbeiter wird abgewiesen, nichts wird geschrieben", async () => {
    rolle = "bearbeiter";
    const erg = await importLaufAnlegen(eingabe);
    expect(erg.ok).toBeUndefined();
    expect(erg.fehler).toMatch(/recht/i);
    expect(schreibversuche).toBe(0);
    expect(protokolle).toHaveLength(0);
  });

  it("ein Pruefer legt den Lauf an; das Ereignis traegt die Lauf-ID", async () => {
    rolle = "pruefer";
    const erg = await importLaufAnlegen(eingabe);
    expect(erg).toMatchObject({ ok: true, id: "lauf-1" });
    expect(schreibversuche).toBe(1);
    expect(protokolle[0]).toMatchObject({ art: "angelegt", entitaet: "import_lauf", id: "lauf-1", importLaufId: "lauf-1" });
  });

  it("unvollstaendige Eingabe wird vor jeder Wirkung abgewiesen", async () => {
    rolle = "admin";
    const erg = await importLaufAnlegen({ ...eingabe, dateiHash: "kein-hash", belegTyp: "" });
    expect(erg.feldFehler).toMatchObject({ dateiHash: expect.any(String), belegTyp: expect.any(String) });
    expect(schreibversuche).toBe(0);
  });
});

describe("importDateiHochladen (PR b: Upload, Hash, Roh-Upload, Lauf)", () => {
  it("Rot: ein Bearbeiter wird abgewiesen — kein Upload, kein Schreibversuch", async () => {
    rolle = "bearbeiter";
    const erg = await importDateiHochladen({}, upload(laufFelder, csvDatei()));
    expect(erg.fehler).toMatch(/recht/i);
    expect(uploads).toHaveLength(0);
    expect(schreibversuche).toBe(0);
    expect(protokolle).toHaveLength(0);
  });

  it("ohne Datei, falscher Typ oder zu gross: Feldfehler, nichts hochgeladen, nichts geschrieben", async () => {
    rolle = "pruefer";
    expect((await importDateiHochladen({}, upload(laufFelder, null))).feldFehler?.dateiname).toMatch(/auswählen/);
    expect((await importDateiHochladen({}, upload(laufFelder, new File(["x"], "liste.pdf")))).feldFehler?.dateiname).toMatch(/nicht unterstützt/);
    const gross = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "gross.csv");
    expect((await importDateiHochladen({}, upload(laufFelder, gross))).feldFehler?.dateiname).toMatch(/5 MB/);
    expect((await importDateiHochladen({}, upload(laufFelder, new File(["Nur;Kopf\n"], "nurkopf.csv")))).feldFehler?.dateiname).toMatch(/keine Datenzeile/);
    expect(uploads).toHaveLength(0);
    expect(schreibversuche).toBe(0);
  });

  it("fehlender Belegtyp oder Sektor: Feldfehler vor dem Upload", async () => {
    rolle = "admin";
    const erg = await importDateiHochladen({}, upload({ ...laufFelder, beleg_typ: "", standard_sektor: "" }, csvDatei()));
    expect(erg.feldFehler).toMatchObject({ belegTyp: expect.any(String), standardSektor: expect.any(String) });
    expect(uploads).toHaveLength(0);
    expect(schreibversuche).toBe(0);
  });

  it("ein Pruefer laedt die Beispiel-CSV hoch: Roh-Upload unter import/<env>/<lauf>/roh.csv, Lauf mit Hash und Zaehlern, Ereignis mit Lauf-ID", async () => {
    rolle = "pruefer";
    const erg = await importDateiHochladen({}, upload(laufFelder, csvDatei()));
    expect(erg.ok).toBe(true);
    expect(erg.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(uploads).toEqual([{ key: `import/test/${erg.id}/roh.csv`, bytes: 526, contentType: "text/csv" }]);
    expect(schreibversuche).toBe(1);
    expect(inserts[0]).toMatchObject({
      id: erg.id,
      art: "biomasse",
      dateiname: "import-biomasse.csv",
      dateiHash: "9e03cf9b31e8720138b4b743151f7d967e1a0181c205b3e2cc996c734a71e8fa",
      belegTyp: "betriebsdaten",
      standardSektor: "ohne_sektor",
      status: "angelegt",
      zaehler: { zeilen: 3, spalten: 14 },
    });
    expect(protokolle[0]).toMatchObject({ art: "angelegt", entitaet: "import_lauf", id: erg.id, importLaufId: erg.id, text: "Import-Lauf angelegt: import-biomasse.csv (biomasse, 3 Zeilen)" });
    // Personen-Inhalte landen nirgends: weder im Insert noch im Ereignis.
    expect(JSON.stringify([inserts, protokolle])).not.toMatch(/Mustermann|example\.invalid/);
  });
});

describe("importZuordnungSpeichern (PR b: Zeilen uebernehmen, Roh-Upload loeschen)", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const laufZeile = (status = "angelegt") => ({ id: LAUF, art: "biomasse", dateiname: "import-biomasse.csv", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status, zaehler: { zeilen: 3, spalten: 14 }, erstellerEmail: "petra@bhyo.de", createdAt: new Date(), updatedAt: new Date() });
  const csvBytes = () => { const b = readFileSync(join(BEISPIELE, "import-biomasse.csv")); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
  const SPALTEN = ["Betrieb", "Sektor", "Straße", "Hausnummer", "PLZ", "Ort", "Ansprechpartner", "E-Mail", "Materialart", "Menge", "Einheit", "TS-Anteil %", "Zeitraum von", "Zeitraum bis"];
  const vollstaendig = () => ({
    spalten: { ...vorschlagZuordnung("biomasse", SPALTEN), Hausnummer: "aschegehalt_pct" },
    werte: { materialart_code: { Rindergülle: "guelle_rind", Maissilage: "maissilage" }, akteur_sektor: { Landwirtschaft: "landwirtschaft" } },
  });

  it("Rot: ein Bearbeiter wird abgewiesen — nichts gelesen, nichts geschrieben", async () => {
    rolle = "bearbeiter";
    const erg = await importZuordnungSpeichern(LAUF, vollstaendig());
    expect(erg.fehler).toMatch(/recht/i);
    expect(schreibversuche).toBe(0);
    expect(geloescht).toHaveLength(0);
  });

  it("ein schon zugeordneter Lauf wird nicht noch einmal zugeordnet", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile("zugeordnet")]);
    const erg = await importZuordnungSpeichern(LAUF, vollstaendig());
    expect(erg.fehler).toMatch(/schon „zugeordnet"/);
    expect(schreibversuche).toBe(0);
  });

  it("fehlende Pflichtfelder: Meldungen, nichts gespeichert, Roh-Upload bleibt", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile()]);
    r2Inhalt = csvBytes();
    const z = vollstaendig();
    z.spalten.Hausnummer = "akteur_sitz_hausnummer";
    const erg = await importZuordnungSpeichern(LAUF, z);
    expect(erg.fehlerListe).toEqual([expect.stringMatching(/Aschegehalt %/)]);
    expect(schreibversuche).toBe(0);
    expect(updates).toHaveLength(0);
    expect(geloescht).toHaveLength(0);
  });

  it("ein Pruefer speichert die Zuordnung: 3 Zeilen (2 offen, 1 Fehler), Lauf zugeordnet, Ereignis mit Zaehlern, Roh-Upload geloescht, kein Personen-Inhalt", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile()]);
    r2Inhalt = csvBytes();
    const erg = await importZuordnungSpeichern(LAUF, vollstaendig());
    expect(erg.ok).toBe(true);
    expect(erg.zaehler).toMatchObject({ zeilen: 3, offen: 2, fehler: 1, personen_spalten: 2, spalten: 14 });
    expect(inserts).toHaveLength(3);
    expect(inserts[0]).toMatchObject({ laufId: LAUF, zeilennummer: 2, status: "offen", fehlergrund: null, felder: { akteur_name: "Hof Mustermann", materialart_code: "guelle_rind", menge_roh_fm: "1.234,5", zeitraum_von: "2026-01" } });
    expect(inserts[2]).toMatchObject({ zeilennummer: 4, status: "fehler", fehlergrund: expect.stringMatching(/Festmist/) });
    expect(updates[0]).toMatchObject({ status: "zugeordnet", zaehler: expect.objectContaining({ offen: 2 }) });
    expect(protokolle[0]).toMatchObject({ art: "status_gesetzt", entitaet: "import_lauf", id: LAUF, importLaufId: LAUF, text: expect.stringMatching(/3 Zeilen \(2 offen, 1 mit Fehler\), 2 Personen-Spalte/) });
    expect(geloescht).toEqual([`import/test/${LAUF}/roh.csv`]);
    // „Hof Mustermann" ist der Betrieb (Akteur) und darf stehen; die Person „Max Mustermann", E-Mails und die Spaltennamen nicht.
    expect(JSON.stringify([inserts, updates, protokolle])).not.toMatch(/Max Mustermann|Erika|example\.invalid|Ansprech|E-Mail/);
  });
});
