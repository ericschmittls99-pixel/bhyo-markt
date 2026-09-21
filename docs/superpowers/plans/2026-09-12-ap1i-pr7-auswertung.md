# AP1i PR 7 — auswertung. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** V2-Bento-Dashboard `auswertung.` nach Mockup, mit geteiltem
Filter-Querystring (karte./stroeme.), klick-filternden Modulen und einem
DB-freien Kennzahlen-Modul — als Ersatz für die V1-Seite samt ihrer
`sql<number>`-Aggregationen.

**Architecture:** Datenpfad wie karte. (PR 6): `ladeStroeme` (getestete
PR-3-Mapper) + `filterAusSearchParams`/`filterStroeme`; sämtliche Kennzahlen
entstehen pur in `lib/auswertung-modell.ts` aus `Strom[]` (Vitest, kein
DB-Zugriff). `lib/auswertung.ts` mit seinen 14 `sql<number>`-Annotationen wird
gelöscht. Diagramme sind reines HTML/CSS/SVG — keine Diagrammbibliothek.

**Tech Stack:** Next.js App Router, React Server + Client Components,
Vitest, CSS in `globals.css` (Präfix `aw-`), MapLibre unberührt.

**Spec:** Erics PR-7-Arbeitsauftrag (Chat, 2026-09-12) + Mockup
`bhyogenics Tool.dc.html` (auswertung.-Screen Z. 430–660, `dashVals()`
Z. 1346–1420) + `docs/design/v2/ref/auswertung_standard_{light,dark}.webp`.

## Global Constraints

- **Schritt 0 zuerst:** sql<T>-Inventur vollständig, vor jedem Feature-Code,
  Inventur in den PR-Text — auch unbedenkliche Zeilen.
- Keine neuen Laufzeit-Abhängigkeiten (insbesondere keine Diagrammbibliothek).
- Diagramme flach; Verläufe nur als Identität via Orbs ≥ 20 px
  (Cluster-Zeilen: 32-px-Orb-Asset, Balken in flacher Clusterfarbe).
- Qualität A–D in Graustufen/Navy-Rampe (`--bhyo-navy-900/700/300/100`-Logik),
  keine Ampelfarben.
- Ziffern tabellarisch (`font-variant-numeric: tabular-nums`), Formate de-DE
  über `lib/format.ts`.
- Light + Dark Pflicht; keine Migration; UI-Texte Kleinschreibung + Schlusspunkt.
- E9: CSV-Export bleibt (Sekundär-Button in der Toolbar). „Menge nach
  Materialart", „Abdeckung nach Landkreis", „Zuletzt aktualisiert" entfallen
  ersatzlos — nicht wiederbeleben.
- Geteilte Filter: dieselben Querystring-Parameter wie karte.
  (`GETEILTE_FILTER_PARAMS`, mehrwertig kommagetrennt); Sidebar-Links tragen
  sie bereits (PR 6). Klick-Filter der Module schreiben in den Querystring.
- Mockup-Lücken nicht raten — in den PR-Text.
- Vitest: relative Imports in lib-Modulen (kein `@/`-Alias in Tests).
- Commits mit Co-Authored-By: Claude Fable 5 + Claude-Session-Trailer.

---

## Schritt 0 — sql<T>-Inventur (Stand main nach PR 6, `grep -rn 'sql<' apps packages`)

Laufzeitkontext: Production läuft auf Cloudflare Workers mit postgres.js
über Hyperdrive; lokal/CI kann ein anderer Treiber antworten. Die PR-3-Lehre:
eine `sql<T>`-Annotation ist eine unbelegte Behauptung, keine Konvertierung.
Treiber liefern je nach OID unterschiedlich (int8/numeric → string bei
node-postgres; json_agg/Geometrie → Text bei postgres.js im Worker).

