/**
 * AP2.7 PR b (Eric 06.10.2026, Testluecke aus #180): die Beleg-Regeln am
 * Schreibpfad erstelleBeleg — Pflichtfelder je Typ (Quellenangabe,
 * Erhebungsdatum, Gueltig-bis bei den oberen vier, Link bei Webrecherche)
 * und Belegtyp → Qualitaetsstufe an den geschriebenen Werten, gegen die
 * Ankerfaelle (E34), die auch die DB-Paritaet prueft. Der Import legt seine
 * Belege ueber denselben Pfad an. R2 und Umgebung sind gemockt.
 */
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const uploads: string[] = [];
vi.mock("@/lib/db", () => ({
  getBelegeBucket: async () => ({ put: async (key: string) => void uploads.push(key) }),
  getEnvironment: async () => "test",
}));

const { BELEG_TYPEN, ValidierungsFehler, erstelleBeleg } = await import("./beleg-server");
const { brauchtGueltigBis, deriveQualitaet } = await import("./qualitaet");
const { ANKERFAELLE } = await import("./qualitaet-ankerfaelle");
type BelegEingabe = import("./beleg-server").BelegEingabe;

/** Fake-DB: merkt den Insert in beleg; schreibt nichts. */
function fakeDb() {
  const inserts: { tabelle: string; werte: Record<string, unknown> }[] = [];
  const db = {
    insert: (t: unknown) => ({
      values: (werte: Record<string, unknown>) => ({
        returning: async () => {
          inserts.push({ tabelle: getTableName(t as never), werte });
          return [{ id: "beleg-neu" }];
        },
      }),
    }),
  };
  return { db: db as never, inserts };
}

function eingabe(teil: Partial<BelegEingabe> & { typ: string }): BelegEingabe {
  return {
    quellenangabe: "Betriebsdaten 2025",
    erhebungsdatum: "2026-10-01",
    link: null,
    gueltigBis: brauchtGueltigBis(teil.typ as never) ? "2027-10-01" : null,
    kernnotiz: null,
    externNachvollziehbar: false,
    datei: null,
    ...teil,
  };
}

beforeEach(() => {
  uploads.length = 0;
});

