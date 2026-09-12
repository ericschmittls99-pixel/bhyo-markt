# AP1i PR 5 — Formular-Panel (Anlegen/Bearbeiten) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Erfassungsformular wird ein Slide-in-Panel über der ströme.-Liste
(Anlegen UND Bearbeiten, Biomasse UND Output), mit gekoppelten Such-Comboboxen,
Live-Umrechnungskette, ziehbaren Saison-Balken, Inline-Validierung und dem
bestehenden R2-Beleg-Upload.

**Architecture:** Der Panel-Container (`ov ov--panel`) und das Chip-System aus
PR 3 werden wiederverwendet. Alle Werte aus Abfragen laufen durch reine,
DB-freie Mapper (Muster `lib/stroeme-zeilen.ts`) mit Tests in beiden
Treiber-Formen. Das Formular ist URL-getrieben (`?form=neu` bzw. `?form=<id>`);
die Route `/register/[art]/neu` bleibt als Deeplink. Server-Actions geben
Feld-Fehler zurück statt zu redirecten; der Client schließt das Panel und zeigt
den Toast.

**Tech Stack:** Next.js App Router auf Cloudflare Workers, Drizzle, R2,
Vitest. Keine neuen Laufzeit-Abhängigkeiten.

**Spec:** Auftragstext Eric (Chat, 2026-09-12) + `docs/ap1i-delta-v2.md`
(§1.3, §8 Entscheidungslog) + `docs/design/v2/ref/form_feedstock_light.webp`,
`form_output_light.webp`.

## Global Constraints

- Sprache: UI-Texte/Kommentare/Commits Deutsch, Bezeichner englisch, Domänenbegriffe deutsch (`snake_case` ohne Umlaute in Namen).
- Keine neuen Laufzeit-Abhängigkeiten. Keine Migration (0007 liegt auf main).
- Eine `sql<T>`-Annotation ist keine Konvertierung: jeder Abfragewert wird an genau einer Stelle in einem reinen, DB-freien Modul konvertiert; zu jedem Datenpfad ein Test in beiden Treiber-Formen.
- Stumme Fallbacks verboten: unerwartete Eingangsformate werden mit `console.error` protokolliert, nie stillschweigend geleert.
- E3: Fristen (Vertrag 36 / Betriebsdaten 12 / LOI 12 / Angebot 3 / Dokument 12 / Gespräch 6 Monate) = vorhandene Konstante `BELEG_MONATE` in `lib/verifizierung.ts` — nur Anzeige.
- E7: Landkreis = Combobox aus DISTINCT Bestandsdaten + Freitext. E8: kein Status-Feld, Neuanlage = `entwurf`. E10: Saison-Balken per Maus + Pfeiltasten, „Gleichverteilung", „KI-Vorschlag laden" disabled. E13: Output-Preis mit Einheiten €/t · €/MWh · €/kg · €/Nm³ und Enum `preis_herkunft`.
- Qualität A–D nur abgeleitet (gesperrte Box mit Erklärtext).
- Light UND Dark Pflicht; Screenshots beider in den PR-Text.
- Textreste: Rücklink „Zurück zum Register"; Geocoding-Hinweis korrigieren (AP1c ist fertig, Pin folgt später), nicht streichen.
- Mockup-Lücken werden im PR-Text dokumentiert, nicht geraten.

## Entschiedene Punkte (Eric, 2026-09-12)

1. **Deeplink `/register/[art]/neu`:** Route rendert die ströme.-Seite mit
   erzwungen offenem Panel selbst (kein Redirect); Abbrechen/X navigieren
   nach `/register?tab=<art>`.
2. **Beleg beim Bearbeiten:** bestehende `beleg`-Zeile wird IN PLACE
   aktualisiert (gleiche ID, neue Werte); das Audit läuft über die
   Pflicht-Begründung in der Änderungshistorie. Beleg-Zeilen und R2-Objekte
   werden nie gelöscht; eine neue Datei bekommt einen neuen R2-Key, der alte
   bleibt liegen. Hatte der Strom noch keinen Beleg, entsteht eine neue Zeile.
3. **Rücklink „Zurück zum Register":** auf der Deeplink-Route ist Abbrechen
   ein Link nach `/register?tab=<art>` mit `title`/aria-label
   „Zurück zum Register".

---

### Task 1: Formularwerte — Loader + reiner Mapper (Edit-Prefill)

**Files:**
- Create: `apps/web/lib/formular-modell.ts` (reine Typen/Funktionen, DB-frei)
- Create: `apps/web/lib/formular-modell.test.ts`
- Modify: `apps/web/lib/stroeme.ts` (neuer Loader `ladeFormularWerte`)

**Interfaces:**
- Produces: `FormularWerte`, `formularZeileZuWerte(art, row)`, `datumZuMonat`,
  `monatZuVon`, `monatZuBis` — von Task 6 (Action) und Task 7 (Panel) genutzt.
- Consumes: `parseSaison`-Logik analog `stroeme-zeilen.ts` (neu implementiert,
  da dort privat; mit Protokollierung statt stillem null).

- [ ] **Step 1: Failing Tests schreiben** (`formular-modell.test.ts`)