| Datei:Zeile | Ausdruck | behaupteter Typ | tatsächlicher Laufzeittyp | Schadenspotenzial |
|---|---|---|---|---|
| `lib/auswertung.ts:73` | `count(*)::int` | `number` | int4 → number (beide Treiber) | gering — aber Teil der V1-Aggregation, **entfällt in diesem PR** |
| `lib/auswertung.ts:74` | `coalesce(sum(menge_atro),0)::float8` | `number` | float8 → number; ohne `::float8` wäre es numeric → **string** | **hoch**: Summen sind Basis des AP3-Eignungsscores; falsche Typen ergäben `"123""456"`-Konkatenation statt Addition — plausibel aussehende falsche Summen. Entfällt in diesem PR (pure Berechnung aus `Strom[]`) |
| `lib/auswertung.ts:75` | `count(*) filter (…qualitaet in ('A','B'))::int` | `number` | int4 → number | gering; entfällt |
| `lib/auswertung.ts:76` | `count(*) filter (…qualitaet is not null)::int` | `number` | int4 → number | gering; entfällt |
| `lib/auswertung.ts:77` | `count(distinct landkreis)::int` | `number` | int4 → number | gering; entfällt |
| `lib/auswertung.ts:93` | `coalesce(sum(menge_atro),0)::float8` | `number` | float8 → number | wie Z. 74: **hoch** ohne Cast; entfällt |
| `lib/auswertung.ts:94` | `coalesce(sum(menge_roh_fm),0)::float8` | `number` | float8 → number | wie Z. 74; entfällt |
| `lib/auswertung.ts:112` | `coalesce(sum(menge_atro),0)::float8` | `number` | float8 → number | wie Z. 74; entfällt |
| `lib/auswertung.ts:128–129` | `count(*)::int` / `sum(...)::float8` | `number` | s. o. | s. o.; entfällt |
| `lib/auswertung.ts:151–153` | `count(*)::int`, `sum(...)::float8`, `round(avg(...),1)::float8` (`sql<number\|null>`) | `number`/`number\|null` | float8 → number, avg über leerer Menge → null | mittel (Ø-Qualität als Zahl 1–4); entfällt |
| `lib/auswertung.ts:172–173` | `extract(year from zeitraum_von)::int` / `count(*)::int` | `number` | `extract` liefert numeric → **erst der `::int`-Cast macht daraus int4/number** | mittel; entfällt |
| `lib/auswertung.ts:181–182` | `extract(year from erstellt_am)::int` / `count(*)::int` | `number` | wie Z. 172 | mittel; entfällt |
| `lib/bewertung.ts:41` | `sum(menge_atro)::float8` | `number` | float8 → number; **ohne** coalesce: leere Gruppe → null trotz Typ `number` | **mittel** (Anzeige Fokusregion-Kacheln). Bleibt bis PR 8 (bewertung.-Umbau), dort PR-3-Weg. Im PR-Text als bekannter Restposten |
| `lib/bewertung.ts:90–93` | Subselects `lauf_id`, `status` aus `analyse_lauf` | `string \| null` | text/uuid → string, keine Zeile → null | unbedenklich (Text bleibt Text). Bleibt bis PR 8 |
| `lib/register.ts:241` | `beleg.metadata ->> 'quellenangabe'` | `string \| null` | `->>` liefert text → string | unbedenklich |
| `lib/register.ts:315` | wie Z. 241 | `string \| null` | text → string | unbedenklich |
| `lib/register.ts:618` | `ST_AsGeoJSON(gebiet)` | **`unknown`** | Text (JSON-String) | keins — PR-6-Muster: `geojsonOderNull` konvertiert an einer Stelle, getestet in beiden Treiber-Formen |
| `lib/stroeme.ts:67–70` | `json_agg(...)`, `ST_X/ST_Y` | **`unknown`** | json → Objekt ODER Text, float8 → number ODER Text (treiberabhängig) | keins — PR-3-Muster: `stringListe`/`zahlOderNull` in `stroeme-zeilen.ts`, Tests beider Treiber-Formen, unerwartete Formate → `console.error` |
| `lib/stroeme.ts:111–114` | wie Z. 67–70 (Output-Query) | **`unknown`** | s. o. | keins — gleicher konvertierter Pfad |
| `packages/rechenkern` | — | — | — | keine sql<>-Annotationen (DB-freies Package) |

