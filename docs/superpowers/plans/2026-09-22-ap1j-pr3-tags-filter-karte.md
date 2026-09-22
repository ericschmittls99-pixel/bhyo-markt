# AP1j PR ③ — ströme./karte.: Verfügbarkeits-Tag, Filter, Karten-Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der abgeleitete Verfügbarkeitsstatus wird in ströme. (Grid, Tabelle) und karte. (Sidebar, Marker-Tooltip) sichtbar und als Facette filterbar (heute-bezogen, ohne Vorauswahl); die Karten-Review-Beschlüsse (exklusiv filtern, Pool-Prinzip, Legende, Region) werden umgesetzt.

**Architecture:** Der Status wird serverseitig EINMAL je Request an den `Strom` angereichert (`Strom.verfuegbarkeit?`, optional — bestehende Aufrufer bleiben gültig) über eine neue pure Funktion plus einen Sammel-Loader für alle Vergaben einer Art. Filter/Facette laufen dann über das vorhandene `filterStroeme`/`facettenOptionen`-Muster. Labels sind je Stromart verschieden (Beschluss: vergeben↔gedeckt, verfügbar↔offen) über `verfuegbarkeitPill(art, status)`.

**Tech Stack:** Next.js App Router (vor Next-spezifischem Code `apps/web/AGENTS.md` beachten), Drizzle, MapLibre, Vitest.

**Spec:** `docs/ap1j-handoff-verfuegbarkeit-vergabe.md` — Abschnitte „Abgeleiteter Verfügbarkeitsstatus" (inkl. Label-Sätze und Nebentag-Regel), „auswertung.: Zeitbezug und Filter" (Absatz ströme./karte. mit den PR-③-Festlegungen vom 22.09.2026).

## Global Constraints