```ts
import { describe, expect, it, vi } from "vitest";
import {
  datumZuMonat, monatZuVon, monatZuBis,
  formularZeileZuWerte, type FormularZeile,
} from "./formular-modell";

const zeile: FormularZeile = {
  id: "b1", akteurId: "a1", akteurName: "Hof Müller", akteurSektor: "landwirtschaft",
  bezeichnung: "Rindergülle", ort: "Rülzheim", landkreis: "Germersheim",
  kontaktperson: null, materialartCode: "rinderguelle", cluster: "guelle_mist",
  produktCode: null, zeitraumVon: "2026-04-01", zeitraumBis: "2028-12-31",
  mengeRohFm: "1200.00", tsAnteilPct: "8.5", aschegehaltPct: null,
  mengeWert: null, mengeEinheit: null,
  preisMin: null, preisMittel: "4", preisMax: null,
  preis: null, preisEinheit: null, preisHerkunft: "schaetzung",
  saisonalitaet: [0,0,0,10,10,10,10,10,10,10,10,20],
  status: "entwurf",
  belegTyp: "gespraech", belegQuellenangabe: "Tel. 2026-08-01",
  belegLinkUrl: null, belegDateiKey: null, belegErstelltAm: new Date("2026-08-01T00:00:00Z"),
  belegGueltigBis: null, belegExtern: false,
  belegMetadata: { quellenangabe: "Tel. 2026-08-01", gespraechsdatum: "2026-08-01",
    gespraechspartner: "T. Müller", kernnotiz: "mündlich bestätigt" },
};

describe("Monat-Mapping", () => {
  it("Datum → Monat und zurück (von = Monatserster, bis = Monatsletzter)", () => {
    expect(datumZuMonat("2026-04-01")).toBe("2026-04");
    expect(datumZuMonat(null)).toBe("");
    expect(monatZuVon("2026-04")).toBe("2026-04-01");
    expect(monatZuBis("2026-04")).toBe("2026-04-30");
    expect(monatZuBis("2028-02")).toBe("2028-02-29"); // Schaltjahr
    expect(monatZuBis("2026-12")).toBe("2026-12-31");
  });
});

describe("formularZeileZuWerte", () => {
  it("liefert Input-taugliche Strings und die 12 Saisonwerte", () => {
    const w = formularZeileZuWerte("biomasse", zeile);
    expect(w.vonMonat).toBe("2026-04");
    expect(w.bisMonat).toBe("2028-12");
    expect(w.mengeRohFm).toBe("1200.00");
    expect(w.aschegehaltPct).toBe("");
    expect(w.saisonalitaet).toHaveLength(12);
    expect(w.beleg?.gespraechspartner).toBe("T. Müller");
    expect(w.beleg?.erhebungsdatum).toBe("2026-08-01");
  });
  it("Treiber-Form Zeichenkette: saisonalitaet als JSON-Text wird geparst", () => {
    const w = formularZeileZuWerte("biomasse", {
      ...zeile, saisonalitaet: "[0,0,0,10,10,10,10,10,10,10,10,20]",
    });
    expect(w.saisonalitaet[11]).toBe(20);
  });
  it("unerwartetes Saison-Format wird protokolliert, nicht still geleert", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = formularZeileZuWerte("biomasse", { ...zeile, saisonalitaet: "quatsch" });
    expect(w.saisonalitaet).toEqual(Array(12).fill(0));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen** (Modul fehlt)

Run: `cd apps/web && pnpm vitest run lib/formular-modell.test.ts`

- [ ] **Step 3: `formular-modell.ts` implementieren (minimal für diese Tests)**

```ts
import type { StromArt } from "./stroeme-modell";

export interface FormularBeleg {
  typ: string; quellenangabe: string; linkUrl: string; dateiKey: string | null;
  erhebungsdatum: string; gueltigBis: string; extern: boolean; amtlich: boolean;
  gespraechsdatum: string; gespraechspartner: string; kernnotiz: string;
}
export interface FormularWerte {
  id: string; art: StromArt;
  akteurId: string; akteurName: string; akteurSektor: string | null;
  bezeichnung: string; ort: string; landkreis: string; kontaktperson: string;
  cluster: string; materialartCode: string; produktCode: string;
  vonMonat: string; bisMonat: string;
  mengeRohFm: string; tsAnteilPct: string; aschegehaltPct: string;
  mengeWert: string; mengeEinheit: string;
  preisMin: string; preisMittel: string; preisMax: string;
  preis: string; preisEinheit: string; preisHerkunft: string;
  saisonalitaet: number[]; status: string;
  beleg: FormularBeleg | null;
}
export type FormularZeile = { /* alle Spalten der Task-1-Query, sql-Ausdrücke als unknown */ };

