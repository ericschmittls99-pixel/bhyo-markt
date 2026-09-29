/**
 * E56 „Für mich": jedes der drei Kriterien einzeln, die Kombination mit
 * anderen Filtern, der Export-Klartext und der Schalter nur fuer Nicht-
 * Betrachter. Der Pool ist ein Fixture; die Beteiligung kommt als Menge.
 */
import { describe, expect, it } from "vitest";

import { filterKlartext } from "./export-filtertext";
import { FILTER } from "./filter-modell";
import { fuerMichAktiv, istFuerMich, kriterienFuer, reichereFuerMichAn, zeigeFuerMich } from "./fuer-mich";
import { filterStroeme, LEERER_FILTER, type Strom } from "./stroeme-modell";

const ICH = "00000000-0000-4000-8000-0000000000e1";
const ANDERE = "00000000-0000-4000-8000-0000000000a2";
const nutzer = (id: string) => ({ id, name: null, email: `${id.slice(-2)}@bhyo.de` });

function strom(id: string, extra: Partial<Strom> = {}): Strom {
  return {
    id,
    art: "biomasse",
    akteurId: null,
    akteurName: `Akteur ${id}`,
    sektor: null,
    sektorLabel: null,
    bezeichnung: null,
    kontaktperson: null,
    ort: null,
    verwaltung: null,
    regionIds: [],
    regionNamen: [],
    lng: null,
    lat: null,
    cluster: "holz",
    materialartCode: null,
    materialartLabel: null,
    mengeFm: null,
    tsAnteil: null,
    aschegehalt: null,
    mengeAtro: null,
    preisMin: null,
    preisMittel: null,
    preisMax: null,
    preisHerkunft: null,
    gruppe: null,
    gruppeLabel: null,
    produktCode: null,
    produktLabel: null,
    mengeWert: null,
    mengeEinheit: null,
    preis: null,
    preisEinheit: null,
    qualitaet: null,
    status: "entwurf",
    reserviertBhyo: false,
    reserviertSeit: null,
    erstelltAm: "2026-09-01",
    beleg: null,
    vollstaendigkeit: 0,
    ...extra,
  } as Strom;
}

const GESPERRT = strom("s-gesperrt", { sperre: { von: nutzer(ICH), am: "2026-09-29T10:00:00Z" } as never });
const FREMD_GESPERRT = strom("s-fremd", { sperre: { von: nutzer(ANDERE), am: "2026-09-29T10:00:00Z" } as never });
const ZUGEWIESEN = strom("s-zugewiesen", { sperre: { von: nutzer(ANDERE), am: "2026-09-29T10:00:00Z" } as never, zuweisungen: [nutzer(ICH)] });
const BETEILIGT = strom("s-beteiligt");
const NICHTS = strom("s-nichts", { cluster: "reststoffe" });
const POOL = [GESPERRT, FREMD_GESPERRT, ZUGEWIESEN, BETEILIGT, NICHTS];
const BETEILIGT_IDS = new Set(["s-beteiligt"]);

describe("istFuerMich — jedes Kriterium einzeln", () => {
  it("von mir gesperrt", () => {
    expect(kriterienFuer(GESPERRT, ICH, new Set())).toEqual({ gesperrtVonMir: true, mirZugewiesen: false, beteiligt: false });
    expect(istFuerMich(GESPERRT, ICH, new Set())).toBe(true);
    expect(istFuerMich(FREMD_GESPERRT, ICH, new Set())).toBe(false);
  });
  it("mir zugewiesen", () => {
    expect(kriterienFuer(ZUGEWIESEN, ICH, new Set())).toEqual({ gesperrtVonMir: false, mirZugewiesen: true, beteiligt: false });
    expect(istFuerMich(ZUGEWIESEN, ICH, new Set())).toBe(true);
    expect(istFuerMich(ZUGEWIESEN, ANDERE, new Set())).toBe(true); // ANDERE ist Inhaber
  });
  it("beteiligt laut Protokoll", () => {
    expect(kriterienFuer(BETEILIGT, ICH, BETEILIGT_IDS)).toEqual({ gesperrtVonMir: false, mirZugewiesen: false, beteiligt: true });
    expect(istFuerMich(BETEILIGT, ICH, BETEILIGT_IDS)).toBe(true);
    expect(istFuerMich(BETEILIGT, ICH, new Set())).toBe(false);
  });
  it("nichts davon", () => {
    expect(istFuerMich(NICHTS, ICH, BETEILIGT_IDS)).toBe(false);
  });
});

describe("Filter „Für mich“ im Filtermodell", () => {
  const pool = reichereFuerMichAn(POOL, ICH, BETEILIGT_IDS);
  it("Alle (Standard): der Schalter wirkt nicht", () => {
    expect(filterStroeme(pool, LEERER_FILTER, "stroeme").map((s) => s.id)).toEqual(POOL.map((s) => s.id));
    expect(fuerMichAktiv("")).toBe(false);
  });
  it("Für mich: genau die drei Kriterien, in stroeme. und karte.", () => {
    for (const ansicht of ["stroeme", "karte"] as const) {
      expect(filterStroeme(pool, { ...LEERER_FILTER, fuer: "mich" }, ansicht).map((s) => s.id)).toEqual([
        "s-gesperrt",
        "s-zugewiesen",
        "s-beteiligt",
      ]);
    }
    expect(fuerMichAktiv("mich")).toBe(true);
  });
  it("kombiniert mit anderen Filtern (UND)", () => {
    expect(filterStroeme(pool, { ...LEERER_FILTER, fuer: "mich", cluster: ["holz"] }, "stroeme").map((s) => s.id)).toEqual([
      "s-gesperrt",
      "s-zugewiesen",
      "s-beteiligt",
    ]);
    expect(filterStroeme(pool, { ...LEERER_FILTER, fuer: "mich", cluster: ["reststoffe"] }, "stroeme")).toEqual([]);
    expect(filterStroeme(pool, { ...LEERER_FILTER, fuer: "mich", q: "s-beteiligt" }, "stroeme").map((s) => s.id)).toEqual(["s-beteiligt"]);
  });
  it("gilt nicht in auswertung. (dort zurueckgehalten, nicht angewendet)", () => {
    const def = FILTER.find((f) => f.key === "fuerMich")!;
    expect(def.ansichten).toEqual(["stroeme", "karte"]);
    expect(filterStroeme(pool, { ...LEERER_FILTER, fuer: "mich" }, "auswertung")).toHaveLength(POOL.length);
  });
  it("Export: die aktive Filterzeile nennt „Für mich“", () => {
    const def = FILTER.find((f) => f.key === "fuerMich")!;
    expect(filterKlartext([def], { fuer: "mich" }, {})).toEqual(["Für mich"]);
    expect(filterKlartext([def], { fuer: "" }, {})).toEqual([]);
  });
});

describe("Schalter nur fuer Nicht-Betrachter", () => {
  const zugang = (rolle: "betrachter" | "bearbeiter" | "pruefer" | "admin") =>
    ({ art: "erlaubt", id: ICH, email: "x@bhyo.de", rolle, name: null }) as const;
  it("Betrachter koennen nicht beteiligt sein — kein Schalter", () => {
    expect(zeigeFuerMich(zugang("betrachter"))).toBe(false);
    expect(zeigeFuerMich({ art: "unbekannt", email: "x@bhyo.de" })).toBe(false);
  });
  it("Bearbeiter, Pruefer, Admin sehen ihn", () => {
    for (const r of ["bearbeiter", "pruefer", "admin"] as const) expect(zeigeFuerMich(zugang(r))).toBe(true);
  });
});