**Konsequenz für diesen PR:** Alles, was auswertung. berührt
(`lib/auswertung.ts` komplett), geht den PR-3-Weg — die Aggregation wandert
als pure Funktionen über `Strom[]` in `lib/auswertung-modell.ts`; die
Umwandlung Treiber→TypeScript passiert weiterhin an genau einer Stelle
(`stroeme-zeilen.ts`, bereits getestet in beiden Treiber-Formen). Es gibt
keine neue SQL-Aggregation und keine neue `sql<T>`-Annotation.

---

## Datei-Struktur

- **Neu** `apps/web/lib/auswertung-modell.ts` — pure Kennzahlen aus `Strom[]` (kein DB/Netz/Date.now)
- **Neu** `apps/web/lib/auswertung-modell.test.ts` — Vitest, relative Imports
- **Neu** `apps/web/components/auswertung/AuswertungAnsicht.tsx` — Client-Wrapper: Toolbar + Bento-Grid + klick-filternde Module + Detail-Overlay
- **Neu** `apps/web/components/auswertung/AuswertungToolbar.tsx` — sicht-Umschalter, FacettenChips (geteilt), Reset, CSV-Button
- **Ersetzt** `apps/web/app/auswertung/page.tsx` — Server-Seite auf ladeStroeme + filterAusSearchParams
- **Ersetzt** `apps/web/app/api/auswertung/export/route.ts` — CSV auf geteiltem Parametersschema
- **Gelöscht** `apps/web/lib/auswertung.ts`, `apps/web/components/FilterBar.tsx`, `apps/web/components/DetailPanel.tsx` (einzige Nutzer: V1-auswertung; bewertung. nutzt nur ClusterStack/Karte/lib/bewertung — bleiben bis PR 8)
- **Erweitert** `apps/web/app/globals.css` — `aw-`-Klassen (Bento-Grid, Balken, Donut, Saisonbalken)

### Modul-Umfang (Mockup + E9-Delta, verbindlich)

4-spaltiges Bento-Grid (unter 1000 px 2 Spalten, unter 620 px 1 Spalte;
Zeilenhöhe ~168 px, doppelt hohe Karten span 2):

1. **4 KPI-Karten** (je 1×1): in der auswahl. / trockenmasse. (bzw.
   energiebedarf. bei sicht=outputs) / belege geprüft. / ø erfassungsgrad.
2. **biomasse je cluster.** (2×2; bei sicht=outputs: belege je output-gruppe.)
   — je Zeile 32-px-Verlaufs-Orb (`orbSrc`), Name, flacher Balken in
   Clusterfarbe, Wert. Klick filtert `gruppe`.
3. **qualität der belege.** (1×2) — SVG-Donut Navy-Rampe, Mitte „A + B %",
   Zeilen mit Qualitäts-Pille. Klick filtert `qualitaet`.
4. **status.** (1×2) — StatusPille + Anzahl + %-Balken (`--data-ink`-flach).
   Klick filtert `status`.
5. **saisonalität.** (2×2) — Monatsbalken Angebot (gewichtet nach t atro/a)
   und Bedarf (gleichgewichtet), Peak-Monat hervorgehoben, Fußnote.
   Nicht klick-filternd (kein Monatsfilter im Schema — Mockup ebenso).
6. **belegtypen.** (2×1) — zweispaltige Zeilen mit Mini-Balken. Klick
   filtert `belegtyp`.
7. **verfügbare biomasse je jahr.** (2×1) — 6 Balken 2026–2031, aktuelles
   Jahr in `--status-active`. Nicht klick-filternd (wie Mockup).
8. **preiskorridor · feedstock.** (2×1; bei outputs: preise · outputs.) —
   MetricStat + min/max-Skala mit Positionspunkt.