export function datumZuMonat(d: string | null): string { return d ? d.slice(0, 7) : ""; }
export function monatZuVon(m: string): string { return `${m}-01`; }
export function monatZuBis(m: string): string {
  const [j, mo] = m.split("-").map(Number);
  const letzter = new Date(Date.UTC(j!, mo!, 0)).getUTCDate(); // Tag 0 des Folgemonats
  return `${m}-${String(letzter).padStart(2, "0")}`;
}
export function saisonOderLeer(v: unknown, kontext: string): number[] {
  if (Array.isArray(v) && v.length === 12) return v.map((x) => Number(x) || 0);
  if (typeof v === "string") {
    try { const p: unknown = JSON.parse(v);
      if (Array.isArray(p) && p.length === 12) return p.map((x) => Number(x) || 0);
    } catch { /* unten protokollieren */ }
  }
  if (v != null) console.error(`Unerwartetes saisonalitaet-Format (${kontext}):`, v);
  return Array(12).fill(0);
}
const s = (v: string | null | undefined) => v ?? "";
export function formularZeileZuWerte(art: StromArt, r: FormularZeile): FormularWerte { /* mappt 1:1, numeric-Strings unverändert, Datum→Monat, Beleg aus Spalten+Metadata */ }
```

Beleg-Mapping in `formularZeileZuWerte`: `erhebungsdatum` aus
`belegErstelltAm.toISOString().slice(0,10)`, `amtlich`/`gespraechs*`/`kernnotiz`
aus `belegMetadata` (Typ-Guard wie `belegAus` in `stroeme-zeilen.ts`).

- [ ] **Step 4: Tests grün** — `pnpm vitest run lib/formular-modell.test.ts`

- [ ] **Step 5: Loader in `stroeme.ts` ergänzen** (kein Test — Query ohne
  sql-Ausdrücke, nur echte Spalten + Joins; Konvertierung ausschließlich im
  getesteten Mapper):

```ts
/** Rohwerte eines Stroms fuer das Edit-Formular (PR 5). */
export function ladeFormularWerte(art: StromArt, id: string): Promise<FormularWerte | null> {
  return withDb(async (db) => {
    if (art === "biomasse") {
      const [row] = await db.select({
        id: biomassestrom.id, akteurId: biomassestrom.akteurId,
        akteurName: akteur.name, akteurSektor: akteur.sektor,
        bezeichnung: biomassestrom.bezeichnung, ort: biomassestrom.ort,
        landkreis: biomassestrom.landkreis, kontaktperson: biomassestrom.kontaktperson,
        materialartCode: biomassestrom.materialartCode, cluster: materialart.cluster,
        zeitraumVon: biomassestrom.zeitraumVon, zeitraumBis: biomassestrom.zeitraumBis,
        mengeRohFm: biomassestrom.mengeRohFm, tsAnteilPct: biomassestrom.tsAnteilPct,
        aschegehaltPct: biomassestrom.aschegehaltPct,
        preisMin: biomassestrom.preisMin, preisMittel: biomassestrom.preisMittel,
        preisMax: biomassestrom.preisMax, preisHerkunft: biomassestrom.preisHerkunft,
        saisonalitaet: biomassestrom.saisonalitaet, status: biomassestrom.status,
        belegId: biomassestrom.belegId, belegTyp: beleg.typ, belegLinkUrl: beleg.linkUrl,
        belegDateiKey: beleg.dateiKey, belegErstelltAm: beleg.erstelltAm,
        belegGueltigBis: beleg.gueltigBis, belegExtern: beleg.externNachvollziehbar,
        belegMetadata: beleg.metadata,
      }).from(biomassestrom)
        .leftJoin(akteur, eq(akteur.id, biomassestrom.akteurId))
        .leftJoin(materialart, eq(materialart.code, biomassestrom.materialartCode))
        .leftJoin(beleg, eq(beleg.id, biomassestrom.belegId))
        .where(eq(biomassestrom.id, id)).limit(1);
      return row ? formularZeileZuWerte("biomasse", row) : null;
    }
    /* Output analog: produktCode statt materialartCode/cluster,
       mengeWert/mengeEinheit, preis/preisEinheit/preisHerkunft */
  });
}
```

- [ ] **Step 6: `pnpm exec tsc --noEmit` grün, dann Commit**

```bash
git add apps/web/lib/formular-modell.ts apps/web/lib/formular-modell.test.ts apps/web/lib/stroeme.ts
git commit -m "PR5 Task 1: Formularwerte-Mapper (pur, getestet) + ladeFormularWerte"
```

---

### Task 2: Options-Loader (Landkreise, Materialarten mit Cluster, Produkte mit Kategorie)

**Files:**
- Modify: `apps/web/lib/register.ts`
- Modify: `apps/web/lib/stroeme.ts`

**Interfaces:**
- Produces: `listMaterialartenMitCluster(): Promise<{code,label,cluster}[]>`,
  `OutputProduktOption` um `kategorie: string` erweitert,
  `ladeLandkreisOptionen(): Promise<string[]>` — von Task 7/8 genutzt.

- [ ] **Step 1: `register.ts`** — `OutputProduktOption` um `kategorie` erweitern
  (`kategorie: outputProdukt.art` im Select ergänzen; Aufrufer prüfen mit
  `grep -rn OutputProduktOption apps/web`); neue Funktion:

```ts
export interface MaterialartMitCluster { code: string; label: string; cluster: string }
export function listMaterialartenMitCluster(): Promise<MaterialartMitCluster[]> {
  return withDb((db) => db
    .select({ code: materialart.code, label: materialart.label, cluster: materialart.cluster })
    .from(materialart).orderBy(materialart.label));
}
```

- [ ] **Step 2: `stroeme.ts`** — Landkreise (E7) aus beiden Tabellen, nur echte
  Spalten (kein sql-Ausdruck), Deduplizieren/Sortieren in TypeScript:

```ts
/** DISTINCT Landkreise beider Tabellen fuer die Landkreis-Combobox (E7). */
export function ladeLandkreisOptionen(): Promise<string[]> {
  return withDb(async (db) => {
    const [a, b] = await Promise.all([
      db.selectDistinct({ lk: biomassestrom.landkreis }).from(biomassestrom),
      db.selectDistinct({ lk: outputBedarf.landkreis }).from(outputBedarf),
    ]);
    const alle = [...a, ...b].map((r) => r.lk).filter((x): x is string => !!x?.trim());
    return [...new Set(alle)].sort((x, y) => x.localeCompare(y, "de"));
  });
}
```

- [ ] **Step 3: `pnpm exec tsc --noEmit` + `pnpm test` grün, Commit**

```bash
git add apps/web/lib/register.ts apps/web/lib/stroeme.ts
git commit -m "PR5 Task 2: Options-Loader Landkreise/Materialarten/Produkt-Kategorie"
```

---

### Task 3: Reine Formular-Logik — Kopplung, Validierung, Saison-Helfer

**Files:**
- Modify: `apps/web/lib/formular-modell.ts`
- Modify: `apps/web/lib/formular-modell.test.ts`

**Interfaces:**
- Produces (von Task 5/6/7 genutzt):
  - `materialartenImCluster(alle, cluster)` / `clusterVonMaterialart(alle, code)`
  - `produkteInGruppe(alle, gruppe)` / `gruppeVonProdukt(alle, code)`
  - `validiereFormular(art, e: FormularEingaben): FeldFehler` (leeres Objekt = gültig)
  - `gleichverteilung(): number[]` (12 × 8.3), `saisonWertSetzen(werte, i, v)` (clamp 0–100, ganzzahlig)
  - `MENGE_EINHEITEN = ["t/a","MWh/a","Nm³/a"]`, `PREIS_EINHEITEN = ["€/t","€/MWh","€/kg","€/Nm³"]` (E13)
  - `FeldFehler = Record<string, string>`; Fehlermeldungen: `"Pflichtfeld"`, `"Datei oder Link erforderlich"`, `"Muss eine Zahl sein"`, `"Bis-Monat liegt vor dem Ab-Monat"`

- [ ] **Step 1: Failing Tests** — u. a.:

```ts
describe("validiereFormular biomasse", () => {
  const ok = { akteurId: "a1", materialartCode: "x", mengeRohFm: "100",
    tsAnteilPct: "50", aschegehaltPct: "3", vonMonat: "2026-01", bisMonat: "2026-12",
    begruendung: "Ersterfassung", belegTyp: "", belegQuellenangabe: "",
    belegErhebungsdatum: "", belegHatDatei: false, belegLink: "" };
  it("gültig → keine Fehler", () => expect(validiereFormular("biomasse", ok)).toEqual({}));
  it("Pflichtfelder fehlen → benannte Fehler", () => {
    const f = validiereFormular("biomasse", { ...ok, akteurId: "", begruendung: " " });
    expect(f.akteur_id).toBe("Pflichtfeld");
    expect(f.begruendung).toBe("Pflichtfeld");
  });
  it("Beleg gewählt → Quellenangabe/Erhebungsdatum Pflicht, Datei ODER Link", () => {
    const f = validiereFormular("biomasse", { ...ok, belegTyp: "dokument_link" });
    expect(f.beleg_quellenangabe).toBe("Pflichtfeld");
    expect(f.beleg_datei).toBe("Datei oder Link erforderlich");
  });
  it("bis vor von → Fehler am Bis-Feld", () => {
    const f = validiereFormular("biomasse", { ...ok, vonMonat: "2027-01", bisMonat: "2026-01" });
    expect(f.zeitraum_bis).toBe("Bis-Monat liegt vor dem Ab-Monat");
  });
});
describe("Kopplung Cluster→Materialart", () => {
  const alle = [{ code: "a", label: "A", cluster: "c1" }, { code: "b", label: "B", cluster: "c2" }];
  it("filtert und findet rückwärts", () => {
    expect(materialartenImCluster(alle, "c1").map((m) => m.code)).toEqual(["a"]);
    expect(clusterVonMaterialart(alle, "b")).toBe("c2");
  });
});
describe("Saison-Helfer", () => {
  it("gleichverteilung: 12 Werte, Summe ≈ 100", () => {
    const g = gleichverteilung();
    expect(g).toHaveLength(12);
    expect(g.reduce((a, b) => a + b, 0)).toBeCloseTo(99.6, 1);
  });
  it("saisonWertSetzen clampt 0–100 und rundet", () => {
    expect(saisonWertSetzen(Array(12).fill(0), 3, 104.6)[3]).toBe(100);
    expect(saisonWertSetzen(Array(12).fill(0), 0, -2)[0]).toBe(0);
  });
});
```

Pflichtfelder je Art (aus Bestands-Actions + Mockup `*`-Markierungen):
biomasse `akteur_id, materialart_code, menge_roh_fm, ts_anteil_pct,
aschegehalt_pct, zeitraum_von(Monat), zeitraum_bis(Monat), begruendung`;
output `akteur_id, produkt_code, menge_wert, menge_einheit, zeitraum_von,
zeitraum_bis, begruendung`. Zahlenfelder (`menge_*, ts_*, asche*, preis*`)
prüfen auf `Number.isFinite`.

- [ ] **Step 2: rot sehen → implementieren → grün** (`pnpm vitest run lib/formular-modell.test.ts`, danach `pnpm test` komplett)

- [ ] **Step 3: Commit** — `git commit -m "PR5 Task 3: Formular-Validierung, Facetten-Kopplung, Saison-Helfer (pur, getestet)"`

---

### Task 4: SuchCombobox (generisch) + AkteurCombobox im V2-Look

**Files:**
- Create: `apps/web/components/stroeme/SuchCombobox.tsx`
- Modify: `apps/web/components/AkteurCombobox.tsx` (nur Klassen/Markup auf V2)
- Modify: `apps/web/app/globals.css` (Combobox-Stile)

**Interfaces:**
- Produces: `SuchCombobox` — Client-Komponente:

```ts
export function SuchCombobox({ label, name, wert, onWert, optionen, placeholder,
  pflicht, freitext, fehler, deaktiviert }: {
  label: string; name: string;                 // hidden input für FormData
  wert: string; onWert: (v: string) => void;   // kontrolliert vom Panel
  optionen: { wert: string; label: string; meta?: string }[];
  placeholder?: string; pflicht?: boolean;
  freitext?: boolean;                          // E7 Landkreis: Eingabe = Wert
  fehler?: string;                             // Inline-Fehler unterm Feld
  deaktiviert?: boolean;
}): JSX.Element
```

Verhalten: Textfeld filtert `optionen` (case-insensitive, `label` + `meta`),
Popover mit `menu`/`menu-item`-Klassen aus PR 3, Pfeiltasten + Enter + Escape,
Klick außerhalb schließt (Muster `AkteurCombobox`). Bei `freitext` wird der
getippte Text als Wert übernommen, sobald kein Treffer gewählt ist. Gewählte
Option zeigt ihr Label im Feld; `aria-expanded`, `role="combobox"`/`listbox`.
Ein gespeicherter Wert, der nicht in `optionen` vorkommt (z. B. Alt-Einheit),
wird als zusätzliche Option oben einsortiert — nie still verworfen.

- [ ] **Step 1: Komponente bauen**, CSS: `.scb`-Block in globals.css neben den
  `.pf`-Stilen (Feld = `.pf-feld input`-Optik, Popover = vorhandene `.pop`/
  `.menu`-Klassen wiederverwenden, kein Duplikat). Light + Dark prüfen (Felder
  nutzen Token `--field-bg`, `--border-default` — bereits theme-fähig).
- [ ] **Step 2: `AkteurCombobox`** auf dieselben Klassen umstellen (`.pf`,
  `.pop`, `.menu-item` statt Inline-Styles/`card`), Verhalten unverändert
  (Suche über `/api/akteure`, Inline-Neuanlage bleibt). Props um
  `initial?: { id, name, sektor }` (Edit-Prefill) und `fehler?: string` ergänzen.
- [ ] **Step 3: `pnpm exec tsc --noEmit` + `pnpm build` grün, Commit**

```bash
git add apps/web/components/stroeme/SuchCombobox.tsx apps/web/components/AkteurCombobox.tsx apps/web/app/globals.css
git commit -m "PR5 Task 4: SuchCombobox (V2) + AkteurCombobox im V2-Look"
```

---

### Task 5: SeasonBarsEdit — ziehbare Saison-Balken (E10)

**Files:**
- Create: `apps/web/components/stroeme/SeasonBarsEdit.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: `gleichverteilung`, `saisonWertSetzen` aus Task 3.
- Produces: `SeasonBarsEdit({ werte, onWerte }: { werte: number[]; onWerte: (w: number[]) => void })`.
  Hidden inputs `saison_0`…`saison_11` rendert das Panel (Task 7), nicht die Komponente.

