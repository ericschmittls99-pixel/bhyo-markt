# Seed-Datensatz Preview v2 (60 Feedstock, 50 Outputs) — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministischer, idempotenter Seed für die Preview-DB (60 Feedstock, 50 Outputs, 14 Ankerfälle) exakt nach Erics Auftrag vom 22.09.2026 — der Auftragstext ist die verbindliche Daten-Spec und liegt dem Executor im Chat/Commit vor.

**Architecture:** Zweiteilig: ein **purer Generator** (`seed-daten.ts`, PRNG-deterministisch, ohne DB — dadurch sind ALLE Spec-Invarianten als Vitest ohne Datenbank prüfbar) und ein **Writer** (`seed-preview.ts`: Guard → Marker-Delete → Insert → Selbstprüfung §4). Ausgeführt wird über einen dedizierten `workflow_dispatch`-Workflow mit dem bestehenden Repo-Secret `DATABASE_URL_PREVIEW` (dasselbe, das der Deploy für Preview-Migrationen nutzt; ein Production-DB-Secret existiert im Repo nicht — Prod-Migrationen sind manuell).

**Tech Stack:** tsx, drizzle/postgres-js via `@bhyo/db` (`createSql` aus `src/client.ts`, Export ergänzen), `@bhyo/db/schema`, `apps/web/lib/verfuegbarkeit` + `validiereVergaben` für Selbstprüfung/Invarianten.

**Spec:** Erics Auftragstext (Abschnitte 0–5) — jede Zahl daraus gilt wörtlich; dieser Plan regelt nur die technischen Entscheidungen.

## Global Constraints (technische Entscheidungen zur Spec)

- **Guard (Spec §0):** Das Skript liest die URL AUSSCHLIESSLICH aus `SEED_DATABASE_URL_PREVIEW` (bewusst nicht `DATABASE_URL`), bricht bei `/prod/i` im String ab, kennt KEIN Bypass-Flag. Zusätzliche Absicherung: Der Workflow verdrahtet hart `secrets.DATABASE_URL_PREVIEW`; ein Prod-Connection-Secret existiert im Repo nicht.
- **Marker:** `bezeichnung` jeder Seed-Zeile endet mit `" · SEED-v2"` (Anker davor als `"[ANKER-n] "`), Belege tragen `metadata.seed = "SEED-v2 (synthetisch)"`, Seed-Akteure den Namens-Präfix `"Seed: "`. Delete-Reihenfolge: `vergabe_zeitraum` (per Strom-ID-Subselect) → Ströme (`bezeichnung LIKE '% · SEED-v2'`) → Belege (`metadata->>'seed' = 'SEED-v2 (synthetisch)'`) → Akteure (`name LIKE 'Seed: %'`). Kein TRUNCATE; „Test:"-Bestand (inkl. Sägewerk-Fixture) bleibt unberührt.
- **Determinismus:** `SEED = 20260922` (mulberry32), `BASIS_JAHR = 2026` (Konstante), `STICHTAG = "2026-09-22"` (nur für die Status-AUSGABE der Selbstprüfung); IDs deterministisch als UUIDv4 aus PRNG-Bytes — zwei Läufe erzeugen bytegleiche Daten inkl. IDs.
- **Spec-Abweichung (dokumentiert, keine Stammdaten raten):** `pflanzenkohle` existiert nicht in `output_produkt` (Migration 0008) → die 6 Slots laufen als `methanol` (derivate/target) mit den Pflanzenkohle-Preisen in €/kg; CO₂ ist per Referenztabelle `add_on` (nicht „target" wie in der Spec-Klammer) — konsistent mit dem E13-Modell (CO₂ = stofflich). Beides steht als Kommentar im Generator und geht als Frage an Eric (Migration 0011 „pflanzenkohle" + Orb-Asset?).
- H2-Codes: je zur Hälfte `h2_niederdruck`/`h2_hochdruck`; Synthesegas = `synthesegas`; Wärme/CO₂/Asche wie Referenz.
- Ausführung: `pnpm --filter web seed:preview` (tsx als devDep in apps/web); Datei liegt in `apps/web/scripts/` — nicht im Build-Pfad (Next bündelt nur `app/`/`lib`-Importe).

