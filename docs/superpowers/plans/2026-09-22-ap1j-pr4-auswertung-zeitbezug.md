# AP1j PR ④ — auswertung.: monatsscharfe Rechnung, Jahr-Filter, Switches, E16-Deckel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alle auswertung.-KPIs und -Module rechnen monatsscharf mit Saisonalität über ein wählbares Bezugsjahr/-fenster; der Status-Filter wirkt fensterbezogen; Jahresachse mit E16-Deckel; CSV-Export trägt die neuen Felder.

**Architecture:** Ein neues pures Modul `lib/fenster.ts` zerlegt jeden Strom monatsscharf in Kategorien (frei/reserviert/vergeben extern/bhyo) und liefert einen Fensterfaktor. Der Trick fürs Wiring: `wendeFensterAn` gibt **skalierte Strom-Kopien** zurück (Mengenfelder × Faktor) — alle bestehenden Modul-Funktionen rechnen damit unverändert fensterbezogen. Nur die Jahres-Module bekommen eine eigene monatsscharfe Reihe (je Jahr eigener Faktor) plus E16-Deckel.

**Tech Stack:** Next.js App Router (`apps/web/AGENTS.md` beachten), Vitest; kein Schema-Change.

**Spec:** `docs/ap1j-handoff-verfuegbarkeit-vergabe.md` — „Monatsscharfe Mengenrechnung", „auswertung.: Zeitbezug und Filter" (inkl. E16-Deckel, Filter ohne Vorauswahl), „Sonstiges" (CSV).

## Global Constraints