- [ ] **Step 1: Komponente bauen.** 12 Spalten (Optik wie `SeasonBarsMini`:
  `.sbar`/`.sbar-fill` als Basis, neue Klasse `.sbars--edit`):
  - **Maus/Pointer:** `onPointerDown` auf der Spalte + `setPointerCapture`;
    Wert aus Y-Position: `wert = clamp(0, 100, round(100 * (bottom - clientY) / hoehe))`
    über `saisonWertSetzen`; `onPointerMove` während Capture zieht weiter —
    auch quer über Nachbarspalten (Spaltenindex aus X-Position).
  - **Tastatur:** jede Spalte `role="slider"`, `tabIndex=0`, `aria-label`
    „Anteil <Monat>", `aria-valuemin=0/-max=100/-now`, `aria-valuetext="n %"`;
    Pfeil hoch/runter ±1, PageUp/Down ±10, Home=0, End=100.
  - Wertanzeige über dem aktiven Balken (`n %`), Monatsbuchstaben darunter.
  - Buttons darunter: `Gleichverteilung` (btn btn--sm) setzt
    `onWerte(gleichverteilung())`; `KI-Vorschlag laden` (btn btn--sm,
    `disabled`, `title="Folgt mit der KI-Anreicherung (AP2)."`).
- [ ] **Step 2: CSS** — Balkenfläche `cursor: ns-resize`, Fokusring
  (`outline: 2px solid var(--focus-ring)`), Dark-tauglich über Tokens.