9. **nächste verifizierung.** (2×1) — 3 fälligste Belege
   (`naechsteVerifizierung` aus PR 5), 16-px-Orb, „fällig."-Pille bei
   Überfälligkeit; Klick öffnet das Detail-Panel (wie karte.: `detail=`
   im Querystring, Detail-Komponente im Lesemodus mit `stroemeHref`).
10. **EmptyState** „keine belege." bei leerer Auswahl; Toolbar mit
    CSV-Sekundär-Button (E9).

Entfallen ersatzlos (E9): Menge nach Materialart, Abdeckung nach Landkreis,
Zuletzt aktualisiert.

---

### Task 0: Branch + Inventur committen

**Files:**
- Create: `docs/superpowers/plans/2026-09-12-ap1i-pr7-auswertung.md` (dieses Dokument inkl. Schritt-0-Inventur)

- [ ] **Step 1:** `git checkout main && git pull && git checkout -b ap1i-auswertung`
- [ ] **Step 2:** Inventur verifizieren: `grep -rn 'sql<' apps/web/lib apps/web/app packages | grep -v node_modules` — jede Fundstelle muss in der Tabelle oben stehen; fehlt eine, Tabelle ergänzen.
- [ ] **Step 3:** Plan committen: `git add docs/superpowers/plans/2026-09-12-ap1i-pr7-auswertung.md && git commit -m "AP1i PR7: Plan auswertung. inkl. sql<T>-Inventur (Schritt 0)"`

### Task 1: `lib/auswertung-modell.ts` — pure Kennzahlen (TDD)

**Files:**
- Create: `apps/web/lib/auswertung-modell.ts`
- Test: `apps/web/lib/auswertung-modell.test.ts`

**Interfaces (Produces):**

```ts
export type Sicht = "alle" | "feedstock" | "outputs";

export interface KpiKarte { wert: string; einheit: string; label: string; caption: string }
export interface ClusterZeile {
  key: string; label: string; orb: string | null; farbe: string;
  pct: number; wertText: string; meta: string;
}
export interface QualitaetsDaten {
  segmente: { stufe: string; anteil: number }[];   // Reihenfolge A,B,C,D; anteil 0..1
  abProzent: number;                                // A+B in %
  zeilen: { stufe: string; label: string; anzahl: number }[];
}
export interface StatusZeile { key: string; label: string; anzahl: number; pct: number }
export interface SaisonDaten {
  feed: number[] | null; out: number[] | null;      // 12 Monatsindizes oder null (keine Ströme)
  feedPeak: number; outPeak: number; notiz: string;
}
export interface BelegtypZeile { key: string; label: string; anzahl: number; pct: number }
export interface JahresBalken { jahr: number; wertText: string; pct: number; aktuell: boolean }
export interface PreisDaten {
  stats: { wert: string; einheit: string; label: string }[];
  korridor: { minText: string; maxText: string; pos: number } | null;
}
export interface VerifZeile {
  id: string; art: StromArt; orb: string | null; titel: string; sub: string;
  datum: string; ueberfaellig: boolean;
}

export function kpiKarten(recs: Strom[], sicht: Sicht): KpiKarte[];
export function clusterZeilen(recs: Strom[], sicht: Sicht): ClusterZeile[];
export function qualitaetsDaten(recs: Strom[]): QualitaetsDaten;
export function statusZeilen(recs: Strom[]): StatusZeile[];
export function saisonDaten(recs: Strom[]): SaisonDaten;
export function belegtypZeilen(recs: Strom[]): BelegtypZeile[];
export function jahresBalken(recs: Strom[], sicht: Sicht, aktuellesJahr: number): JahresBalken[];
export function preisDaten(recs: Strom[], sicht: Sicht): PreisDaten;
export function verifZeilen(recs: Strom[], heuteIso: string): VerifZeile[];
```