- Monatsformel exakt nach Handoff: **Wert eines Jahres = Rate × Σ(Saisonanteile der zählenden Monate)**; Saisonanteil = `saisonalitaet[m]/100`, ohne Profil Gleichverteilung `1/12` je Monat; jeder Monat exakt einmal zugeordnet (offene Vergabe-Enden normalisiert).
- Status-Filter (verfuegbarkeit-Facette) wirkt in auswertung. **fensterbezogen**, NICHT auf heute; startet ohne Vorauswahl; übergreifende Fenster zeigen Ströme anteilig in mehreren Kategorien.
- Switches: Einzeljahr (Default: aktuelles Jahr) ↔ Zeitraum; ø pro Jahr ↔ Summe im Zeitraum (bei Einzeljahr identisch). URL-Parameter: `zeitmodus` (`einzeljahr`|`zeitraum`), `jahre` (kommagetrennt), `agg` (`oe`|`summe`).
- E16-Deckel: Achse endet bei `min(spätestes Zeitraumende, aktuelles Jahr + 10)`, Überlauf-Marker „+ bis JJJJ" an der letzten Säule. Test: Beleg bis 2099 → Achse endet bei Jahr+10, Marker vorhanden.
- Alle KPIs/Module (auch Preis/Potenzial = Preis × fensterbezogene Menge) nutzen dieselbe Fenster-Menge; Zeitpunkte entstehen an der Seitengrenze, nie im Modell.
- Mini-Switch-Optik nach design-system.md („Mini-Switch"); Beschriftungen Deutsch, Enum-Werte snake_case.
- Tests: `pnpm --filter web exec vitest run lib/fenster.test.ts` etc.; Commits `AP1j ④:`; Branch `ap1j-auswertung-zeitbezug` von main.

---

### Task 1: `lib/fenster.ts` — Monatszerlegung und Fensterfaktor (TDD)

**Files:** Create `apps/web/lib/fenster.ts`, `apps/web/lib/fenster.test.ts`

**Interfaces (Produces):**
```ts
export type FensterKategorie =
  | "verfuegbar" | "reserviert_bhyo" | "vergeben_extern" | "vergeben_bhyo";
export const ALLE_FENSTER_KATEGORIEN: readonly FensterKategorie[];
export function jahresAnteil(jahr: number, strom: FensterStrom, vergaben: VergabeDaten[], kategorien: ReadonlySet<FensterKategorie> | null): number;
export function fensterKategorien(jahre: number[], strom: FensterStrom, vergaben: VergabeDaten[]): Set<string>; // + "abgelaufen"/"noch_nicht_verfuegbar"
export function fensterFaktor(jahre: number[], strom: FensterStrom, vergaben: VergabeDaten[], kategorien: ReadonlySet<FensterKategorie> | null, agg: "oe" | "summe"): number;
export function wendeFensterAn(stroeme: Strom[], vergabenMap: Map<string, VergabeDaten[]>, jahre: number[], statusAuswahl: string[], agg: "oe" | "summe"): Strom[];
// FensterStrom = { zeitraumVon/Bis: string|null, reserviertBhyo: boolean, saisonalitaet: number[]|null }
```

- [ ] **Step 1: Failing Tests** — die Handoff-Beispiele wörtlich:

```ts
import { describe, expect, it } from "vitest";
import {
  fensterFaktor, fensterKategorien, jahresAnteil, wendeFensterAn,
} from "./fenster";
import type { Strom } from "./stroeme-modell";
import type { VergabeDaten } from "./verfuegbarkeit";

const strom = (p: Partial<Strom>): Strom => ({ /* wie stroeme-modell.test-Builder; hier via Cast: */ } as never);
const basis = {
  zeitraumVon: "2026-01-01", zeitraumBis: "2035-12-31",
  reserviertBhyo: false, saisonalitaet: null,
} as Strom;
const v = (o: Partial<VergabeDaten>): VergabeDaten => ({
  vergebenVon: null, vergebenBis: null, vergebenAn: null, anBhyo: false, ...o,
});

describe("jahresAnteil (Handoff: Rate × Σ Saisonanteile)", () => {
  it("Gleichverteilung: n Monate ÷ 12 — Beleg ab 07/2026 zählt 2026 mit 6/12", () => {
    const s = { ...basis, zeitraumVon: "2026-07-01" } as Strom;
    expect(jahresAnteil(2026, s, [], null)).toBeCloseTo(6 / 12, 10);
    expect(jahresAnteil(2027, s, [], null)).toBeCloseTo(1, 10);
    expect(jahresAnteil(2025, s, [], null)).toBe(0);
  });
  it("Saisonprofil: Jul–Dez-Anteile statt 6/12", () => {
    const saison = [0, 0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 50]; // Σ 100
    const s = { ...basis, zeitraumVon: "2026-07-01", saisonalitaet: saison } as Strom;
    expect(jahresAnteil(2026, s, [], null)).toBeCloseTo(1, 10); // Jul–Dez = 100 %
  });
  it("Teilvergabe: verfügbar 2026–2035, vergeben bis 06/2028 — Monate bis 06/2028 vergeben, ab 07/2028 frei", () => {
    const vergaben = [v({ vergebenBis: "2028-06-30" })];
    const frei = new Set(["verfuegbar"] as const);
    const extern = new Set(["vergeben_extern"] as const);
    expect(jahresAnteil(2027, basis, vergaben, frei)).toBe(0);
    expect(jahresAnteil(2027, basis, vergaben, extern)).toBeCloseTo(1, 10);
    expect(jahresAnteil(2028, basis, vergaben, frei)).toBeCloseTo(6 / 12, 10);
    expect(jahresAnteil(2028, basis, vergaben, extern)).toBeCloseTo(6 / 12, 10);
  });
  it("freie Monate mit Reservierung zählen als reserviert_bhyo, nicht als verfuegbar", () => {
    const s = { ...basis, reserviertBhyo: true } as Strom;
    expect(jahresAnteil(2027, s, [], new Set(["verfuegbar"]))).toBe(0);
    expect(jahresAnteil(2027, s, [], new Set(["reserviert_bhyo"]))).toBeCloseTo(1, 10);
  });
});

describe("fensterKategorien", () => {
  it("übergreifendes Fenster: anteilig in beiden Kategorien", () => {
    const vergaben = [v({ vergebenBis: "2028-06-30" })];
    const k = fensterKategorien([2026, 2027, 2028, 2029, 2030], basis, vergaben);
    expect(k.has("vergeben_extern")).toBe(true);
    expect(k.has("verfuegbar")).toBe(true);
  });
  it("Fenster nur 2026–2027: nur vergeben (extern)", () => {
    const vergaben = [v({ vergebenBis: "2028-06-30" })];
    const k = fensterKategorien([2026, 2027], basis, vergaben);
    expect(k.has("vergeben_extern")).toBe(true);
    expect(k.has("verfuegbar")).toBe(false);
  });
  it("Verfügbarkeit komplett vor dem Fenster → abgelaufen", () => {
    const s = { ...basis, zeitraumVon: "2025-01-01", zeitraumBis: "2025-12-31" } as Strom;
    expect(fensterKategorien([2030], s, [])).toEqual(new Set(["abgelaufen"]));
  });
  it("Verfügbarkeit komplett nach dem Fenster → noch_nicht_verfuegbar", () => {
    const s = { ...basis, zeitraumVon: "2030-01-01", zeitraumBis: "2035-12-31" } as Strom;
    expect(fensterKategorien([2026], s, [])).toEqual(new Set(["noch_nicht_verfuegbar"]));
  });
});

describe("fensterFaktor", () => {
  it("Einzeljahr: ø und Summe identisch", () => {
    expect(fensterFaktor([2027], basis, [], null, "oe")).toBeCloseTo(
      fensterFaktor([2027], basis, [], null, "summe"), 10,
    );
  });
  it("Zeitraum: Summe = Σ Jahre, ø = Summe ÷ Jahre", () => {
    const jahre = [2026, 2027];
    const summe = fensterFaktor(jahre, basis, [], null, "summe");
    expect(summe).toBeCloseTo(2, 10);
    expect(fensterFaktor(jahre, basis, [], null, "oe")).toBeCloseTo(1, 10);
  });
});

describe("wendeFensterAn", () => {
  it("skaliert die Mengenfelder und filtert nach Fensterkategorien", () => {
    const s1 = { ...basis, id: "a", art: "biomasse", mengeAtro: 100, mengeFm: 200 } as Strom;
    const s2 = { ...basis, id: "b", art: "biomasse", mengeAtro: 100, mengeFm: 200,
      zeitraumVon: "2025-01-01", zeitraumBis: "2025-12-31" } as Strom;
    const map = new Map([["a", [v({ vergebenBis: "2027-06-30" })]]]);
    // 2027, nur "verfuegbar": s1 zählt Jul–Dez (0,5), s2 (abgelaufen) fliegt raus.
    const erg = wendeFensterAn([s1, s2], map, [2027], ["verfuegbar"], "oe");
    expect(erg.map((s) => s.id)).toEqual(["a"]);
    expect(erg[0]!.mengeAtro).toBeCloseTo(50, 10);
    expect(erg[0]!.mengeFm).toBeCloseTo(100, 10);
  });
  it("ohne Status-Auswahl zählen alle vier Mengen-Kategorien; abgelaufene bleiben mit Menge 0", () => {
    const s2 = { ...basis, id: "b", art: "biomasse", mengeAtro: 100,
      zeitraumVon: "2025-01-01", zeitraumBis: "2025-12-31" } as Strom;
    const erg = wendeFensterAn([s2], new Map(), [2027], [], "oe");
    expect(erg).toHaveLength(1);
    expect(erg[0]!.mengeAtro).toBe(0);
  });
});
```

(Der `strom`-Builder ist hier unnötig — die Casts über `as Strom` reichen, weil nur die Fenster-Felder gelesen werden. `basis` bekommt zusätzlich `id: ""` falls TS meckert.)

- [ ] **Step 2: FAIL verifizieren.**
- [ ] **Step 3: Implementieren** (`lib/fenster.ts`):

```ts
import type { Strom } from "./stroeme-modell";
import type { VergabeDaten } from "./verfuegbarkeit";

/**
 * Monatsscharfe Fensterrechnung (AP1j PR 4, Handoff E19): Wert eines Jahres
 * = Rate × Σ(Saisonanteile der zaehlenden Monate). Jeder Monat ist exakt
 * einer Kategorie zugeordnet (offene Vergabe-Enden werden durch
 * Verfuegbarkeitsbeginn/-ende ersetzt); frei + Reservierung = reserviert.
 * Rein — Zeitpunkte kommen als Parameter.
 */

export type FensterKategorie =
  | "verfuegbar"
  | "reserviert_bhyo"
  | "vergeben_extern"
  | "vergeben_bhyo";

export const ALLE_FENSTER_KATEGORIEN: readonly FensterKategorie[] = [
  "verfuegbar",
  "reserviert_bhyo",
  "vergeben_extern",
  "vergeben_bhyo",
];

type FensterStrom = Pick<
  Strom,
  "zeitraumVon" | "zeitraumBis" | "reserviertBhyo" | "saisonalitaet"
>;

/** Saisonanteil eines Monats (0-basiert): Profil in % der Jahresmenge, sonst 1/12. */
function saisonAnteil(saison: number[] | null, monat: number): number {
  if (!saison || saison.length !== 12) return 1 / 12;
  const summe = saison.reduce((a, b) => a + b, 0);
  if (summe <= 0) return 1 / 12;
  // Auf die Profilsumme normieren (Gleichverteilung speichert 99,6 statt 100).
  return (saison[monat] ?? 0) / summe;
}

const monatsKey = (jahr: number, monat: number) =>
  `${jahr}-${String(monat + 1).padStart(2, "0")}`;

/** Kategorie eines Monats oder null ausserhalb des Verfuegbarkeitszeitraums. */
function monatsKategorie(
  jahr: number,
  monat: number,
  strom: FensterStrom,
  vergaben: VergabeDaten[],
): FensterKategorie | null {
  if (!strom.zeitraumVon || !strom.zeitraumBis) return null;
  const m = monatsKey(jahr, monat);
  if (m < strom.zeitraumVon.slice(0, 7) || m > strom.zeitraumBis.slice(0, 7))
    return null;
  const aktiv = vergaben.find(
    (v) =>
      m >= (v.vergebenVon ?? strom.zeitraumVon!).slice(0, 7) &&
      m <= (v.vergebenBis ?? strom.zeitraumBis!).slice(0, 7),
  );
  if (aktiv) return aktiv.anBhyo ? "vergeben_bhyo" : "vergeben_extern";
  return strom.reserviertBhyo ? "reserviert_bhyo" : "verfuegbar";
}

/** Σ Saisonanteile der Monate eines Jahres in den gewuenschten Kategorien (null = alle). */
export function jahresAnteil(
  jahr: number,
  strom: FensterStrom,
  vergaben: VergabeDaten[],
  kategorien: ReadonlySet<FensterKategorie> | null,
): number {
  let anteil = 0;
  for (let m = 0; m < 12; m++) {
    const k = monatsKategorie(jahr, m, strom, vergaben);
    if (k && (kategorien == null || kategorien.has(k)))
      anteil += saisonAnteil(strom.saisonalitaet, m);
  }
  return anteil;
}

/**
 * Fensterbezogene Status-Kategorien eines Stroms: Mengen-Kategorien mit
 * Anteil > 0, plus abgelaufen/noch_nicht_verfuegbar, wenn die Verfuegbarkeit
 * komplett vor bzw. nach dem Fenster liegt (Menge 0, aber filterbar).
 */
export function fensterKategorien(
  jahre: number[],
  strom: FensterStrom,
  vergaben: VergabeDaten[],
): Set<string> {
  const k = new Set<string>();
  for (const kat of ALLE_FENSTER_KATEGORIEN) {
    const s = new Set([kat]);
    if (jahre.some((jahr) => jahresAnteil(jahr, strom, vergaben, s) > 0)) k.add(kat);
  }
  if (strom.zeitraumVon && strom.zeitraumBis && jahre.length) {
    const lo = Math.min(...jahre);
    const hi = Math.max(...jahre);
    if (Number(strom.zeitraumBis.slice(0, 4)) < lo) k.add("abgelaufen");
    if (Number(strom.zeitraumVon.slice(0, 4)) > hi) k.add("noch_nicht_verfuegbar");
  }
  return k;
}

/** Fensterfaktor: Σ Jahresanteile; ø teilt durch die Fensterjahre. */
export function fensterFaktor(
  jahre: number[],
  strom: FensterStrom,
  vergaben: VergabeDaten[],
  kategorien: ReadonlySet<FensterKategorie> | null,
  agg: "oe" | "summe",
): number {
  const summe = jahre.reduce(
    (n, jahr) => n + jahresAnteil(jahr, strom, vergaben, kategorien),
    0,
  );
  return agg === "oe" && jahre.length ? summe / jahre.length : summe;
}

/**
 * Fenster auf den Pool anwenden: fensterbezogener Status-Filter plus
 * SKALIERTE Strom-Kopien (Mengenfelder × Faktor) — alle bestehenden
 * auswertung-Module rechnen damit unveraendert fensterbezogen; Preis ×
 * skalierte Menge ergibt automatisch das fensterbezogene Potenzial.
 */
export function wendeFensterAn(
  stroeme: Strom[],
  vergabenMap: Map<string, VergabeDaten[]>,
  jahre: number[],
  statusAuswahl: string[],
  agg: "oe" | "summe",
): Strom[] {
  const mengenKategorien: ReadonlySet<FensterKategorie> = new Set(
    statusAuswahl.length
      ? ALLE_FENSTER_KATEGORIEN.filter((k) => statusAuswahl.includes(k))
      : ALLE_FENSTER_KATEGORIEN,
  );
  const erg: Strom[] = [];
  for (const s of stroeme) {
    const vergaben = vergabenMap.get(s.id) ?? [];
    if (statusAuswahl.length) {
      const k = fensterKategorien(jahre, s, vergaben);
      if (!statusAuswahl.some((a) => k.has(a))) continue;
    }
    const f = fensterFaktor(jahre, s, vergaben, mengenKategorien, agg);
    erg.push({
      ...s,
      mengeAtro: s.mengeAtro == null ? null : s.mengeAtro * f,
      mengeFm: s.mengeFm == null ? null : s.mengeFm * f,
      mengeWert: s.mengeWert == null ? null : s.mengeWert * f,
    });
  }
  return erg;
}
```

- [ ] **Step 4: PASS + Commit** — `AP1j ④: fenster.ts — monatsscharfe Zerlegung, Fensterfaktor, skalierte Strom-Kopien`

---

### Task 2: Jahresachse mit E16-Deckel + monatsscharfe Jahreswerte

**Files:** Modify `apps/web/lib/auswertung-modell.ts`; Test `apps/web/lib/auswertung-modell.test.ts`

**Interfaces:**
- `JahresBalken` += `ueberlaufBis: number | null` (nur letzte Säule ≠ null).
- Signaturen: `jahresBalken(recs, aktuellesJahr, vergabenMap, kategorien)` und `outputJahre(recs, aktuellesJahr, vergabenMap, kategorien)` — `vergabenMap: Map<string, VergabeDaten[]>`, `kategorien: ReadonlySet<FensterKategorie> | null`.

- [ ] **Step 1: Failing Tests** (an auswertung-modell.test.ts; bestehende jahresBalken-Aufrufe im Test um `new Map(), null` ergänzen):

```ts
it("E16-Deckel: Beleg bis 2099 → Achse endet bei aktuellem Jahr + 10, Überlauf-Marker", () => {
  const s = strom({ id: "x", zeitraumVon: "2026-01-01", zeitraumBis: "2099-12-31", mengeAtro: 120 });
  const balken = jahresBalken([s], 2026, new Map(), null);
  expect(balken[balken.length - 1]!.jahr).toBe(2036);
  expect(balken[balken.length - 1]!.ueberlaufBis).toBe(2099);
  expect(balken[0]!.ueberlaufBis).toBeNull();
});

it("monatsscharf: Beleg ab 07/2026 zählt 2026 mit 6/12 der Rate", () => {
  const s = strom({ id: "y", zeitraumVon: "2026-07-01", zeitraumBis: "2027-12-31", mengeAtro: 120 });
  const balken = jahresBalken([s], 2026, new Map(), null);
  expect(balken.find((b) => b.jahr === 2026)!.wertText).toBe("60");
  expect(balken.find((b) => b.jahr === 2027)!.wertText).toBe("120");
});
```

- [ ] **Step 2: FAIL**, dann implementieren:
  - `jahresAchse` → `{ achse: number[]; ueberlaufBis: number | null }`: `hi = Math.min(hiRoh, aktuellesJahr + 10)`, `ueberlaufBis = hiRoh > hi ? hiRoh : null` (lo unverändert; lo > hi kann nicht auftreten, weil hi ≥ aktuellesJahr ≥ lo-Fallback).
  - `jahresWerte` ersetzen: `wert = Σ rateVon(s) × jahresAnteil(jahr, s, vergabenMap.get(s.id) ?? [], kategorien)` (Import aus `./fenster`); der alte Volljahres-/E17-Zweig entfällt (jahresAnteil liefert 0 außerhalb).
  - `zuJahresBalken(achse, werte, aktuellesJahr, ueberlaufBis)` setzt `ueberlaufBis` nur am letzten Balken, sonst `null`.
  - `jahresBalken`/`outputJahre` reichen `vergabenMap`/`kategorien` durch; Achsen-Aufrufer destrukturieren.
  - WICHTIG: Diese zwei Funktionen erwarten **unskalierte** recs (Original-Rate) — im JSDoc festhalten.
- [ ] **Step 3: PASS (alle Suites) + Commit** — `AP1j ④: Jahresachse mit E16-Deckel, Jahreswerte monatsscharf`

---

### Task 3: Seite verdrahten — Fenster-Params, vergabenMap, Facette

**Files:** Modify `apps/web/app/auswertung/page.tsx`; Modify `apps/web/lib/auswertung-modell.ts` (kpiKarten-Einheiten)

- [ ] **Step 1: Params parsen** (nach `filter`):

```ts
const zeitmodus = ersterWert(sp.zeitmodus) === "zeitraum" ? ("zeitraum" as const) : ("einzeljahr" as const);
const agg = zeitmodus === "zeitraum" && ersterWert(sp.agg) === "summe" ? ("summe" as const) : ("oe" as const);
const jahreRoh = ersterWert(sp.jahre).split(",").map(Number).filter((n) => Number.isInteger(n));
```

- [ ] **Step 2: Laden + Fenster anwenden** (ersetzt `const recs = filterStroeme(pool, filter);`):

```ts
const [pool, regionen, vergabenMap] = await Promise.all([
  ladeStroeme(art), ladeRegionOptionen(), ladeAlleVergaben(art),
]);
// verfuegbarkeit wirkt hier FENSTERBEZOGEN (Handoff), nicht auf heute —
// aus dem heute-Filter heraushalten und unten ueber wendeFensterAn anwenden.
const recsHeute = filterStroeme(pool, { ...filter, verfuegbarkeit: [] });

// Achse fuer die Jahr-Pillen aus dem POOL (E16-gedeckelt): welche Jahre
// anwaehlbar sind, haengt nicht von der aktuellen Auswahl ab.
const { achse: poolAchse } = /* jahresAchseVonPool: exportierte Helper-Variante, s.u. */
const jahre =
  zeitmodus === "einzeljahr"
    ? [jahreRoh.find((j) => poolAchse.includes(j)) ?? (poolAchse.includes(aktuellesJahr) ? aktuellesJahr : poolAchse[poolAchse.length - 1]!)]
    : (jahreRoh.filter((j) => poolAchse.includes(j)).length
        ? jahreRoh.filter((j) => poolAchse.includes(j))
        : poolAchse);

const recs = wendeFensterAn(recsHeute, vergabenMap, jahre, filter.verfuegbarkeit, agg);
```

Dafür in auswertung-modell.ts einen kleinen Export ergänzen: `export function poolJahresAchse(recs: Strom[], aktuellesJahr: number): number[]` (nutzt die gedeckelte jahresAchse intern). Jahres-Module bekommen die **unskalierten, heute-gefilterten** recs:

```ts
const fensterKats: ReadonlySet<FensterKategorie> | null = filter.verfuegbarkeit.length
  ? new Set(ALLE_FENSTER_KATEGORIEN.filter((k) => filter.verfuegbarkeit.includes(k)))
  : null;
// jahresBalken(recsHeute, aktuellesJahr, vergabenMap, fensterKats) bzw. outputJahre(...)
```

- [ ] **Step 3: Facette + Ansicht-Props**
  - Facetten-Liste: nach Status `{ key: "verfuegbarkeit", label: "Verfügbarkeit", optionen: opt.verfuegbarkeit ?? [] }` (facettenOptionen liefert sie seit PR ③).
  - Neue Props an `AuswertungAnsicht`: `zeitmodus`, `agg`, `jahre`, `poolAchse` (für die Jahr-Pillen).
  - `kpiKarten(recs, sicht, agg === "summe")` — dritter Parameter `kumuliert: boolean`; in kpiKarten nur die Einheiten-Strings umschalten: `t atro/a`→`t atro`, `t FM/a`→`t FM`, `MWh/a`→`MWh`, `€/a`→`€`, `Mio. €/a`→`Mio. €` (Handoff: Kumulation = t im Fenster).
- [ ] **Step 4: Build + bestehende Tests grün; Commit** — `AP1j ④: auswertung. rechnet über das Fenster — Params, vergabenMap, fensterbezogener Status-Filter`

---

### Task 4: UI — Zeitbezug-Zeile (Jahr-Pillen + zwei Switches), Überlauf-Marker

**Files:** Modify `apps/web/components/auswertung/AuswertungAnsicht.tsx`, `apps/web/app/globals.css`

- [ ] **Step 1: Zeitbezug-Zeile** direkt unter der Toolbar (Client, useUrlZustand.setze):

```tsx
<div className="aw-zeit" role="group" aria-label="Zeitbezug">
  <span className="mini-switch" role="group" aria-label="Einzeljahr oder Zeitraum">
    <button type="button" aria-pressed={zeitmodus === "einzeljahr"}
      onClick={() => setze({ zeitmodus: null, jahre: null, agg: null })}>Einzeljahr</button>
    <button type="button" aria-pressed={zeitmodus === "zeitraum"}
      onClick={() => setze({ zeitmodus: "zeitraum", jahre: jahre.join(",") })}>Zeitraum</button>
  </span>
  <span className="aw-jahr-pillen">
    {poolAchse.map((j) => (
      <button key={j} type="button" className={`fchip${jahre.includes(j) ? " aktiv" : ""}`}
        onClick={() => {
          if (zeitmodus === "einzeljahr") return setze({ jahre: String(j) });
          const neu = jahre.includes(j) ? jahre.filter((x) => x !== j) : [...jahre, j].sort();
          setze({ jahre: neu.length ? neu.join(",") : null });
        }}>{j}</button>
    ))}
  </span>
  {zeitmodus === "zeitraum" && (
    <span className="mini-switch" role="group" aria-label="Durchschnitt oder Summe">
      <button type="button" aria-pressed={agg === "oe"} onClick={() => setze({ agg: null })}>ø pro Jahr</button>
      <button type="button" aria-pressed={agg === "summe"} onClick={() => setze({ agg: "summe" })}>Summe im Zeitraum</button>
    </span>
  )}
</div>
```

Mini-Switch-Optik existiert bereits als Muster (Modul-Umschalter „energie ↔ CO₂ & Asche") — dieselben Klassen wiederverwenden; falls die bestehende Implementierung eine eigene Klasse nutzt (`aw-mini`, im Bestand nachschlagen), diese nehmen statt neuer CSS. `.aw-zeit` (flex, gap 10, wrap) und `.aw-jahr-pillen` (flex, gap 6) neu in globals.css.

- [ ] **Step 2: Überlauf-Marker** — in `jahresBalkenListe`: beim letzten Balken `b.ueberlaufBis != null` → unter dem Jahr-Label ein `<span className="aw-jahr-ueberlauf">+ bis {b.ueberlaufBis}</span>` (Caption-Typo, `--text-tertiary`).
- [ ] **Step 3: Build + Commit** — `AP1j ④: Zeitbezug-Zeile (Jahr-Pillen, Einzeljahr↔Zeitraum, ø↔Summe), Überlauf-Marker`

---

### Task 5: CSV-Export — neue Felder

**Files:** Modify `apps/web/app/api/auswertung/export/route.ts`

- [ ] **Step 1:** Nach dem Filtern anreichern und Spalten ergänzen (Handoff „CSV-Export nimmt die neuen Felder mit"):
  - Laden zusätzlich: `ladeAlleVergaben("biomasse"/"output")` analog zur Karte; `reichereVerfuegbarkeitAn` mit Server-`stichtag`.
  - Neue Header ans Ende: `"Verfügbarkeitsstatus (heute)", "Reserviert (bhyo)", "Reserviert seit", "Vergaben"`.
  - Zeilenwerte: `s.verfuegbarkeit ? verfuegbarkeitPill(s.art, s.verfuegbarkeit.status).text : ""`, `s.reserviertBhyo ? "ja" : "nein"`, `s.reserviertSeit ?? ""`, Vergaben als `vergaben.map((v) => `${vergabeLabel(v.vergebenVon, v.vergebenBis)} an ${v.vergebenAn ?? "–"} (${v.anBhyo ? "bhyo" : "extern"})`).join(" | ")`.
- [ ] **Step 2:** Build grün; Commit — `AP1j ④: CSV-Export — Verfügbarkeitsstatus, Reservierung, Vergaben`

---

### Task 6: Doku, Gesamtlauf, Preview-Durchstich, PR

- [ ] design-system.md: Abschnitt „Mini-Switch" um die zwei auswertung.-Switches ergänzen (Einzeljahr↔Zeitraum, ø↔Summe — URL-getrieben, anders als der Modul-Umschalter) und den Satz „folgen mit AP1j PR 4" aus der Pillen-Tabelle streichen; Jahresachsen-Abschnitt um den E16-Deckel ergänzen.
- [ ] `pnpm --filter web test && pnpm --filter web build` grün; Push, PR (`AP1j PR4: auswertung. — monatsscharfe Fensterrechnung, Jahr-Filter, Switches, E16-Deckel`), Preview-Deploy abwarten.
- [ ] Durchstich (Preview, Hintergrund-Tab reicht — kein MapLibre): 1) Sägewerk-Fall: Einzeljahr 2027 → Trockenmasse-KPI enthält die 768 t atro NICHT voll unter „Verfügbar" (vergeben bis 02/2028); Status-Filter „Vergeben (extern)" zeigt sie. 2) Einzeljahr 2025 vs 2026: 2025 zählt die Testströme, 2026 fast leer. 3) Zeitraum 2025–2026 + Summe vs ø. 4) Beleg bis 2099 anlegen wäre Datenänderung — stattdessen Unit-Test als Beleg für den Deckel. 5) CSV-Export herunterladbar? (curl scheitert an Access — Sichtprüfung Link reicht, Spalten via Unit der Route nicht testbar → im PR-Text vermerken.)