- [ ] **Step 3: tsc + build grün, Commit** — `git commit -m "PR5 Task 5: SeasonBarsEdit — ziehbare Saison-Balken (E10)"`

---

### Task 6: Server-Action `stromSpeichern` (Anlegen + Bearbeiten, beide Arten)

**Files:**
- Create: `apps/web/lib/formular-actions.ts`
- Modify: `apps/web/lib/actions.ts` (Beleg-Verarbeitung hierher umziehen; Datei
  wird am Ende von Task 8 gelöscht, bis dahin re-exportiert sie nichts Neues)

**Interfaces:**
- Consumes: `validiereFormular`, `monatZuVon/Bis`, `FeldFehler` (Task 3);
  `erstelleBeleg`-Logik aus `actions.ts` (verschieben, nicht duplizieren);
  `deriveQualitaet`, `berechneGueltigBis` (`lib/qualitaet.ts`); `withDb`,
  `currentUserEmail`, `getBelegeBucket`, `getEnvironment` (`lib/db.ts`).
- Produces:

```ts
export interface SpeichernErgebnis { ok?: boolean; feldFehler?: FeldFehler; fehler?: string }
/** id = null → Anlegen (Status entwurf, E8); sonst Bearbeiten. */
export async function stromSpeichern(
  art: StromArt, id: string | null,
  _prev: SpeichernErgebnis, formData: FormData,
): Promise<SpeichernErgebnis>
```