Fachregeln (aus `dashVals()` im Mockup, 1:1 übernommen):
- `feed = recs.filter(r => r.art === "biomasse")`, `out = art === "output"`.
- Trockenmasse: Summe `mengeAtro ?? 0` (kommt fertig konvertiert aus dem
  PR-3-Pfad; KEINE eigene Umrechnung aus FM×TS×Asche — `mengeAtro` ist die
  in der DB generierte Spalte, eine Doppelrechnung könnte abweichen).
- KPI 2 bei sicht=outputs: Summe `mengeWert` je `mengeEinheit`, Hauptwert
  MWh/a, Caption übrige Einheiten; sonst Trockenmasse mit Caption
  „aus X t FM/a · Bedarf …".
- belege geprüft.: `% status === "geprueft"`, Caption „x von n · y in Prüfung".
- ø erfassungsgrad.: Mittel über `vollstaendigkeit`, Caption „n Belege unter
  50 %" bzw. „alle Belege über 50 %".
- Cluster-Balken: feedstock-Modus (sicht ≠ outputs) → Wert = t atro je
  `cluster`; outputs-Modus → Anzahl Belege je `gruppe` (Einheiten nicht
  summierbar), meta = Mengen je Einheit. pct relativ zum Zeilenmaximum.
  Farbe aus `CLUSTER_FARBE`/`OUTPUT_FARBE` (flach), Orb aus `orbSrc`.