---

## Self-Review (durchgeführt)

- **Spec:** Monatsformel ✓ T1 (Handoff-Beispiele als Tests) · Gleichverteilung n/12 ✓ · Teilvergabe-Beispiel ✓ · Jahr-Filter an/abwählbar ✓ T3/T4 · Einzeljahr-Default aktuelles Jahr ✓ T3 · ø↔Summe (Einzeljahr identisch) ✓ T1/T3 · fensterbezogener Status-Filter inkl. anteilig-in-beiden ✓ T1/T3 · ohne Vorauswahl ✓ (kein Default gesetzt) · Preis/Potenzial × Fenster-Menge ✓ (Skalierungs-Ansatz) · E16-Deckel + Marker + Test ✓ T2/T4 · CSV ✓ T5 · Beobachtungs-Notiz (abgelaufene Anteile zählen im Bezugsjahr): Verhalten entspricht ihr — Jan–Jun-Anteile zählen, kein Vorfilter ✓.
- **Placeholder:** Ein bewusster Verweis („jahresAchseVonPool s.u.") ist in T3 als konkreter Export `poolJahresAchse` definiert. Keine offenen TBDs.
- **Typkonsistenz:** `FensterKategorie`/`ALLE_FENSTER_KATEGORIEN` T1→T2/T3; `JahresBalken.ueberlaufBis` T2→T4; `kpiKarten(recs, sicht, kumuliert)` T3; Props `zeitmodus/agg/jahre/poolAchse` T3→T4.