- [ ] **Step 1: Action implementieren** (`"use server"`):
  1. `currentUserEmail()` — sonst `{ fehler: "Nicht authentifiziert." }`.
  2. FormData → `FormularEingaben` (nur `text()`-Extraktion), dann
     `validiereFormular(art, e)`; bei Fehlern `{ feldFehler }` zurück — **vor**
     jedem R2-Upload (keine Waisen, wie bisher).
  3. Werte bauen: `zeitraumVon = monatZuVon(e.vonMonat)`,
     `zeitraumBis = monatZuBis(e.bisMonat)`, Saison aus `saison_0..11`
     (Muster Bestands-Action), Preisfelder; Output zusätzlich `preis`,
     `preisEinheit`, `preisHerkunft` (E13). **Kein `status`-Feld** (E8).
  4. **Anlegen:** wie `createBiomasse`/`createOutput` heute (Beleg zuerst,
     Insert mit `qualitaet` aus Ableitung, `logAenderung` mit Begründung),
     aber OHNE `redirect` — Rückgabe `{ ok: true }`, `revalidatePath("/register")`.
  5. **Bearbeiten:** in Transaktion: Zeile laden (`belegId` mit); Beleg
     (Entscheidung: in place):
     - kein Beleg-Typ im Formular → `belegId = null`, `qualitaet = null`
       (Beleg-Zeile bleibt stehen, wird nur entkoppelt);
     - Beleg-Typ gewählt und Strom hat `belegId` → bestehende Zeile per
       UPDATE überschreiben (typ, linkUrl, extern, metadata, gueltigBis,
       `erstelltAm` = Erhebungsdatum); neue Datei → neuer R2-Key ersetzt
       `dateiKey` (altes R2-Objekt bleibt liegen), ohne neue Datei bleibt
       der bestehende `dateiKey`;
     - Beleg-Typ gewählt, aber noch kein `belegId` → neue Zeile anlegen.
     `qualitaet` immer neu ableiten.
     Update der Stromtabelle (`updatedAt: new Date()`), danach
     `logAenderung(db, entitaetTyp, id, email, begruendung)`.
  6. Fehlerbehandlung wie `fehlertext()` heute: ValidierungsFehler → Meldung,
     alles andere `console.error` + generische Meldung (kein stiller Schluck).
- [ ] **Step 2: `erstelleBeleg`, `logAenderung`, `text`/`pflicht`-Helfer aus
  `actions.ts` nach `formular-actions.ts` verschieben** (Import in `actions.ts`
  zeigt übergangsweise auf das neue Modul, damit der Build bis Task 8 grün bleibt).
- [ ] **Step 3: Monat-Mapping-Tests laufen schon (Task 1); `pnpm test` +
  `pnpm exec tsc --noEmit` grün, Commit** —
  `git commit -m "PR5 Task 6: stromSpeichern — Anlegen/Bearbeiten mit Feld-Fehlern, Beleg-Diff, E8/E13"`

---

### Task 7: FormularPanel — die Panel-Komponente

**Files:**
- Create: `apps/web/components/stroeme/FormularPanel.tsx`
- Modify: `apps/web/app/globals.css` (Formular-Abschnitte im Panel)

**Interfaces:**
- Consumes: `SuchCombobox` (T4), `SeasonBarsEdit` (T5), `AkteurCombobox`,
  `ConversionChain`, `stromSpeichern` (T6), `deriveQualitaet`,
  `naechsteVerifizierung`, Kopplungs-/Einheiten-Konstanten (T3),
  `useUrlZustand`, `fmtZahl`.
- Produces:

```ts
export function FormularPanel({ art, werte, materialarten, produkte, landkreise,
  zurueckHref }: {
  art: StromArt;
  werte: FormularWerte | null;              // null = Anlegen
  materialarten: MaterialartMitCluster[];   // biomasse
  produkte: OutputProduktOption[];          // output (mit kategorie)
  landkreise: string[];
  zurueckHref?: string;                     // Deeplink-Route: Schließen navigiert hierhin
}): JSX.Element
```

