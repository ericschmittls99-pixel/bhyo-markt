/**
 * AP2.7 PR a0 (E67): Der Schreibweg „Strom anlegen" als Baustein mit reinen
 * Eingabe-Objekten. Geprueft wird (1) die Uebersetzung aus FormData, (2) die
 * Validierung an einer Stelle und (3) dass der Baustein selbst Rechte prueft
 * und ohne Recht nichts schreibt — unabhaengig vom Eingang der Action.
 * Infrastruktur (DB, R2, Protokoll) ist gemockt; die Regeln sind echt.
 */
import { getTableName } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  withDb: async (fn: (db: unknown) => unknown) => fn({}),
  getBelegeBucket: async () => ({ put: async () => {} }),
  getEnvironment: async () => "test",
}));
const protokolle: unknown[] = [];
vi.mock("@/lib/protokoll", () => ({
  protokolliere: async (_tx: unknown, e: unknown) => {
    protokolle.push(e);
    return { id: "ereignis-1" };
  },
}));

const { FeldFehlerAusnahme, pruefeStromEingabe, stromAnlegenInTx, stromEingabeAusFormData } = await import("./strom-schreibweg");
const { ValidierungsFehler } = await import("./beleg-server");

function formular(felder: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(felder)) fd.set(k, v);
  return fd;
}

const gueltigBiomasse = {
  akteur_id: "00000000-0000-4000-8000-000000000001",
  materialart_code: "guelle_rind",
  menge_roh_fm: "1.234,5",
  ts_anteil_pct: "8,5",
  aschegehalt_pct: "1",
  zeitraum_von: "01/2026",
  zeitraum_bis: "12/2026",
  beleg_typ: "betriebsdaten",
  beleg_quellenangabe: "Betriebsdaten 2025",
  beleg_erhebungsdatum: "2026-10-01",
  beleg_gueltig_bis: "2027-10-01",
  bezeichnung: "Rindergülle",
  ort: "Speyer",
  plz: "67346",
  lat: "49,32",
  lng: "8,43",
  vergabe_0_marker: "1",
  vergabe_0_von: "03/2026",
  vergabe_0_bis: "05/2026",
  vergabe_0_an: "Biogas Kraichgau",
  reserviert_bhyo: "on",
};

/** Fake-Transaktion: zaehlt Inserts und liefert IDs; schreibt nichts. */
function fakeTx() {
  const inserts: string[] = [];
  const kette = (tabelle: string) => ({
    values: () => ({
      returning: async () => {
        inserts.push(tabelle);
        return [{ id: `${tabelle}-neu` }];
      },
      then: (res: (v: unknown) => void) => {
        inserts.push(tabelle);
        res([]);
      },
    }),
  });
  const tx = {
    insert: (t: unknown) => kette(getTableName(t as never)),
    delete: () => ({ where: async () => {} }),
  };
  return { tx, inserts };
}

describe("stromEingabeAusFormData", () => {
  it("bringt deutsche Eingaben einmal in die Speicherform und liest Vergaben und Beleg mit", () => {
    const e = stromEingabeAusFormData("biomasse", formular(gueltigBiomasse));
    expect(e.eingaben).toMatchObject({ mengeRohFm: "1234.5", tsAnteilPct: "8.5", vonMonat: "2026-01", bisMonat: "2026-12" });
    expect(e.felder).toMatchObject({ bezeichnung: "Rindergülle", plz: "67346", hausnummer: null });
    expect(e.vergaben).toEqual([{ vonMonat: "2026-03", bisMonat: "2026-05", an: "Biogas Kraichgau", anBhyo: false }]);
    expect(e.reserviertBhyo).toBe(true);
    expect(e.beleg).toMatchObject({ typ: "betriebsdaten", quellenangabe: "Betriebsdaten 2025", gueltigBis: "2027-10-01", datei: null });
  });
});

describe("pruefeStromEingabe", () => {
  it("meldet Pflichtfelder und Vergabefehler an einer Stelle", () => {
    const e = stromEingabeAusFormData("biomasse", formular({ ...gueltigBiomasse, akteur_id: "", vergabe_0_von: "2027-01" }));
    const fehler = pruefeStromEingabe(e, { neu: true });
    expect(fehler.akteur_id).toBeTruthy();
    expect(Object.keys(fehler).some((k) => k.startsWith("vergabe"))).toBe(true);
    expect(pruefeStromEingabe(stromEingabeAusFormData("biomasse", formular(gueltigBiomasse)), { neu: true })).toEqual({});
  });
});

describe("stromAnlegenInTx", () => {
  const e = () => stromEingabeAusFormData("biomasse", formular(gueltigBiomasse));

  it("schreibt Beleg, Strom, Vergaben und Protokoll in dieser Reihenfolge", async () => {
    protokolle.length = 0;
    const { tx, inserts } = fakeTx();
    const erg = await stromAnlegenInTx(tx as never, { id: "u1", email: "petra@bhyo.de", rolle: "bearbeiter" }, e(), "2026-10-06");
    expect(erg.id).toBe("biomassestrom-neu");
    expect(inserts).toEqual(["beleg", "biomassestrom", "vergabe_zeitraum"]);
    expect(protokolle).toHaveLength(1);
    expect(protokolle[0]).toMatchObject({ art: "angelegt", entitaet: "biomassestrom", id: "biomassestrom-neu", benutzerId: "u1" });
  });

  it("Rot: ein Betrachter kommt am Baustein nicht vorbei — kein Insert, kein Protokoll", async () => {
    protokolle.length = 0;
    const { tx, inserts } = fakeTx();
    await expect(stromAnlegenInTx(tx as never, { id: "u2", email: "leser@bhyo.de", rolle: "betrachter" }, e(), "2026-10-06")).rejects.toBeInstanceOf(ValidierungsFehler);
    expect(inserts).toEqual([]);
    expect(protokolle).toHaveLength(0);
  });

  it("validiert selbst: unvollstaendige Eingabe wirft Feldfehler vor jeder Wirkung", async () => {
    const { tx, inserts } = fakeTx();
    const unvollstaendig = stromEingabeAusFormData("biomasse", formular({ ...gueltigBiomasse, menge_roh_fm: "" }));
    await expect(stromAnlegenInTx(tx as never, { id: "u1", email: "petra@bhyo.de", rolle: "bearbeiter" }, unvollstaendig, "2026-10-06")).rejects.toBeInstanceOf(FeldFehlerAusnahme);
    expect(inserts).toEqual([]);
  });
});