- Status **nie gespeichert, immer abgeleitet**; Stichtag ist Parameter (`stichtag`), berechnet EINMAL je Request serverseitig.
- Status-Filter (Verfügbarkeit) startet **ohne Vorauswahl**; wirkt in ströme./karte. **auf heute**.
- **Exklusiv filtern** (Sicht „alle"): aktiver `cluster`-Filter blendet Outputs vollständig aus, `gruppe`-Filter spiegelbildlich Feedstock.
- **Pool-Prinzip Karte**: Facetten-Optionen aus dem UNGEFILTERTEN Pool, beide Arten speisen die Listen; Legende zählt aus dem Pool.
- **Aggregierte Marker werden NICHT nach Status eingefärbt** — Status nur im Tooltip/Detail.
- Label-Sätze je `art` exakt nach Handoff-Tabelle; Enum-Werte (`vergeben_extern` …) bleiben identisch.
- Sprache/Namen wie gehabt (UI Deutsch, Enum snake_case ohne Umlaute); keine Migration in diesem PR.
- Tests: `pnpm --filter web exec vitest run <datei>` einzeln, `pnpm --filter web test` alle; Build `pnpm --filter web build`. Commits Deutsch, Präfix `AP1j ③:`.
- Branch: `ap1j-tags-filter` von aktuellem main.

---

### Task 1: `stichtag`-Rename + Label-Sätze je Stromart

**Files:**
- Modify: `apps/web/lib/verfuegbarkeit.ts`
- Test: `apps/web/lib/verfuegbarkeit.test.ts`
- Modify (nur Aufrufer-Rename, kein Verhalten): `apps/web/app/register/RegisterInhalt.tsx` (Kommentar), `apps/web/components/stroeme/FormularPanel.tsx` (unverändert lauffähig — Parameter ist positional)

**Interfaces:**
- Produces: `leiteVerfuegbarkeitAb(stichtag: string, strom, vergaben)` (nur Param-Rename); `verfuegbarkeitPill(art: StromArt, status: VerfuegbarkeitsStatus): { text: string; tone: string }`; `verfuegbarkeitLabel(art, status): string` (normale Orthographie für Filter-Optionen). `VERFUEGBARKEIT_PILL` wird durch die Funktion ERSETZT (Konsumenten in Task 4 umgestellt; bis dahin bleibt der Export bestehen und delegiert auf die Feedstock-Variante).

- [ ] **Step 1: Failing Tests anhängen** (an verfuegbarkeit.test.ts)

```ts
import { verfuegbarkeitLabel, verfuegbarkeitPill } from "./verfuegbarkeit";

describe("verfuegbarkeitPill — Label-Saetze je Stromart (Beschluss 22.09.2026)", () => {
  it("Feedstock-Labels", () => {
    expect(verfuegbarkeitPill("biomasse", "vergeben_extern").text).toBe("vergeben (extern).");
    expect(verfuegbarkeitPill("biomasse", "verfuegbar").text).toBe("verfügbar.");
  });
  it("Output-Labels: gedeckt/offen", () => {
    expect(verfuegbarkeitPill("output", "vergeben_extern").text).toBe("gedeckt (extern).");
    expect(verfuegbarkeitPill("output", "vergeben_bhyo").text).toBe("gedeckt (bhyo).");
    expect(verfuegbarkeitPill("output", "verfuegbar").text).toBe("offen.");
    expect(verfuegbarkeitPill("output", "reserviert_bhyo").text).toBe("reserviert (bhyo).");
  });
  it("Toene sind je Status identisch, unabhaengig von der Art", () => {
    expect(verfuegbarkeitPill("output", "verfuegbar").tone).toBe(
      verfuegbarkeitPill("biomasse", "verfuegbar").tone,
    );
  });
  it("Filter-Labels in normaler Orthographie", () => {
    expect(verfuegbarkeitLabel("biomasse", "vergeben_extern")).toBe("Vergeben (extern)");
    expect(verfuegbarkeitLabel("output", "verfuegbar")).toBe("Offen");
    expect(verfuegbarkeitLabel("biomasse", "noch_nicht_verfuegbar")).toBe("Noch nicht verfügbar");
  });
});
```

- [ ] **Step 2: Fehlschlag verifizieren** — `pnpm --filter web exec vitest run lib/verfuegbarkeit.test.ts` → FAIL (`verfuegbarkeitPill is not a function`).

- [ ] **Step 3: Implementieren** — in `verfuegbarkeit.ts`:

1. Param-Rename in `leiteVerfuegbarkeitAb`: `heute` → `stichtag` (Signatur, Rumpf, JSDoc: „ströme./karte. übergeben heute; auswertung. rechnet fensterbezogen über die Monatszerlegung, nicht über diese Funktion").
2. Label-Sätze:

```ts
const PILL_TEXT: Record<StromArt, Record<VerfuegbarkeitsStatus, string>> = {
  biomasse: {
    verfuegbar: "verfügbar.",
    vergeben_bhyo: "vergeben (bhyo).",
    vergeben_extern: "vergeben (extern).",
    reserviert_bhyo: "reserviert (bhyo).",
    noch_nicht_verfuegbar: "noch nicht verfügbar.",
    abgelaufen: "abgelaufen.",
  },
  output: {
    verfuegbar: "offen.",
    vergeben_bhyo: "gedeckt (bhyo).",
    vergeben_extern: "gedeckt (extern).",
    reserviert_bhyo: "reserviert (bhyo).",
    noch_nicht_verfuegbar: "noch nicht verfügbar.",
    abgelaufen: "abgelaufen.",
  },
};

const PILL_TONE: Record<VerfuegbarkeitsStatus, string> = {
  verfuegbar: "active",
  vergeben_bhyo: "running",
  vergeben_extern: "inactive",
  reserviert_bhyo: "quiet",
  noch_nicht_verfuegbar: "quiet",
  abgelaufen: "inactive",
};

/** Pillen-Text je Stromart (Handoff-Tabelle „Label-Sätze je Stromart"). */
export function verfuegbarkeitPill(
  art: StromArt,
  status: VerfuegbarkeitsStatus,
): { text: string; tone: string } {
  return { text: PILL_TEXT[art][status], tone: PILL_TONE[status] };
}

/** Filter-Options-Label: Pill-Text ohne Schlusspunkt, Grossschreibung am Anfang. */
export function verfuegbarkeitLabel(
  art: StromArt,
  status: VerfuegbarkeitsStatus,
): string {
  const t = PILL_TEXT[art][status].slice(0, -1);
  return t.charAt(0).toUpperCase() + t.slice(1);
}
```

`StromArt` als **Typ-Import** aus `./stroeme-modell` (kein Laufzeit-Zyklus). Der bisherige Export `VERFUEGBARKEIT_PILL` bleibt vorerst und wird als `= Feedstock-Sicht` aus `PILL_TEXT.biomasse`/`PILL_TONE` zusammengesetzt (Task 4 stellt die Konsumenten um und entfernt ihn dann).

- [ ] **Step 4: Grün prüfen** — `pnpm --filter web exec vitest run lib/verfuegbarkeit.test.ts` → PASS.
- [ ] **Step 5: Commit** — `AP1j ③: stichtag-Rename und Label-Sätze je Stromart (verfuegbarkeitPill)`

---

### Task 2: Anreicherung + Facette „Verfügbarkeit" im Strom-Modell

**Files:**
- Modify: `apps/web/lib/verfuegbarkeit.ts` (Anreicherungs-Funktion)
- Modify: `apps/web/lib/stroeme-modell.ts` (Strom-Feld, Filter, FACETTEN, Optionen)
- Test: `apps/web/lib/verfuegbarkeit.test.ts`, `apps/web/lib/stroeme-modell.test.ts`

**Interfaces:**
- Produces:
  - `Strom.verfuegbarkeit?: VerfuegbarkeitsErgebnis` (optional — Fixtures/alte Aufrufer bleiben gültig)
  - `reichereVerfuegbarkeitAn(stroeme: Strom[], vergabenJeStrom: Map<string, VergabeDaten[]>, stichtag: string): Strom[]` in verfuegbarkeit.ts
  - `StroemeFilter.verfuegbarkeit: string[]` (+ LEERER_FILTER, filterAusSearchParams, GETEILTE_FILTER_PARAMS)
  - FACETTEN beider Arten: `{ key: "verfuegbarkeit", label: "Verfügbarkeit" }` direkt nach `status`
  - `facettenOptionen` liefert `verfuegbarkeit`-Optionen (feste 6er-Liste, Labels via `verfuegbarkeitLabel(art, …)`)

- [ ] **Step 1: Failing Tests**

An `verfuegbarkeit.test.ts`:

```ts
import { reichereVerfuegbarkeitAn } from "./verfuegbarkeit";
import type { Strom } from "./stroeme-modell";

describe("reichereVerfuegbarkeitAn", () => {
  const basis = {
    zeitraumVon: "2026-01-01",
    zeitraumBis: "2030-12-31",
    reserviertBhyo: false,
  } as Strom;
  it("setzt das Feld je Strom aus der Vergaben-Map", () => {
    const s1 = { ...basis, id: "a" } as Strom;
    const s2 = { ...basis, id: "b", reserviertBhyo: true } as Strom;
    const map = new Map([
      ["a", [v({ vergebenVon: "2026-01-01", vergebenBis: "2027-12-31" })]],
    ]);
    const [a, b] = reichereVerfuegbarkeitAn([s1, s2], map, "2026-09-22");
    expect(a!.verfuegbarkeit?.status).toBe("vergeben_extern");
    expect(b!.verfuegbarkeit?.status).toBe("reserviert_bhyo");
  });
  it("laesst Stroeme ohne Zeitraum unangereichert (kein Raten)", () => {
    const s = { ...basis, id: "c", zeitraumVon: null } as Strom;
    expect(reichereVerfuegbarkeitAn([s], new Map(), "2026-09-22")[0]!.verfuegbarkeit)
      .toBeUndefined();
  });
});
```

An `stroeme-modell.test.ts` (Fixture-Builder `strom()` existiert dort):

```ts
it("filtert nach verfuegbarkeit-Facette", () => {
  const frei = strom({ id: "f", verfuegbarkeit: { status: "verfuegbar", reserviertZusatz: false } });
  const weg = strom({ id: "w", verfuegbarkeit: { status: "vergeben_extern", reserviertZusatz: false } });
  const ohne = strom({ id: "o" });
  const erg = filterStroeme([frei, weg, ohne], {
    ...LEERER_FILTER,
    verfuegbarkeit: ["verfuegbar"],
  });
  expect(erg.map((s) => s.id)).toEqual(["f"]);
});

it("facettenOptionen enthaelt die Verfuegbarkeits-Liste mit Art-Labels", () => {
  const opt = facettenOptionen("output", [], [], {});
  expect(opt.verfuegbarkeit!.map((o) => o.wert)).toEqual([
    "verfuegbar", "vergeben_extern", "vergeben_bhyo",
    "reserviert_bhyo", "noch_nicht_verfuegbar", "abgelaufen",
  ]);
  expect(opt.verfuegbarkeit![0]!.label).toBe("Offen");
});
```

- [ ] **Step 2: Fehlschlag verifizieren** — beide Suites laufen lassen, FAIL erwartet.

- [ ] **Step 3: Implementieren**

`verfuegbarkeit.ts`:

```ts
/**
 * Reichert Stroeme um den abgeleiteten Status an (serverseitig, EIN stichtag
 * je Request). Stroeme ohne vollstaendigen Verfuegbarkeitszeitraum bleiben
 * unangereichert — kein stummes Raten.
 */
export function reichereVerfuegbarkeitAn<
  T extends {
    id: string;
    zeitraumVon: string | null;
    zeitraumBis: string | null;
    reserviertBhyo: boolean;
    verfuegbarkeit?: VerfuegbarkeitsErgebnis;
  },
>(stroeme: T[], vergabenJeStrom: Map<string, VergabeDaten[]>, stichtag: string): T[] {
  return stroeme.map((s) =>
    s.zeitraumVon && s.zeitraumBis
      ? {
          ...s,
          verfuegbarkeit: leiteVerfuegbarkeitAb(
            stichtag,
            {
              zeitraumVon: s.zeitraumVon,
              zeitraumBis: s.zeitraumBis,
              reserviertBhyo: s.reserviertBhyo,
            },
            vergabenJeStrom.get(s.id) ?? [],
          ),
        }
      : s,
  );
}
```

`stroeme-modell.ts`:
- `import type { VerfuegbarkeitsErgebnis } from "./verfuegbarkeit";` und `import { verfuegbarkeitLabel } from "./verfuegbarkeit";` — Achtung Zyklus: verfuegbarkeit.ts importiert zur Laufzeit aus formular-modell, das aus stroeme-modell NUR Typen zieht; der neue Laufzeit-Import `verfuegbarkeitLabel` aus stroeme-modell → verfuegbarkeit → formular-modell → stroeme-modell (nur Typ) ist zyklusfrei zur Laufzeit. Falls der Bundler meckert: `verfuegbarkeitLabel`/`verfuegbarkeitPill` samt `PILL_TEXT` in eine eigene Datei `apps/web/lib/verfuegbarkeit-labels.ts` auslagern (importiert nur Typen) und aus beiden nutzen.
- `Strom` += `verfuegbarkeit?: VerfuegbarkeitsErgebnis;` (unter `reserviertSeit`).
- `StroemeFilter` += `verfuegbarkeit: string[];`, `LEERER_FILTER` += `verfuegbarkeit: [],`.
- `FACETTEN`: in BEIDEN Arrays nach `{ key: "status" … }` einfügen: `{ key: "verfuegbarkeit", label: "Verfügbarkeit" },`.
- `facettenWert`: `case "verfuegbarkeit": return s.verfuegbarkeit ? [s.verfuegbarkeit.status] : [];`
- `facettenOptionen` (`gemeinsam`):

```ts
verfuegbarkeit: (
  [
    "verfuegbar", "vergeben_extern", "vergeben_bhyo",
    "reserviert_bhyo", "noch_nicht_verfuegbar", "abgelaufen",
  ] as const
).map((w) => ({ wert: w, label: verfuegbarkeitLabel(art, w) })),
```

- `filterAusSearchParams` += `verfuegbarkeit: liste(sp.verfuegbarkeit),`; `GETEILTE_FILTER_PARAMS` += `"verfuegbarkeit"`.

- [ ] **Step 4: Grün prüfen** — beide Suites + `pnpm --filter web build` (bestehende Fixtures bleiben gültig, Feld ist optional).
- [ ] **Step 5: Commit** — `AP1j ③: Strom.verfuegbarkeit — Anreicherung, Facette und Filter`

---

### Task 3: Sammel-Loader + ströme.-Verdrahtung

**Files:**
- Modify: `apps/web/lib/stroeme.ts` (`ladeAlleVergaben`)
- Modify: `apps/web/app/register/RegisterInhalt.tsx`

**Interfaces:**
- Produces: `ladeAlleVergaben(art: StromArt): Promise<Map<string, VergabeDaten[]>>` — Map Strom-ID → Vergaben, sortiert wie `ladeVergaben`.
- RegisterInhalt reichert den POOL vor dem Filtern an; das Detail nutzt `detailStrom.verfuegbarkeit` und `vergabenMap.get(id)` statt der bisherigen Einzelberechnung.

- [ ] **Step 1: `ladeAlleVergaben` in stroeme.ts** (neben `ladeVergaben`, nutzt dasselbe Select ohne id-Filter):

```ts
/** Alle Vergaben einer Art als Map Strom-ID -> Zeilen (fuer die Pool-Anreicherung). */
export function ladeAlleVergaben(
  art: StromArt,
): Promise<Map<string, VergabeDaten[]>> {
  return withDb(async (db) => {
    const elternSpalte =
      art === "biomasse"
        ? vergabeZeitraum.biomassestromId
        : vergabeZeitraum.outputBedarfId;
    const rows = await db
      .select({
        stromId: elternSpalte,
        vergebenVon: vergabeZeitraum.vergebenVon,
        vergebenBis: vergabeZeitraum.vergebenBis,
        vergebenAn: vergabeZeitraum.vergebenAn,
        anBhyo: vergabeZeitraum.anBhyo,
      })
      .from(vergabeZeitraum)
      .where(isNotNull(elternSpalte))
      .orderBy(
        sql`${vergabeZeitraum.vergebenVon} NULLS FIRST`,
        vergabeZeitraum.vergebenBis,
      );
    const map = new Map<string, VergabeDaten[]>();
    for (const { stromId, ...v } of rows) {
      const liste = map.get(stromId!) ?? [];
      liste.push(v);
      map.set(stromId!, liste);
    }
    return map;
  });
}
```

(`isNotNull` aus drizzle-orm importieren.)

- [ ] **Step 2: RegisterInhalt umstellen**

Nach dem Pool-Load (`ladeStroeme(art)`):

```ts
const vergabenMap = await ladeAlleVergaben(art);
const stichtag = new Date().toISOString().slice(0, 10);
const pool = reichereVerfuegbarkeitAn(poolRoh, vergabenMap, stichtag);
```

(Der bisherige `pool` heißt an der Ladezeile `poolRoh`; alles Nachgelagerte — filterStroeme, facettenOptionen, Grid/Tabelle/Detail — arbeitet auf dem angereicherten `pool`.) Den bisherigen Detail-Block (`ladeVergaben` + `leiteVerfuegbarkeitAb`) ERSETZEN durch:

```ts
const vergaben = detailStrom ? (vergabenMap.get(detailStrom.id) ?? []) : [];
const verfuegbarkeit = detailStrom?.verfuegbarkeit ?? null;
```

Achtung Nachlade-Pfad: `detailStrom` kann per `ladeStroeme(art, detailId)` außerhalb des Pools kommen — diesen Einzelfall ebenfalls anreichern: `detailStrom = reichereVerfuegbarkeitAn([detailStrom], vergabenMap, stichtag)[0]!` (die Map enthält alle Vergaben der Art, auch für Nachgeladene). Imports aufräumen (`ladeVergaben`, `leiteVerfuegbarkeitAb` entfallen hier).

- [ ] **Step 3: Verifizieren** — `pnpm --filter web test && pnpm --filter web build` → grün.
- [ ] **Step 4: Commit** — `AP1j ③: Pool-Anreicherung in ströme. — ladeAlleVergaben, Facette wirkt`

---

### Task 4: Sichtbarkeit in Grid, Tabelle, Pillen

**Files:**
- Modify: `apps/web/components/stroeme/Pillen.tsx` (art-Parameter)
- Modify: `apps/web/components/stroeme/Detail.tsx`, `apps/web/components/stroeme/FormularPanel.tsx` (Aufrufer)
- Modify: `apps/web/components/stroeme/Grid.tsx`, `apps/web/components/stroeme/Tabelle.tsx`
- Modify: `apps/web/app/globals.css` (Grid-Fußzeile)
- Modify: `apps/web/lib/verfuegbarkeit.ts` (Export `VERFUEGBARKEIT_PILL` entfernen)

**Interfaces:**
- `VerfuegbarkeitsPill({ art, ergebnis })` — neue Pflicht-Prop `art: StromArt`.

- [ ] **Step 1: Pillen.tsx**

```tsx
import { verfuegbarkeitPill, type VerfuegbarkeitsErgebnis } from "@/lib/verfuegbarkeit";
import type { StromArt } from "@/lib/stroeme-modell";

/** Verfuegbarkeits-Pille (AP1j): Label-Satz je Stromart + Zusatz-Reservierung. */
export function VerfuegbarkeitsPill({
  art,
  ergebnis,
}: {
  art: StromArt;
  ergebnis: VerfuegbarkeitsErgebnis;
}) {
  const p = verfuegbarkeitPill(art, ergebnis.status);
  return (
    <>
      <span className={`spill spill--${p.tone}`}>{p.text}</span>
      {ergebnis.reserviertZusatz && (
        <span className="pill">reserviert (bhyo).</span>
      )}
    </>
  );
}
```

- [ ] **Step 2: Aufrufer nachziehen**
  - `Detail.tsx`: `<VerfuegbarkeitsPill art={s.art} ergebnis={verfuegbarkeit} />`.
  - `FormularPanel.tsx` (Live-Pille in der qual-Box der Sektion vergabe.): `VERFUEGBARKEIT_PILL[…]`-Zugriffe durch `verfuegbarkeitPill(art, verfuegbarkeit.status)` ersetzen (zwei Stellen: text und tone).
  - Danach in `verfuegbarkeit.ts` den Export `VERFUEGBARKEIT_PILL` löschen; `pnpm --filter web build` findet vergessene Konsumenten.

- [ ] **Step 3: Grid.tsx** — letzte Zeile (Beschluss: Pille VOR dem Datum):

```tsx
<span className="st-card-verf">
  {s.verfuegbarkeit && (
    <VerfuegbarkeitsPill art={s.art} ergebnis={s.verfuegbarkeit} />
  )}
  <span>Verfügbar {fmtZeitraum(s.zeitraumVon, s.zeitraumBis)}</span>
</span>
```

CSS (globals.css, bei den st-card-Regeln — bestehende `.st-card-verf`-Regel erweitern, Werte der Umgebung übernehmen):

```css
.st-card-verf {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 4: Tabelle.tsx** — neue Spalte nach `status` in `spalten()`:

```tsx
{
  key: "verfuegbarkeit",
  label: "verfügbarkeit.",
  render: (s) =>
    s.verfuegbarkeit ? (
      <VerfuegbarkeitsPill art={s.art} ergebnis={s.verfuegbarkeit} />
    ) : (
      "–"
    ),
},
```

(Kein `sortKey` — Sortierung nach Status ist nicht beschlossen, YAGNI.) Import ergänzen.

- [ ] **Step 5: Verifizieren** — `pnpm --filter web test && pnpm --filter web build` grün.
- [ ] **Step 6: Commit** — `AP1j ③: Tag in Grid (vor dem Verfügbar-Datum) und Tabelle; Pille art-abhängig`

---

### Task 5: karte. — Anreicherung, exklusives Filtern, Pool-Optionen, Sidebar

**Files:**
- Modify: `apps/web/app/karte/page.tsx`
- Modify: `apps/web/lib/karte-modell.ts` (`KartePunkt.statusText`, `stromZuPunkt`)
- Modify: `apps/web/components/karte/KarteMap.tsx` (Tooltips)
- Modify: `apps/web/components/karte/KarteAnsicht.tsx` (Detail-Props)
- Test: `apps/web/lib/karte-modell.test.ts`

**Interfaces:**
- `KartePunkt` += `statusText: string` (leer, wenn kein Status ableitbar).
- `page.tsx` produziert zusätzlich: `poolPunkte: KartePunkt[]` (ungefiltert, beide Arten je Sicht), `gesamtStroeme: number`, `detailVerfuegbarkeit`/`detailVergaben` für die Sidebar.

- [ ] **Step 1: Failing Test** (karte-modell.test.ts, Fixture-Builder existiert):

```ts
it("stromZuPunkt nimmt den Status-Text mit (Label je Art)", () => {
  const p = stromZuPunkt(
    strom({
      lng: 9, lat: 48, art: "output",
      verfuegbarkeit: { status: "vergeben_extern", reserviertZusatz: false },
    }),
  );
  expect(p!.statusText).toBe("gedeckt (extern).");
});
it("stromZuPunkt ohne Status: leerer Text", () => {
  expect(stromZuPunkt(strom({ lng: 9, lat: 48 }))!.statusText).toBe("");
});
```

- [ ] **Step 2: FAIL verifizieren**, dann `karte-modell.ts`:

```ts
// im KartePunkt-Interface:
/** Abgeleiteter Verfuegbarkeitsstatus als Pill-Text; "" ohne Ableitung. */
statusText: string;

// in stromZuPunkt (Import verfuegbarkeitPill):
statusText: s.verfuegbarkeit
  ? verfuegbarkeitPill(s.art, s.verfuegbarkeit.status).text
  : "",
```

- [ ] **Step 3: KarteMap-Tooltips** — Status in die title-Attribute (Beschluss: „Status je Strom im Popover"; Marker werden NICHT eingefärbt):
  - Single: `el.title = [p.titel, p.untertitel, p.statusText].filter(Boolean).join(" · ");`
  - Fächer-Part: `part.title = [p.titel, p.untertitel, p.statusText].filter(Boolean).join(" · ");`

- [ ] **Step 4: page.tsx umbauen** (die Kern-Passage ersetzt Laden+Filtern+Optionen):

```ts
const [bioRoh, outRoh, regionen, umrisse, ui, vergabenBio, vergabenOut] =
  await Promise.all([
    sicht !== "outputs" ? ladeStroeme("biomasse") : Promise.resolve([] as Strom[]),
    sicht !== "feedstock" ? ladeStroeme("output") : Promise.resolve([] as Strom[]),
    ladeRegionOptionen(),
    listRegionGebiete(),
    cookies().then((c) => parseUiState(c.get(UI_COOKIE)?.value)),
    sicht !== "outputs" ? ladeAlleVergaben("biomasse") : Promise.resolve(new Map()),
    sicht !== "feedstock" ? ladeAlleVergaben("output") : Promise.resolve(new Map()),
  ]);

const stichtag = new Date().toISOString().slice(0, 10);
const bio = reichereVerfuegbarkeitAn(bioRoh, vergabenBio, stichtag);
const out = reichereVerfuegbarkeitAn(outRoh, vergabenOut, stichtag);

// Exklusiv filtern (Beschluss 22.09.2026): cluster blendet Outputs aus,
// gruppe blendet Feedstock aus — sonst bleibt die fremde Art ungefiltert
// stehen (CO2-Orb trotz Cluster-Filter).
const bioGefiltert = filter.gruppe.length ? [] : filterStroeme(bio, filter);
const outGefiltert = filter.cluster.length ? [] : filterStroeme(out, filter);
```

Optionen aus dem POOL statt aus dem Filtrat, gemischt in Sicht „alle":

```ts
const bioOpt = facettenOptionen("biomasse", bio, regionen, CLUSTER_LABEL);
const outOpt = facettenOptionen("output", out, regionen, CLUSTER_LABEL);
// Union nach wert; bei Label-Konflikt gewinnt Feedstock (dokumentiert im Handoff).
const misch = (a: FacettenOption[] = [], b: FacettenOption[] = []) => {
  const map = new Map(b.map((o) => [o.wert, o]));
  for (const o of a) map.set(o.wert, o);
  return [...map.values()].sort((x, y) => x.label.localeCompare(y.label, "de"));
};
const basisOpt =
  sicht === "outputs"
    ? outOpt
    : sicht === "feedstock"
      ? bioOpt
      : {
          region: misch(bioOpt.region, outOpt.region),
          qualitaet: misch(bioOpt.qualitaet, outOpt.qualitaet),
          status: misch(bioOpt.status, outOpt.status),
          verfuegbarkeit: misch(bioOpt.verfuegbarkeit, outOpt.verfuegbarkeit),
          belegtyp: misch(bioOpt.belegtyp, outOpt.belegtyp),
        };
```

Facetten-Liste: nach dem Status-Eintrag `{ key: "verfuegbarkeit", label: "Verfügbarkeit", optionen: basisOpt.verfuegbarkeit ?? [] }` einfügen. Zusätzlich produzieren:

```ts
const poolPunkte = [...bio, ...out].map(stromZuPunkt).filter((p) => p != null);
const gesamtStroeme = bio.length + out.length;
```

(`gesamt` = `poolPunkte.length` ersetzt die bisherige Doppel-Berechnung.) Detail-Nachlade-Pfad ebenfalls anreichern (wie Task 3, mit der Map der jeweiligen Art) und an `KarteAnsicht` durchreichen: `detailVerfuegbarkeit={detailStrom?.verfuegbarkeit ?? null}` und `detailVergaben` aus der Map.

- [ ] **Step 5: KarteAnsicht** — Props `detailVerfuegbarkeit`/`detailVergaben` annehmen und an `<Detail … verfuegbarkeit={detailVerfuegbarkeit} vergaben={detailVergaben} />` weitergeben; Props zusätzlich: `poolPunkte: KartePunkt[]`, `gesamtStroeme: number` (für Task 6 an die Legende gereicht).
- [ ] **Step 6: Verifizieren** — `pnpm --filter web test && pnpm --filter web build` grün.
- [ ] **Step 7: Commit** — `AP1j ③: karte. — exklusives Filtern, Pool-Optionen beider Arten, Status in Tooltip und Sidebar`

---

### Task 6: Legende (Pool-Zählung, ehrlicher Kopf) + Regionsdarstellung

**Files:**
- Modify: `apps/web/components/karte/KarteLegende.tsx`
- Modify: `apps/web/components/karte/KarteMap.tsx` (Region-Paint)
- Modify: `apps/web/app/globals.css` (z-Index Marker/Label)

- [ ] **Step 1: Legende** — neue Props `poolPunkte: KartePunkt[]`, `gesamtStroeme: number` (KarteAnsicht reicht durch; `gesamt`-Prop entfällt). Änderungen:
  - `zaehle` zählt aus `poolPunkte` (Pool-Prinzip: Zeilen nullen nicht beim Filtern; die aktive Auswahl trägt weiter `.aktiv`).
  - Kopf:

```tsx
<span className="km-legende-zahl">
  {punkte.length} von {gesamtStroeme} Strömen
  {gesamtStroeme - poolPunkte.length > 0
    ? ` · ${gesamtStroeme - poolPunkte.length} ohne Pin`
    : ""}
</span>
```

- [ ] **Step 2: Region deutlicher** (KarteMap, Paint der beiden Layer):

```ts
paint: { "fill-color": LIME, "fill-opacity": 0.09 },
// …
paint: { "line-color": LIME, "line-width": 2, "line-opacity": 0.9 },
```

- [ ] **Step 3: Regions-Label hinter die Orbs** (globals.css, bei den km-Regeln — MapLibre-Marker stapeln nach DOM-Reihenfolge, die Labels kommen zuletzt und verdecken sonst die Orbs):

```css
/* AP1j PR 3: Regions-Label hinter die Strom-Marker (Karten-Review). */
.maplibregl-marker:has(.km-region-label),
.km-region-label {
  z-index: 1;
}
.maplibregl-marker:has(.km-marker) {
  z-index: 2;
}
```

(Falls `:has` im Ziel-Chrome-Stand nicht greift — prüfen im Browser —, alternativ die z-Indizes in KarteMap direkt auf `marker.getElement().parentElement` bzw. beim Erzeugen via `el.style.zIndex` setzen; MapLibre akzeptiert auch `new ml.Marker({ element, … })` mit gestyltem Wurzelelement.)

- [ ] **Step 4: Verifizieren** — Build grün; Rest im Browser-Durchstich (Task 7).
- [ ] **Step 5: Commit** — `AP1j ③: Legende zählt aus dem Pool (x von y Strömen · n ohne Pin); Region deutlicher, Label hinter Orbs`

---

### Task 7: Doku, Gesamtlauf, Preview-Durchstich, PR

**Files:**
- Modify: `docs/design-system.md` (Output-Label-Satz in der Verfügbarkeits-Tabelle)

- [ ] **Step 1: design-system.md** — die Tabelle „Verfügbarkeits-Pillen (AP1j)" um die Output-Spalte ergänzen (gedeckt (extern)./gedeckt (bhyo)./offen. — Töne unverändert) mit Verweis auf die Handoff-Tabelle.
- [ ] **Step 2: Gesamtlauf** — `pnpm --filter web test && pnpm --filter web build` → grün.
- [ ] **Step 3: Push + PR + Preview-Durchstich im Browser** (eigener Tab; Achtung: im Hintergrund-Tab rendert MapLibre nicht — für Karten-Screenshots Tab in den Vordergrund holen oder den Nutzer schauen lassen):
  1. ströme. Grid: Pille vor dem Verfügbar-Datum; Sägewerk zeigt „noch nicht verfügbar." + Nebentag.
  2. Facette „Verfügbarkeit" filtert (z. B. nur „Reserviert (bhyo)").
  3. karte.: Cluster-Filter → KEINE Output-Marker mehr (CO₂ verschwindet); Optionslisten bleiben voll; Legende zählt weiter Pool-Werte; Kopf „x von 16 Strömen · 2 ohne Pin".
  4. Karten-Sidebar: Pille + vergabe. inkl. „vergeben an"; Output-Detail zeigt „gedeckt/offen"-Labels.
- [ ] **Step 4: Commit + PR** — Titel `AP1j PR3: ströme./karte. — Verfügbarkeits-Tag, Filter, exklusives Filtern, Karten-Fixes`; Body: Beschluss-Referenzen (Handoff 22.09.), Verifikation, Hinweis geteilte Preview.

---

## Self-Review (durchgeführt)

- **Spec-Abdeckung:** stichtag-Rename ✓ T1 · Label-Sätze ✓ T1/T4 · Tag in Grid (Position: vor Datum) ✓ T4 · Tabelle ✓ T4 · Karten-Sidebar inkl. „vergeben an" ✓ T5 · Status im Tooltip statt Marker-Färbung ✓ T5 · Filter ohne Vorauswahl ✓ (Facette startet leer, kein Default gesetzt) · heute-bezogen ✓ (stichtag = Serverdatum) · exklusiv filtern ✓ T5 · Pool-Optionen + beide Arten ✓ T5 · Legende Pool-Zählung + „x von y · n ohne Pin" ✓ T6 · Region deutlicher + Label hinter Orbs ✓ T6 · Nebentag-Regel wirkt überall via VerfuegbarkeitsPill ✓. NICHT in ③ (bewusst): auswertung. (④), Verifikations-Kopplung (⑤), Beleg-ID (eigener PR), CSV-Export (④).
- **Platzhalter:** keine.
- **Typkonsistenz:** `verfuegbarkeitPill(art, status)` einheitlich in T1/T4/T5; `Strom.verfuegbarkeit?: VerfuegbarkeitsErgebnis` in T2 definiert, T3–T5 konsumieren; `KartePunkt.statusText` T5; Props `poolPunkte`/`gesamtStroeme` T5→T6.