- [ ] **Step 1: Gerüst** — Container exakt wie `Detail` im Panel-Modus:
  `<div className="ov ov--panel"><section role="dialog" aria-label=… className="ov-flaeche">`,
  Kopf mit Titel `feedstock anlegen.` / `output anlegen.` / `strom bearbeiten.`
  + Untertitel `Ein Strom je Quelle × Materialart × Zeitraum.` (output:
  `Ein Bedarf je Abnehmer × Output × Zeitraum.`) + X-Button. Scrollender
  `ov-body` mit `<form>`, sticky Fußleiste `ov-fuss` (neu in CSS): links
  `Abbrechen` (btn), rechts `Anlegen`/`Speichern` (btn btn--primary, bei
  `pending` disabled + „Speichert…"). Schließen (X/Abbrechen/Escape):
  `zurueckHref ? router.push(zurueckHref) : setze({ form: null }, "push")`.
  Auf der Deeplink-Route trägt der Abbrechen-Link `title="Zurück zum Register"`
  (Textrest, offener Punkt 3).
- [ ] **Step 2: Abschnitte** (Kicker-Überschriften wie Detail `ov-sec > h3`),
  Feldraster `pf`/`pf-feld` mit Einheiten-`<em>`; Inline-Fehler als
  `<span className="pf-fehler">` unter dem Feld (rot = `--danger`-Token; falls
  keiner existiert: Navy-Ton + Icon `ph-warning`, KEINE Ampel-Semantik für
  Qualität, aber Fehler dürfen rot):
  1. **quelle.** — `AkteurCombobox` (Pflicht, Prefill), Bezeichnung
     (Platzhalter `z. B. Rindergülle Milchviehbetrieb` / output
     `z. B. Fernwärmenetz Speyer-Nord`), Ort, Landkreis =
     `SuchCombobox freitext` mit `landkreise` (E7), Kontaktperson mit
     `optional`-Label. Hinweis-Box (`.hinweis-box`, sunken, Icon `ph-map-pin`):
     `Karten-Pin setzen folgt – ohne Pin erscheint der Strom nicht auf der
     Karte.` (Textrest korrigiert: kein AP1c-Versprechen mehr).
  2. **materialart & zeitraum.** (output: **output & zeitraum.**) — biomasse:
     `SuchCombobox` Cluster (Optionen aus `CLUSTER_LABEL`-Einträgen, die in
     `materialarten` vorkommen) + `SuchCombobox` Materialart (Pflicht, Optionen
     `materialartenImCluster`); Clusterwechsel leert eine nicht mehr passende
     Materialart, Materialartwahl setzt den Cluster (`clusterVonMaterialart`).
     Output: Gruppe (`OUTPUT_LABEL`) + Output (`produkteInGruppe`), darunter
     Hinweistext `Kategorie: <Target Output|Add-On>` aus `kategorie` des
     gewählten Produkts. Zeitraum: 2 × `input type="month"` `Verfügbar ab *` /
     `Verfügbar bis *` (names `zeitraum_von`/`zeitraum_bis`, Werte
     `vonMonat`/`bisMonat`).
  3. **mengen.** (output: **bedarfsmenge.**) — biomasse: Rohmenge (`em` t FM/a,
     Pflicht), TS-Anteil (%), Aschegehalt (%); darunter `ConversionChain` als
     Live-Vorschau (kontrollierte Werte, atro = `roh × ts/100 × (1 − asche/100)`,
     `fmtZahl`, Richtung row = bestehende `.chain`-Optik). Output: Bedarfsmenge
     (Pflicht) + Einheit-Select aus `MENGE_EINHEITEN` (Alt-Wert als
     Zusatzoption, siehe T4).
  4. **saisonalität.** — `SeasonBarsEdit` + hidden `saison_0..11`.
  5. **preis.** — biomasse: Min/Mittel/Max (`em` €/t) + Herkunft-Select
     (eigene Datenbank/Marktdaten/Schätzung) + Hinweis
     `Eigener Wert setzt die Herkunft auf Schätzung.`; output (E13): Preis +
     Einheit-Select `PREIS_EINHEITEN` + Herkunft-Select (gleiches Enum).
  6. **beleg.** — Typenwahl als Chip-Radiogroup (`fchip`-Klassen aus PR 3,
     `role="radiogroup"`, erneuter Klick wählt ab), danach: Quellenangabe
     (Pflicht, Platzhalter `z. B. Liefervertrag 2024, S. 3`), `Datei oder Link`
     (Datei-Input versteckt + Button `Datei wählen` (btn btn--sm) + gewählter
     Dateiname bzw. bei Edit `Bestehende Datei bleibt erhalten` + Link-Feld),
     Erhebungsdatum (Pflicht bei Beleg), typ-spezifisch `Angebot gültig bis` /
     Gesprächsdatum + Gesprächspartner + Kernnotiz (`<textarea>`), Toggles
     `Extern nachvollziehbar` (dynamische Beschreibung `ja, freigegeben` /
     `nein, intern`) und bei `dokument_link` `Amtliche Quelle oder Betreiberdaten`.
  7. **Qualitäts-Box** (sunken, `.qual-box`): Label `Qualität (abgeleitet)`,
     A–D-Pillenreihe (`KonfidenzPill`-Rampe; aktive Stufe opak, Rest 30 %
     Opacity), Text `Aus Belegtyp und Nachvollziehbarkeit berechnet, nicht
     editierbar.` + ` Nächste Verifizierung: <fmtDatum>` via
     `naechsteVerifizierung({typ, gueltigBis, erhebungsdatum})`, sonst ohne
     Datums-Satz. Live aus `deriveQualitaet` (Muster altes Formular).
  8. **begründung.** — `<textarea name="begruendung" placeholder="Warum dieser
     Wert, warum diese Quelle?">` (Pflicht), Hinweis `Wird in der
     Änderungshistorie protokolliert.`
- [ ] **Step 3: Submit-Verdrahtung** — `useActionState(stromSpeichern.bind(null,
  art, werte?.id ?? null), {})`; nach `ok`: Toast `Strom angelegt – Status
  Entwurf` bzw. `Änderungen gespeichert`, Panel schließen, `router.refresh()`
  (Toast-Muster aus `Detail.tsx`). `feldFehler` an die Felder verteilen;
  `fehler` als Fehlerzeile über der Fußleiste. HTML-`required` bewusst NICHT
  gesetzt (Inline-Fehler erst nach Speichern-Versuch, wie Mockup).
- [ ] **Step 4: CSS** — `.ov-fuss` (sticky Fußleiste mit Trennlinie),
  `.hinweis-box`, `.qual-box`, `.pf-fehler`, Chip-Radiogroup-Abstand; alles
  über bestehende Tokens, Light + Dark gegenprüfen.
- [ ] **Step 5: tsc + build grün, Commit** —
  `git commit -m "PR5 Task 7: FormularPanel — alle Abschnitte, Live-Qualitaet, Inline-Fehler"`

---

### Task 8: Verdrahtung — URL-Param, Deeplink, Bearbeiten, Aufräumen

**Files:**
- Modify: `apps/web/app/register/page.tsx`
- Modify: `apps/web/app/register/[art]/neu/page.tsx`
- Modify: `apps/web/components/stroeme/Toolbar.tsx`
- Modify: `apps/web/components/stroeme/Detail.tsx`
- Delete: `apps/web/components/ErfassungFormular.tsx`, `apps/web/components/SaisonEditor.tsx`, `apps/web/lib/actions.ts` (Reste nach T6-Umzug)

**Interfaces:**
- Consumes: alles aus T1–T7. URL-Schema: `?form=neu` (Anlegen) bzw.
  `?form=<id>` (Bearbeiten); `form` und `detail` schließen sich aus.

- [ ] **Step 1: `register/page.tsx`** — `formParam = ersterWert(sp.form)`;
  wenn gesetzt: Optionen laden (`listMaterialartenMitCluster` bzw.
  `listOutputProdukte`, `ladeLandkreisOptionen`) und bei `form !== "neu"`
  `ladeFormularWerte(art, formParam)` (nicht gefunden → Panel nicht rendern,
  `console.error`). Rendert `<FormularPanel …/>` STATT `<Detail …/>`
  (`form` gewinnt gegen `detail`).
- [ ] **Step 2: Einstiege** — `Toolbar.tsx`: Primäraktion wird Button, der
  `setze({ form: "neu", detail: null }, "push")` ruft (Link auf `/neu`
  entfällt); EmptyState-Link in `register/page.tsx` ebenso auf
  `?form=neu`-Href umstellen (`/register?tab=<art>&form=neu`). `Detail.tsx`:
  der `Bearbeiten`-Button ersetzt den Platzhalter-Toast durch
  `setze({ form: s.id, detail: null }, "push")` (Kommentar Zeile 43 anpassen).
- [ ] **Step 3: Deeplink** — `app/register/[art]/neu/page.tsx` (offener
  Punkt 1, Default): validiert `art`, lädt dieselben Daten wie `register/
  page.tsx` mit festem `tab=<art>`, `form=neu` und rendert die Register-Seite
  (Refactor: deren JSX in eine gemeinsame Server-Komponente
  `RegisterInhalt({ sp, formErzwungen })` ziehen, beide Routen rufen sie auf);
  `zurueckHref = /register?tab=<art>`. Alter Formular-Import entfällt.
- [ ] **Step 4: Aufräumen** — `ErfassungFormular.tsx`, `SaisonEditor.tsx`
  löschen; `lib/actions.ts` löschen, wenn `grep -rn "lib/actions" apps/web`
  keine Treffer mehr zeigt (MaterialartCombobox bleibt: alte Karte/FilterBar
  nutzen sie ggf. — vor Löschen `grep -rn MaterialartCombobox apps/web`).
- [ ] **Step 5: Volle Verifikation** — `pnpm exec tsc --noEmit`, `pnpm test`,
  `pnpm build` grün; `pnpm dev` + `curl -s localhost:PORT/register/biomasse/neu`
  enthält `ov--panel` und `feedstock anlegen.` (DB-lose Prüfung: Optionen-Loader
  müssen DB-Fehler NICHT abfangen — lokal ohne DB rendert die Route 500, das
  ist bekannt; Smoke dann auf dem Preview).
- [ ] **Step 6: Commit** — `git commit -m "PR5 Task 8: Formular-Panel verdrahtet — ?form=, Deeplink, Bearbeiten, Altcode entfernt"`

---

### Task 9: Preview, Prüfschleife, PR

- [ ] **Step 1: Branch pushen, PR öffnen** (Basis main, Titel
  `AP1i PR5: Formular-Panel — Anlegen/Bearbeiten, Saison-Balken, Validierung`).
  PR-Text: Entscheidungen (E3/E7/E8/E10/E13 umgesetzt), die drei offenen
  Punkte mit gewähltem Default, Abweichungsliste zum Mockup (z. B. Textarea
  Kernnotiz statt Einzelfeld, Chip-Radiogroup-Details), Screenshot-Plätze.
- [ ] **Step 2: Preview-Deploy abwarten** (`gh run watch`), `/api/health` grün.
- [ ] **Step 3: Prüfschleife im Browser** (Access blockt curl): Anlegen
  Biomasse + Output inkl. Beleg-Upload, Bearbeiten beider Arten, Saison-Balken
  mit Maus + Pfeiltasten, Deeplink `/register/biomasse/neu`, Inline-Fehler,
  Qualitäts-Box, Light + Dark; Screenshots beider Themes in den PR-Text.
- [ ] **Step 4: Eric übernimmt die Freigabe**; kein Merge ohne Zustimmung.

## Self-Review (erledigt)

- Spec-Abdeckung: Panel statt Seite (T7/T8), Deeplink (T8), Comboboxen mit
  Kopplung (T3/T4/T7), Monat-Zeitraum (T1/T6), Umrechnungskette (T7),
  Saison-Balken (T5), Preis-Korridor + Output-Preis E13 (T6/T7), Beleg-Upload
  (T6), Begründung Pflicht (T3), E3-Anzeige (T7), E7 (T2/T7), E8 (T6),
  Qualitäts-Box (T7), Textreste (T7/T8), Lehren aus PR 3 (T1/T3, Global),
  DoD-Verifikation (T8/T9).
- Typen konsistent: `FormularWerte`/`FeldFehler`/`SpeichernErgebnis` in T1/T3/T6
  identisch benannt; `form`-URL-Param einheitlich in T7/T8.