- Qualität: Anteile in Reihenfolge A,B,C,D; Zeilen-Labels wie Mockup
  („Vertrag, Betriebsdaten · extern belegt" usw.). Ströme ohne Qualität
  zählen nicht in Segmente, wohl aber in die Gesamtzahl? — Nein: Mockup
  kennt keine leere Qualität; hier: nur Ströme mit Qualität bilden die
  Verteilung, `abProzent` bezogen auf Ströme mit Qualität. (Mockup-Lücke,
  in den PR-Text.)
- Status: feste Reihenfolge entwurf, in_pruefung, geprueft, verworfen;
  verworfen erscheint nur, wenn > 0 in der Auswahl (Auswahllisten-Regel).
- Saison: gewichteter Monatsindex `sum(w·saison[m])/sum(w)` mit w = mengeAtro
  (feed) bzw. 1 (out); `saisonalitaet == null` → flach 100. Notiz
  „Angebotsspitze im … · Bedarfsspitze im …".
- Jahre 2026–2031: Strom zählt für Jahr y, wenn `zeitraumVon`-Jahr ≤ y ≤
  `zeitraumBis`-Jahr (offene Enden: fehlendes von → zählt ab 2026, fehlendes
  bis → bis 2031). Wert wie Cluster-Modus (t atro bzw. Anzahl).
- Preis feedstock: Ø `preisMittel` gewichtet nach t atro (Ströme ohne
  preisMittel fallen aus Zähler UND Nenner), Korridor min(`preisMin`)–
  max(`preisMax`), Punktposition = (mean−min)/(max−min). Outputs: Ø `preis`
  je `preisEinheit`, max. 3 Einheiten, kein Korridor.
- Verifizierung: `naechsteVerifizierung(beleg)` aus `lib/verifizierung`,
  Ströme ohne Beleg/Datum fallen raus; sortiert aufsteigend, Top 3,
  `ueberfaellig = datum < heuteIso`.
- Alle Zahltexte über `fmtZahl`/`fmtPreis`/`fmtDatum` (de-DE, Rundung nur an
  der Ausgabegrenze).

- [ ] **Step 1:** Failing Tests schreiben (`auswertung-modell.test.ts`) — Fixture-Helfer wie in `stroeme-modell.test.ts` (`strom(patch)`), Fälle mindestens:

```ts
// kpiKarten: 2 feed (mengeAtro 100/50, status geprueft/entwurf, vollstaendigkeit 80/40) + 1 out (MWh/a 500)
// → KPI1 "3 Belege", caption "2 Feedstock · 1 Outputs"
// → KPI2 wert "150", einheit "t atro/a"
// → KPI3 wert "33" (1 von 3), caption "1 von 3 · 0 in Prüfung"
// → KPI4 wert "60", caption "1 Beleg unter 50 %"
// kpiKarten sicht=outputs: KPI2 wert "500", einheit "MWh/a"
// clusterZeilen: zwei Cluster 100/50 atro → pct 100/50, farbe flach, wertText "100"
// clusterZeilen outputs: zählt Belege je gruppe
// qualitaetsDaten: A,A,B,D → abProzent 75, segmente-Anteile [0.5,0.25,0,0.25]
// statusZeilen: verworfen fehlt bei 0, erscheint bei >0
// saisonDaten: feed gewichtet (100 atro saison[0]=110, 50 atro null→100) → Januar-Index 107 (gerundet)
// jahresBalken: von 2027, bis 2029 → zählt nur 2027–2029; aktuell=true für aktuellesJahr
// preisDaten: gewichteter Mittelwert, pos zwischen 0 und 100; outputs je Einheit
// verifZeilen: sortiert, Top 3, ueberfaellig bei Datum < heute
```

- [ ] **Step 2:** `pnpm --filter web vitest run lib/auswertung-modell.test.ts` → FAIL (Modul fehlt)
- [ ] **Step 3:** `lib/auswertung-modell.ts` implementieren (pur, keine DB/kein Date.now — `aktuellesJahr`/`heuteIso` sind Parameter)
- [ ] **Step 4:** Tests grün + Gesamtsuite: `pnpm --filter web vitest run` → PASS
- [ ] **Step 5:** Commit `AP1i PR7: auswertung-modell — Kennzahlen pur aus Strom[] (TDD)`

### Task 2: Toolbar + Bento-Komponenten + CSS

**Files:**
- Create: `apps/web/components/auswertung/AuswertungToolbar.tsx`
- Create: `apps/web/components/auswertung/AuswertungAnsicht.tsx`
- Modify: `apps/web/app/globals.css` (aw-Sektion)

**Interfaces (Consumes):** `FacettenChips` (PR 3/6), `useUrlZustand`,
`updateUiCookie` (filterOffen.auswertung neu im Cookie-Objekt — Schema in
`lib/ui-state.ts` prüfen und ggf. um `auswertung` erweitern), Typen aus
Task 1, `orbSrc`/Farben aus `lib/farben.ts`, `Detail` aus
`components/stroeme/Detail.tsx` (Lesemodus via `stroemeHref`).

**AuswertungToolbar** (Muster KarteToolbar, ohne Suche):
- SegmentedControl Alle/Feedstock/Outputs → `setze({ sicht: … })`
- FacettenChips mit denselben Facetten wie karte. + `bereichKeys = ["vonAb","erstellt"]`
- Reset-X bei aktivem Filter
- rechts Sekundär-Button „CSV-Export" (`<a className="btn btn--sm" href={/api/auswertung/export?…}>` mit aktuellem Querystring, nur GETEILTE_FILTER_PARAMS durchgereicht)

**AuswertungAnsicht** (Client): erhält vom Server `kpis`, `cluster`,
`qualitaet`, `status`, `saison`, `belegtypen`, `jahre`, `preis`, `verif`,
`facetten`, `auswahl`, `bereich`, `sicht`, `filter`-Auszug, `detailStrom`
+ Historie/Begründung (wie KarteAnsicht) und rendert Toolbar + Grid.
Klick-Filter-Logik (eine Funktion, überall gleich):

```ts
const { setze } = useUrlZustand();
function toggleFilter(key: string, wert: string, aktuelleAuswahl: string[]) {
  const neu = aktuelleAuswahl.includes(wert)
    ? aktuelleAuswahl.filter((v) => v !== wert)
    : [...aktuelleAuswahl, wert];
  setze({ [key]: neu });
}
// aria-pressed = ausgewählt; bei aktiver Facette bekommen nicht gewählte
// Zeilen opacity .45, gewählte Hintergrund var(--surface-selected) (Mockup rowSt)
```

Module als kleine Funktionskomponenten in AuswertungAnsicht-Datei (eine
Datei, da eng gekoppelt an toggleFilter): `KpiModul`, `ClusterModul`
(32-px-Orb `<img src={orb} className="aw-orb32">`), `QualitaetModul`
(SVG-Donut r=56, stroke-width 14, `stroke-dasharray = anteil*2πr`,
Rotation −90°, Farben Navy-Rampe A `#1f2e38` B `#3c4a52` C `#a3acb1`
D `#d9dde0`-Äquivalent über CSS-Variablen), `StatusModul`, `SaisonModul`
(12 Flex-Balken, Höhe ∝ Index, Peak `--lime`), `BelegtypModul`,
`JahresModul`, `PreisModul`, `VerifModul` (Zeilen-Klick:
`setze({ detail: id }, "push")`).

CSS (`aw-`): `.aw-grid` (grid-template-columns repeat(4,minmax(0,1fr)),
`grid-auto-rows:168px`, `grid-auto-flow:row dense`, gap 16px; Media-Queries
1000px→2, 620px→1 Spalte), `.aw-karte` (Glas-Karte wie km-/st-Karten),
`.aw-kicker`, `.aw-zeile` (klickbare Zeile mit hover), `.aw-balken`
(8px-Pillen-Track `--surface-sunken` + Füllung), `.aw-orb32`
(32px, border-radius 50%), Donut/Season/Jahres-Spezifika. Light+Dark über
bestehende Tokens (keine neuen Farbliterale außer Navy-Rampe-Variablen,
die es schon gibt).

- [ ] **Step 1:** `lib/ui-state.ts` ansehen; falls `filterOffen` kein `auswertung`-Feld hat, Typ + Default ergänzen (kein Migrations-Thema, nur Cookie)
- [ ] **Step 2:** AuswertungToolbar.tsx schreiben (Muster KarteToolbar ohne Suche + CSV-Link)
- [ ] **Step 3:** AuswertungAnsicht.tsx mit allen Modulen schreiben
- [ ] **Step 4:** aw-CSS in globals.css ergänzen
- [ ] **Step 5:** `pnpm --filter web exec tsc --noEmit` → grün
- [ ] **Step 6:** Commit `AP1i PR7: Bento-Module + Toolbar (Client) fuer auswertung.`

### Task 3: Server-Seite ersetzen, V1 löschen

**Files:**
- Rewrite: `apps/web/app/auswertung/page.tsx`
- Delete: `apps/web/lib/auswertung.ts`, `apps/web/components/FilterBar.tsx`, `apps/web/components/DetailPanel.tsx`

Seite = Muster `app/karte/page.tsx`: `filterAusSearchParams`, sicht-Parsing,
`ladeStroeme("biomasse"/"output")` je nach sicht, `filterStroeme`,
Facetten wie karte. (identischer Block), Kennzahlen via Task-1-Funktionen
mit `aktuellesJahr = Number(new Date().toISOString().slice(0,4))` und
`heuteIso = new Date().toISOString().slice(0,10)` (Zeit entsteht an der
Seitengrenze, nicht im Modul), Detail-Laden wie karte. (beide Arten
probieren, Historie + Begründung + Verifizierung), Übergabe an
AuswertungAnsicht.

- [ ] **Step 1:** page.tsx neu schreiben
- [ ] **Step 2:** V1-Dateien löschen; `grep -rn 'lib/auswertung"\|FilterBar\|DetailPanel' apps/web` → keine Treffer mehr (außer auswertung-modell)
- [ ] **Step 3:** `pnpm --filter web exec tsc --noEmit` + `pnpm --filter web vitest run` → grün
- [ ] **Step 4:** Commit `AP1i PR7: auswertung. auf PR-3-Datenpfad; V1-Seite, lib/auswertung + FilterBar/DetailPanel entfernt`

### Task 4: CSV-Route aufs geteilte Schema (E9)

**Files:**
- Rewrite: `apps/web/app/api/auswertung/export/route.ts`

Alte Route filtert einwertig (`region`, `materialart`, …) über
`listBiomasse` — inkompatibel mit dem mehrwertigen V2-Querystring. Neu:
`filterAusSearchParams(Object.fromEntries(p))` + `ladeStroeme` beider Arten
(sicht beachten) + `filterStroeme`; vereinheitlichte Spalten für beide
Arten: Art, Bezeichnung, Akteur, Ort, Landkreis, Cluster/Gruppe,
Materialart/Produkt, Zeitraum von, Zeitraum bis, Menge, Einheit
(biomasse: mengeAtro + "t atro/a"), Qualität, Status. BOM + CRLF + Semikolon
wie bisher; Auth-Check bleibt. (Spaltenerweiterung um Outputs = bewusste
Abweichung von V1, in den PR-Text.)

- [ ] **Step 1:** Route neu schreiben
- [ ] **Step 2:** `tsc --noEmit` grün; lokal kein DB-Test nötig (Preview-Prüfung in Task 5)
- [ ] **Step 3:** Commit `AP1i PR7: CSV-Export auf geteiltes Filterschema (beide Arten, E9)`

### Task 5: Build, PR, Preview-Prüfschleife, Gegenrechnung

- [ ] **Step 1:** `rm -rf apps/web/.next && pnpm --filter web build` → grün
- [ ] **Step 2:** Push + PR öffnen. PR-Text enthält: **sql<T>-Inventur (Tabelle aus Schritt 0 vollständig)**, Modul-Liste, E9-Entfall-Bestätigung, Mockup-Lücken/-Abweichungen (Qualitäts-Verteilung ohne leere Qualität; CSV-Spalten beider Arten; Detail-Panel statt Mockup-Modal — PR-6-Muster), bekannte Restposten (bewertung.ts bis PR 8)
- [ ] **Step 3:** Deploy-Wait als Background-Bash (until-Loop `gh run list`), `/api/health` grün
- [ ] **Step 4:** Browser-Prüfschleife (Chrome-Extension, Eric loggt via Access ein): alle Module sichtbar Light+Dark, Klick auf Cluster-Zeile setzt `gruppe=` im Querystring und dimmt übrige Zeilen, Klick auf Qualität/Status/Belegtyp analog, Reset leert, sicht-Umschalter, Link Sidebar → karte. trägt Querystring, verif-Zeile öffnet Detail, CSV-Button lädt Datei mit gefilterten Zeilen, EmptyState bei absurdem Filter
- [ ] **Step 5:** **Kennzahl-Gegenrechnung:** auf der Preview KPI „trockenmasse." (ohne Filter) notieren; direkt gegen Neon rechnen: `select sum(menge_atro) from biomassestrom where status != 'verworfen'` (bzw. exakt die Filterlogik der Seite — Statusregel vorher aus `ladeStroeme` ablesen); Summen müssen nach de-DE-Rundung identisch sein. Ergebnis (beide Zahlen) in den PR-Text
- [ ] **Step 6:** Light/Dark-Screenshots nach `docs/design/v2/pruef/`, committen, raw-Links in den PR-Text
- [ ] **Step 7:** Review-Runden mit Eric; Squash-Merge NUR nach expliziter Freigabe

## Self-Review

- Spec-Abdeckung: Schritt 0 (Task 0 + Tabelle), Bento-Module 1–10 (Task 1/2),
  geteilte Filter + klick-filternd (Task 2/3), E9 CSV + Entfall (Task 4),
  DoD Gegenrechnung/Screenshots/Querystring-Link (Task 5). ✓
- Keine Platzhalter; Typen zwischen Task 1 und 2 konsistent
  (`KpiKarte` etc. werden 1:1 als Props gereicht). ✓
- Mockup-Lücken benannt statt geraten (Qualität ohne Stufe, CSV-Spalten). ✓