describe("erstelleBeleg — Pflichtfelder je Belegtyp", () => {
  it.each(BELEG_TYPEN)("%s: ohne Quellenangabe wird nichts geschrieben", async (typ) => {
    const { db, inserts } = fakeDb();
    await expect(erstelleBeleg(db, eingabe({ typ, quellenangabe: null, link: "https://q.example/x" }))).rejects.toThrow(
      new ValidierungsFehler("Quellenangabe ist ein Pflichtfeld."),
    );
    expect(inserts).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  it("ohne Erhebungsdatum wird nichts geschrieben", async () => {
    const { db, inserts } = fakeDb();
    await expect(erstelleBeleg(db, eingabe({ typ: "betriebsdaten", erhebungsdatum: null }))).rejects.toThrow("Erhebungsdatum ist ein Pflichtfeld.");
    expect(inserts).toHaveLength(0);
  });

  it.each(BELEG_TYPEN)("%s: Gültig-bis ist Pflicht genau bei den oberen vier Typen (E33)", async (typ) => {
    const { db, inserts } = fakeDb();
    const ohne = eingabe({ typ, gueltigBis: null, link: typ === "webrecherche" ? "https://q.example/x" : null });
    if (brauchtGueltigBis(typ)) {
      await expect(erstelleBeleg(db, ohne)).rejects.toThrow("Gültig bis ist ein Pflichtfeld.");
      expect(inserts).toHaveLength(0);
    } else {
      await erstelleBeleg(db, ohne);
      expect(inserts[0]!.werte.gueltigBis).toBeNull();
    }
  });

  it("Webrecherche ohne Link wird abgewiesen; mit Link wird er normalisiert geschrieben", async () => {
    const { db, inserts } = fakeDb();
    await expect(erstelleBeleg(db, eingabe({ typ: "webrecherche", link: null }))).rejects.toThrow("Link ist bei Webrecherche ein Pflichtfeld.");
    expect(inserts).toHaveLength(0);
    await erstelleBeleg(db, eingabe({ typ: "webrecherche", link: "quelle.example/seite" }));
    expect(inserts[0]!.werte.linkUrl).toBe("https://quelle.example/seite");
  });

  it("typ null oder unbekannt heißt: kein Beleg — null, nichts geschrieben", async () => {
    const { db, inserts } = fakeDb();
    expect(await erstelleBeleg(db, eingabe({ typ: null as unknown as string }))).toBeNull();
    expect(await erstelleBeleg(db, eingabe({ typ: "hoerensagen" }))).toBeNull();
    expect(inserts).toHaveLength(0);
  });

  it("schreibt Quellenangabe in metadata, Kernnotiz nur beim Gespräch, Erhebungsdatum als erstelltAm, extern_nachvollziehbar wie übergeben", async () => {
    const { db, inserts } = fakeDb();
    await erstelleBeleg(db, eingabe({ typ: "gespraech", kernnotiz: "Zusage mündlich", externNachvollziehbar: true }));
    await erstelleBeleg(db, eingabe({ typ: "vertrag", kernnotiz: "wird ignoriert" }));
    expect(inserts[0]!.werte).toMatchObject({
      typ: "gespraech",
      metadata: { quellenangabe: "Betriebsdaten 2025", kernnotiz: "Zusage mündlich" },
      externNachvollziehbar: true,
      erstelltAm: new Date("2026-10-01"),
    });
    expect(inserts[1]!.werte.metadata).toEqual({ quellenangabe: "Betriebsdaten 2025" });
    expect(inserts[1]!.werte.externNachvollziehbar).toBe(false);
  });

  it("lädt eine Datei genau einmal nach R2 und schreibt den Key mit Umgebungs-Präfix", async () => {
    const { db, inserts } = fakeDb();
    const datei = new File(["inhalt"], "Betriebsdaten 2025.pdf", { type: "application/pdf" });
    await erstelleBeleg(db, eingabe({ typ: "betriebsdaten", datei }));
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatch(/^belege\/test\/[0-9a-f-]{36}-Betriebsdaten_2025\.pdf$/);
    expect(inserts[0]!.werte.dateiKey).toBe(uploads[0]);
  });

  it("ein vorhandener dateiKey (bereinigte Importkopie) wird übernommen, nichts hochgeladen", async () => {
    const { db, inserts } = fakeDb();
    await erstelleBeleg(db, eingabe({ typ: "betriebsdaten", dateiKey: "belege/test/import/lauf-1/bereinigt.csv", datei: new File(["x"], "egal.csv") }));
    expect(uploads).toHaveLength(0);
    expect(inserts[0]!.werte.dateiKey).toBe("belege/test/import/lauf-1/bereinigt.csv");
  });

  it("eine leere Datei zählt nicht als Datei", async () => {
    const { db, inserts } = fakeDb();
    await erstelleBeleg(db, eingabe({ typ: "betriebsdaten", datei: new File([], "leer.pdf") }));
    expect(uploads).toHaveLength(0);
    expect(inserts[0]!.werte.dateiKey).toBeNull();
  });
});

describe("erstelleBeleg — Belegtyp → Qualitätsstufe an den geschriebenen Werten (E34-Ankerfälle)", () => {
  // Die Stufe schreibt die App nirgends (GENERATED in der DB); hier wird
  // geprueft, dass der Schreibpfad genau die Werte ablegt, aus denen beide
  // Implementierungen (deriveQualitaet, qualitaetsstufe()) die erwartete Stufe
  // ableiten. Faelle mit Markierung „abgelaufen" betreffen die Verifikation,
  // nicht das Anlegen, und bleiben aussen vor.
  const anlegeFaelle = ANKERFAELLE.filter((f) => f.bewertung.abgelaufenAm === undefined);
  it.each(anlegeFaelle.map((f) => [f.name, f] as const))("%s", async (_name, fall) => {
    const { db, inserts } = fakeDb();
    const b = fall.bewertung;
    const mitDatei = typeof b.dateiKey === "string" && b.dateiKey.trim().length > 0;
    const link = typeof b.linkUrl === "string" && b.linkUrl.trim().length > 0 ? b.linkUrl : b.typ === "webrecherche" ? "https://q.example/pflichtlink" : null;
    await erstelleBeleg(db, eingabe({ typ: b.typ, link, datei: mitDatei ? new File(["x"], "abc.pdf") : null }));
    const w = inserts[0]!.werte as { typ: never; dateiKey: string | null; linkUrl: string | null };
    expect(deriveQualitaet({ typ: w.typ, dateiKey: w.dateiKey, linkUrl: w.linkUrl })).toBe(fall.erwartet);
  });
});