---

### Task 1: Zugänglichkeit — `@bhyo/db/client`-Export + tsx

**Files:** Modify `packages/db/package.json` (exports `"./client": "./src/client.ts"`), Modify `apps/web/package.json` (devDep `tsx`, Script `"seed:preview": "tsx scripts/seed-preview.ts"`).
**Verify:** `pnpm install` läuft; `pnpm --filter web exec tsx --version`.
**Commit:** `Seed v2: Zugriffe — @bhyo/db/client-Export, tsx-Runner in apps/web`

### Task 2: Purer Generator + Invarianten-Tests (TDD, Kern der Arbeit)

**Files:** Create `apps/web/scripts/seed-daten.ts`, Test `apps/web/scripts/seed-daten.test.ts` (Vitest-Default-Glob greift, keine Config nötig).

**Interfaces (Produces):**
```ts
export const SEED = 20260922;
export const BASIS_JAHR = 2026;
export interface SeedVergabe { vergebenVon: string | null; vergebenBis: string | null; vergebenAn: string | null; anBhyo: boolean; }
export interface SeedStrom { id: string; akteurIndex: number; art: "biomasse" | "output";
  bezeichnung: string; ort: string; landkreis: string; lng: number; lat: number;
  materialartCode?: string; mengeRohFm?: number; tsAnteilPct?: number; aschegehaltPct?: number;
  produktCode?: string; mengeWert?: number; mengeEinheit?: string;
  preisMin?: number | null; preisMittel?: number | null; preisMax?: number | null; preis?: number | null; preisEinheit?: string | null;
  zeitraumVon: string; zeitraumBis: string; saisonalitaet: number[]; // Anteile, Summe 1 (Skala wie DB: hier als PROZENT gespeichert, Summe 100 ±0,1)
  qualitaet: "A" | "B" | "C" | "D" | null; status: "entwurf" | "in_pruefung" | "geprueft";
  reserviertBhyo: boolean; reserviertSeit: string | null; vergaben: SeedVergabe[];
  beleg: null | { typ: string; extern: boolean; erhebungsdatum: string; quellenangabe: string };
  anker?: string; }
export interface SeedAkteur { name: string; sektor: string; }
export function baueSeedDaten(basisJahr?: number): { akteure: SeedAkteur[]; feedstock: SeedStrom[]; outputs: SeedStrom[] };
```
(Saisonalität wird wie im Bestand als 12 Prozentwerte gespeichert; „Summe = 1" der Spec heißt hier Summe 100 ± 0,1 — die Fensterrechnung normiert ohnehin auf die Profilsumme.)

**Steps:** (1) Test-Datei mit ALLEN §1/§2/§3/§4-Invarianten als Assertions schreiben — Anzahlen (60/50, Materialarten-Tabelle exakt, Qualität 15/20/18/7, 8+6 ohne Preis, Vergabe-Zählungen 12/6/7 bzw. ≥5/≥3), Wertregeln (min≤mittel≤max signiert; TS-Werte je Art; Mengen 500–25.000, genau 2 > 20.000; Saison-Summe 100±0,1; Zeitraum-Buckets 10/25/15/8/2), Validierungskonformität jeder Vergabenliste via `validiereVergaben` aus `../lib/verfuegbarkeit` (leeres Fehlerobjekt), Anker A1–A14 einzeln mit exakten Eigenschaften (per `anker`-Feld auffindbar), Determinismus (`expect(baueSeedDaten()).toEqual(baueSeedDaten())`). (2) FAIL. (3) Generator implementieren (mulberry32; Orte-Tabelle Rhein-Neckar/Vorderpfalz/Odenwald/Kraichgau ~24 Gemeinden mit Näherungs-Koordinaten + Jitter ±0,02; 3 Koordinaten-Paare quasi identisch inkl. A14; Saisonprofile je Spec; A3-Kommentar mit ausgerechnetem Erwartungswert: Stroh-Profil [1,1,2,3,5,8,20,26,18,9,4,3] ⇒ Jul–Sep = 64 %, freier Anteil in B+2 = 36 % statt 75 % bei n/12). (4) PASS. (5) Commit `Seed v2: deterministischer Generator — Spec-Invarianten als Tests`.

### Task 3: Writer mit Guard, Marker-Delete, Insert, Selbstprüfung §4

**Files:** Create `apps/web/scripts/seed-preview.ts`.
**Consumes:** `baueSeedDaten` (Task 2), `createSql` aus `@bhyo/db/client`, `drizzle` + Schema aus `@bhyo/db/schema`, `leiteVerfuegbarkeitAb`/`verfuegbarkeitPill` aus `../lib/verfuegbarkeit` (Statusverteilung).
**Steps:** (1) Guard wie oben (Abbruch mit Exit 1 + Klartext). (2) Delete in Marker-Reihenfolge (Transaktion). (3) Insert: Akteure → Belege (nur wo `beleg` gesetzt; Qualität wird NICHT geraten, sondern die Spec-Qualität direkt in die Strom-Spalte geschrieben — Seed-Kontext, wie der bestehende seed.ts) → Ströme (mit `standort_geom` via `ST_SetSRID(ST_MakePoint(lng,lat),4326)`) → `vergabe_zeitraum`. (4) Selbstprüfung ausgeben: Zählungen mit Marker aus der DB zurücklesen, Invarianten (min≤mittel≤max, Vergabe-in-Zeitraum, überlappungsfrei, Saison-Summe), Statusverteilung über alle 110 (fünf Status + Nebentag-Zähler), Zeitraum-Spannweite, Preis-Vorzeichen-Zählung; bei Verletzung Exit 1. (5) Lokaler Smoke ohne DB unmöglich → `pnpm --filter web build` + `pnpm --filter web test` grün. Commit `Seed v2: Writer — Guard, Marker-Idempotenz, Selbstprüfung`.

### Task 4: Workflow + zwei Läufe gegen die Preview

**Files:** Create `.github/workflows/seed-preview.yml` — `workflow_dispatch` only, Steps checkout/pnpm/node22/install, dann `pnpm --filter web seed:preview` mit `SEED_DATABASE_URL_PREVIEW: ${{ secrets.DATABASE_URL_PREVIEW }}`.
**Steps:** Push Branch → `gh workflow run seed-preview.yml --ref seed-preview-v2` → Log der Selbstprüfung ziehen → zweiter Lauf → Selbstprüfungs-Ausgaben beider Läufe diffen (identisch = DoD „zweimal identisch"). Commit `Seed v2: workflow_dispatch-Job (nur Preview-Secret)`.

### Task 5: Browser-Verifikation, Screenshots, Bericht

- Preview (Browser, eigener Tab): auswertung. beide Boards gefüllt; karte. verteilte Marker inkl. Aggregation (A14); ströme. mit allen Statusvarianten (Verfügbarkeits-Facette durchklicken).
- Screenshots light + dark (dark via `document.documentElement.dataset.theme = "dark"`) für Feedstock- und Outputs-Board → `docs/design/v2/pruef/seed-auswertung-{feedstock,outputs}-{light,dark}.jpg` (save_to_disk + ins Repo kopieren).
- Production-Check: prod `/register` unverändert (Anzahl vor/nach identisch, kein SEED-v2-Treffer in der Suche).
- PR öffnen, NICHT mergen; Merge-Empfehlung im Bericht (siehe DoD §5).

## Self-Review (durchgeführt)

Spec §0 Guard/Idempotenz/Determinismus/BASIS_JAHR/Ablage → Constraints + T1/T3 ✓ · §1 komplette Tabelle → T2-Tests erzwingen jede Zahl ✓ · §2 inkl. Produkt-Mapping-Abweichung dokumentiert ✓ · §3 A1–A14 einzeln getestet (A3 mit ausgerechnetem Erwartungswert im Kommentar) ✓ · §4 doppelt: als Unit-Tests (ohne DB) UND als DB-Rücklese-Ausgabe im Writer ✓ · §5 zweimal-identisch via Log-Diff, Preview-Sichtprüfung, Screenshots, Prod-Bestätigung, Merge-Frage beantwortet ✓. Keine Platzhalter; Typnamen konsistent (SeedStrom/SeedVergabe/baueSeedDaten in T2→T3).
