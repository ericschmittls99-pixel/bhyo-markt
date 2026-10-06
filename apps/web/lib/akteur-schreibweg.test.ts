/**
 * AP2.7 PR b (E67, Eric 06.10.2026): Die Akteur-Anlage als Baustein mit
 * eigener Transaktion, den die Inline-Anlage (API-Route) und der Import
 * teilen. Geprueft werden die E66-Pflichtfelder, Sitz/Kreis (Rollback ohne
 * Kreis-ARS), das Protokoll-Ereignis und dass der Baustein selbst Rechte
 * prueft. Infrastruktur (DB, Kreis-Abfrage, Protokoll) ist gemockt; die
 * Regeln sind echt.
 */
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  withDb: async (fn: (db: unknown) => unknown) => fn({}),
}));
const protokolle: Record<string, unknown>[] = [];
vi.mock("@/lib/protokoll", () => ({
  protokolliere: async (_tx: unknown, e: Record<string, unknown>) => {
    protokolle.push(e);
    return { id: "ereignis-1" };
  },
}));
let kreisArs: string | null = "08215";
vi.mock("@/lib/akteure", () => ({
  kreisArsDesSitzes: async () => kreisArs,
}));

const { AkteurFehlerAusnahme, akteurAnlegenInTx } = await import("./akteur-schreibweg");
const { OHNE_ORT } = await import("./akteur-eingabe");

const pruefer = { id: "00000000-0000-4000-8000-0000000000aa", email: "pruefer@bhyo.de", rolle: "pruefer" as const };
const betrachter = { ...pruefer, rolle: "betrachter" as const };
const CODES = ["landwirtschaft", "kommune"];

const gueltig = {
  name: "Hof Mustermann",
  sektor: "landwirtschaft",
  sitz_strasse: "Dorfstraße",
  sitz_hausnummer: "3",
  sitz_plz: "67346",
  sitz_ort: "Speyer",
  lat: "49.32",
  lng: "8.43",
};

/** Fake-Transaktion: merkt Inserts samt Werten; schreibt nichts. */
function fakeTx() {
  const inserts: { tabelle: string; werte: Record<string, unknown> }[] = [];
  const tx = {
    insert: (t: unknown) => ({
      values: (werte: Record<string, unknown>) => ({
        returning: async () => {
          inserts.push({ tabelle: getTableName(t as never), werte });
          return [{ id: "akteur-neu", name: werte.name, sektor: werte.sektor }];
        },
      }),
    }),
  };
  return { tx: tx as never, inserts };
}

beforeEach(() => {
  protokolle.length = 0;
  kreisArs = "08215";
});

describe("akteurAnlegenInTx — Pflichtfelder E66", () => {
  it("legt mit vollständiger Eingabe genau einen Akteur an und protokolliert akteur_angelegt", async () => {
    const { tx, inserts } = fakeTx();
    const r = await akteurAnlegenInTx(tx, pruefer, { eingabe: gueltig, aktiveCodes: CODES });
    expect(r).toEqual({ id: "akteur-neu", name: "Hof Mustermann", sektor: "landwirtschaft" });
    expect(inserts.map((i) => i.tabelle)).toEqual(["akteur"]);
    expect(inserts[0]!.werte).toMatchObject({
      name: "Hof Mustermann",
      sektor: "landwirtschaft",
      sitzStrasse: "Dorfstraße",
      sitzHausnummer: "3",
      sitzPlz: "67346",
      sitzOrt: "Speyer",
      status: "entwurf",
    });
    expect(inserts[0]!.werte.sitzGeom).toBeDefined();
    expect(protokolle).toHaveLength(1);
    expect(protokolle[0]).toMatchObject({
      art: "akteur_angelegt",
      entitaet: "akteur",
      id: "akteur-neu",
      benutzerId: pruefer.id,
      benutzerEmail: pruefer.email,
    });
    expect(protokolle[0]!.importLaufId).toBeUndefined();
  });

  it.each([
    ["ohne Name", { ...gueltig, name: "" }, "Name ist Pflicht."],
    ["ohne PLZ", { ...gueltig, sitz_plz: "" }, "PLZ und Ort des Sitzes sind Pflicht."],
    ["ohne Ort", { ...gueltig, sitz_ort: "" }, "PLZ und Ort des Sitzes sind Pflicht."],
    ["ohne Pin", { ...gueltig, lat: "", lng: "" }, OHNE_ORT],
    ["mit unbekanntem Sektor", { ...gueltig, sektor: "bergbau" }, /Unbekannter Sektor/],
  ])("weist %s ab, ohne zu schreiben", async (_name, eingabe, fehler) => {
    const { tx, inserts } = fakeTx();
    await expect(akteurAnlegenInTx(tx, pruefer, { eingabe, aktiveCodes: CODES })).rejects.toThrow(fehler);
    await expect(akteurAnlegenInTx(tx, pruefer, { eingabe, aktiveCodes: CODES })).rejects.toBeInstanceOf(AkteurFehlerAusnahme);
    expect(inserts).toHaveLength(0);
    expect(protokolle).toHaveLength(0);
  });

  it("Straße und Hausnummer sind optional (unvollständiger Sitz, E66) und werden als null geschrieben", async () => {
    const { tx, inserts } = fakeTx();
    await akteurAnlegenInTx(tx, pruefer, { eingabe: { ...gueltig, sitz_strasse: "", sitz_hausnummer: "" }, aktiveCodes: CODES });
    expect(inserts[0]!.werte).toMatchObject({ sitzStrasse: null, sitzHausnummer: null });
  });

  it("leerer Sektor wird die Systemzeile ohne_sektor, nicht NULL", async () => {
    const { tx, inserts } = fakeTx();
    await akteurAnlegenInTx(tx, pruefer, { eingabe: { ...gueltig, sektor: "" }, aktiveCodes: CODES });
    expect(inserts[0]!.werte.sektor).toBe("ohne_sektor");
  });
});

describe("akteurAnlegenInTx — Sitz und Kreis (E25)", () => {
  it("ohne bestimmbaren Kreis-ARS scheitert die Anlage nach dem Insert mit OHNE_ORT und protokolliert nichts", async () => {
    kreisArs = null;
    const { tx, inserts } = fakeTx();
    await expect(akteurAnlegenInTx(tx, pruefer, { eingabe: gueltig, aktiveCodes: CODES })).rejects.toThrow(OHNE_ORT);
    // Der Insert ist in der Fake-Tx passiert; im Betrieb rollt die Transaktion
    // zurueck, weil die Ausnahme sie verlaesst. Protokolliert wird nie.
    expect(inserts).toHaveLength(1);
    expect(protokolle).toHaveLength(0);
  });
});

describe("akteurAnlegenInTx — Rechte und Import", () => {
  it("Betrachter kommt am Baustein nicht vorbei: keine Wirkung, Fehler „Kein Recht“", async () => {
    const { tx, inserts } = fakeTx();
    await expect(akteurAnlegenInTx(tx, betrachter, { eingabe: gueltig, aktiveCodes: CODES })).rejects.toThrow(/Kein Recht/);
    expect(inserts).toHaveLength(0);
    expect(protokolle).toHaveLength(0);
  });

  it("reicht die Lauf-ID des Imports ans Ereignis durch (aenderung.import_lauf_id, E67)", async () => {
    const { tx } = fakeTx();
    await akteurAnlegenInTx(tx, pruefer, { eingabe: gueltig, aktiveCodes: CODES, importLaufId: "lauf-1" });
    expect(protokolle[0]).toMatchObject({ art: "akteur_angelegt", importLaufId: "lauf-1" });
  });
});
