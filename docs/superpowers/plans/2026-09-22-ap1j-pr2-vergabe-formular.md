# AP1j PR ② — Formular/Detail: Vergabezeitraum-Liste, Validierung, Status-Pille

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vergabezeiträume und die bhyo-Reservierung im Formular erfassen, im Detail anzeigen und den abgeleiteten Verfügbarkeitsstatus als Pille zeigen.

**Architecture:** Reines Ableitungs-/Validierungsmodul `apps/web/lib/verfuegbarkeit.ts` (Status nie gespeichert, `heute` immer Parameter — Prinzip wie Qualität A–D); Persistenz in der bestehenden Server-Action `stromSpeichern` (Vergabezeilen werden je Speichern vollständig ersetzt); UI als neue Sektion in FormularPanel und Detail. Grid/Tabelle/Karte-Tags und auswertung. kommen erst in PR ③/④ — Detail-Props deshalb optional.

**Tech Stack:** Next.js App Router (Achtung: `apps/web/AGENTS.md` — vor Next-spezifischem Code die Doku in `node_modules/next/dist/docs/` lesen), Drizzle, Vitest.

**Spec:** `docs/ap1j-handoff-verfuegbarkeit-vergabe.md` (verbindlich; Abschnitte „Abgeleiteter Verfügbarkeitsstatus", „Konvention offener Enden", „Validierung (Formular)").

## Global Constraints

- Sprache: UI-Texte/Kommentare Deutsch, technische Bezeichner Englisch, Domänenbegriffe Deutsch; Enum-Werte `snake_case` ohne Umlaute (`vergeben_extern`, `noch_nicht_verfuegbar`).
- Status wird **nie gespeichert, immer abgeleitet**; `heute` ist immer Parameter (kein `Date.now()`/`new Date()` in `lib/verfuegbarkeit.ts`).
- Keine Ampelfarben: Pillen nutzen die bestehenden `spill`-Töne `active`/`running`/`quiet`/`inactive` (`docs/design-system.md` ist vor UI-Arbeit zu lesen).
- Keine Migration in diesem PR (Schema 0009 ist gemerged); keine Daten löschen — Ausnahme: `vergabe_zeitraum`-Zeilen sind Formular-verwaltete Attribute ohne Status-Spalte, sie werden beim Speichern ersetzt (im PR-Text ausweisen).
- Tests: `pnpm --filter web exec vitest run lib/verfuegbarkeit.test.ts` (einzeln) bzw. `pnpm --filter web test` (alle). Build: `pnpm --filter web build`.
- Commits klein, Deutsch, Präfix `AP1j ②:`.

---

### Task 1: Verfügbarkeits-Modell (Ableitung)

**Files:**
- Create: `apps/web/lib/verfuegbarkeit.ts`
- Test: `apps/web/lib/verfuegbarkeit.test.ts`

**Interfaces:**
- Produces: `VerfuegbarkeitsStatus`, `VergabeDaten`, `VerfuegbarkeitsErgebnis`, `leiteVerfuegbarkeitAb(heute, strom, vergaben)`, `VERFUEGBARKEIT_PILL`, `vergabeLabel(von, bis)` — von Task 3–6 konsumiert.

- [ ] **Step 1: Failing Test schreiben**

```ts
// apps/web/lib/verfuegbarkeit.test.ts
import { describe, expect, it } from "vitest";

import {
  leiteVerfuegbarkeitAb,
  vergabeLabel,
  type VergabeDaten,
} from "./verfuegbarkeit";

const strom = {
  zeitraumVon: "2026-01-01",
  zeitraumBis: "2030-12-31",
  reserviertBhyo: false,
};
const v = (o: Partial<VergabeDaten>): VergabeDaten => ({
  vergebenVon: null,
  vergebenBis: null,
  vergebenAn: null,
  anBhyo: false,
  ...o,
});

describe("leiteVerfuegbarkeitAb", () => {
  it("abgelaufen schlaegt alles (Regel 1)", () => {
    expect(
      leiteVerfuegbarkeitAb("2031-01-01", { ...strom, reserviertBhyo: true }, [
        v({ vergebenVon: "2026-01-01" }),
      ]),
    ).toEqual({ status: "abgelaufen", reserviertZusatz: false });
  });

  it("noch nicht verfuegbar vor Verfuegbarkeitsbeginn (Regel 2)", () => {
    expect(leiteVerfuegbarkeitAb("2025-12-31", strom, []).status).toBe(
      "noch_nicht_verfuegbar",
    );
  });

  it("verfuegbar ohne Vergaben und ohne Reservierung (Regel 5)", () => {
    expect(leiteVerfuegbarkeitAb("2027-06-15", strom, [])).toEqual({
      status: "verfuegbar",
      reserviertZusatz: false,
    });
  });

  it("vergeben (extern) wenn heute im Vergabezeitraum liegt (Regel 3)", () => {
    const erg = leiteVerfuegbarkeitAb("2027-06-15", strom, [
      v({ vergebenVon: "2027-01-01", vergebenBis: "2028-06-30" }),
    ]);
    expect(erg.status).toBe("vergeben_extern");
  });

  it("vergeben (bhyo) wenn an_bhyo gesetzt ist", () => {
    const erg = leiteVerfuegbarkeitAb("2027-06-15", strom, [
      v({ vergebenVon: "2027-01-01", anBhyo: true }),
    ]);
    expect(erg.status).toBe("vergeben_bhyo");
  });

  it("offenes von zaehlt ab Verfuegbarkeitsbeginn", () => {
    const vergaben = [v({ vergebenBis: "2028-06-30" })];
    expect(leiteVerfuegbarkeitAb("2026-01-01", strom, vergaben).status).toBe(
      "vergeben_extern",
    );
    expect(leiteVerfuegbarkeitAb("2028-07-01", strom, vergaben).status).toBe(
      "verfuegbar",
    );
  });

  it("offenes bis heisst unbefristet (bis Verfuegbarkeitsende)", () => {
    const vergaben = [v({ vergebenVon: "2027-01-01" })];
    expect(leiteVerfuegbarkeitAb("2030-12-31", strom, vergaben).status).toBe(
      "vergeben_extern",
    );
  });

  it("reserviert (bhyo) ohne aktive Vergabe (Regel 4)", () => {
    expect(
      leiteVerfuegbarkeitAb(
        "2027-06-15",
        { ...strom, reserviertBhyo: true },
        [],
      ).status,
    ).toBe("reserviert_bhyo");
  });

  it("Randfall: Reservierung + aktive externe Vergabe -> Zusatz-Pille", () => {
    expect(
      leiteVerfuegbarkeitAb("2027-06-15", { ...strom, reserviertBhyo: true }, [
        v({ vergebenVon: "2027-01-01", vergebenBis: "2028-06-30" }),
      ]),
    ).toEqual({ status: "vergeben_extern", reserviertZusatz: true });
  });

  it("nach Vergabe-Ende faellt der Strom auf die Reservierung zurueck", () => {
    expect(
      leiteVerfuegbarkeitAb("2028-07-01", { ...strom, reserviertBhyo: true }, [
        v({ vergebenVon: "2027-01-01", vergebenBis: "2028-06-30" }),
      ]).status,
    ).toBe("reserviert_bhyo");
  });
});

describe("vergabeLabel", () => {
  it("beide Enden gesetzt", () => {
    expect(vergabeLabel("2027-01-01", "2028-06-30")).toBe("01/2027 – 06/2028");
  });
  it("offenes von", () => {
    expect(vergabeLabel(null, "2028-06-30")).toBe("bis 06/2028");
  });
  it("offenes bis", () => {
    expect(vergabeLabel("2027-01-01", null)).toBe("ab 01/2027 (unbefristet)");
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `pnpm --filter web exec vitest run lib/verfuegbarkeit.test.ts`
Expected: FAIL — Modul `./verfuegbarkeit` existiert nicht.

- [ ] **Step 3: Implementieren**

```ts
// apps/web/lib/verfuegbarkeit.ts
import { fmtMonat } from "./format";

/**
 * Verfuegbarkeits-/Vergabe-Modell (AP1j PR 2) — reine Logik ohne Datenbank.
 * Der Status wird NIE gespeichert, immer abgeleitet (Prinzip wie Qualitaet
 * A-D); `heute` ist Parameter, damit die Ableitung deterministisch testbar
 * bleibt. Hierarchie und Konvention offener Enden:
 * docs/ap1j-handoff-verfuegbarkeit-vergabe.md.
 */

export type VerfuegbarkeitsStatus =
  | "abgelaufen"
  | "noch_nicht_verfuegbar"
  | "vergeben_extern"
  | "vergeben_bhyo"
  | "reserviert_bhyo"
  | "verfuegbar";

/** Vergabezeile auf Datenbank-Ebene (ISO-Daten, offene Enden = null). */
export interface VergabeDaten {
  vergebenVon: string | null;
  vergebenBis: string | null;
  vergebenAn: string | null;
  anBhyo: boolean;
}

export interface VerfuegbarkeitsErgebnis {
  status: VerfuegbarkeitsStatus;
  /** Randfall Handoff: Reservierung zusaetzlich zur externen Vergabe zeigen. */
  reserviertZusatz: boolean;
}

/** Pillen-Text (Kleinschreibung mit Schlusspunkt, V2) und spill-Ton — keine Ampel. */
export const VERFUEGBARKEIT_PILL: Record<
  VerfuegbarkeitsStatus,
  { text: string; tone: string }
> = {
  verfuegbar: { text: "verfügbar.", tone: "active" },
  vergeben_bhyo: { text: "vergeben (bhyo).", tone: "running" },
  vergeben_extern: { text: "vergeben (extern).", tone: "inactive" },
  reserviert_bhyo: { text: "reserviert (bhyo).", tone: "quiet" },
  noch_nicht_verfuegbar: { text: "noch nicht verfügbar.", tone: "quiet" },
  abgelaufen: { text: "abgelaufen.", tone: "inactive" },
};

/**
 * Erste zutreffende Regel gewinnt (Handoff-Hierarchie 1-5). Offene Enden
 * werden fuer die Pruefung durch Verfuegbarkeitsbeginn/-ende ersetzt.
 * ISO-Strings vergleichen lexikographisch korrekt — kein Date-Parsing noetig.
 */
export function leiteVerfuegbarkeitAb(
  heute: string,
  strom: { zeitraumVon: string; zeitraumBis: string; reserviertBhyo: boolean },
  vergaben: VergabeDaten[],
): VerfuegbarkeitsErgebnis {
  const kein = { reserviertZusatz: false };
  if (heute > strom.zeitraumBis) return { status: "abgelaufen", ...kein };
  if (heute < strom.zeitraumVon)
    return { status: "noch_nicht_verfuegbar", ...kein };

  const aktiv = vergaben.find(
    (v) =>
      heute >= (v.vergebenVon ?? strom.zeitraumVon) &&
      heute <= (v.vergebenBis ?? strom.zeitraumBis),
  );
  if (aktiv) {
    return {
      status: aktiv.anBhyo ? "vergeben_bhyo" : "vergeben_extern",
      reserviertZusatz: strom.reserviertBhyo && !aktiv.anBhyo,
    };
  }
  if (strom.reserviertBhyo) return { status: "reserviert_bhyo", ...kein };
  return { status: "verfuegbar", ...kein };
}

/** Anzeige eines Vergabezeitraums; offene Enden nach Handoff-Konvention. */
export function vergabeLabel(von: string | null, bis: string | null): string {
  if (von && bis) return `${fmtMonat(von)} – ${fmtMonat(bis)}`;
  if (bis) return `bis ${fmtMonat(bis)}`;
  return `ab ${fmtMonat(von)} (unbefristet)`;
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `pnpm --filter web exec vitest run lib/verfuegbarkeit.test.ts`
Expected: PASS (alle its).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/verfuegbarkeit.ts apps/web/lib/verfuegbarkeit.test.ts
git commit -m "AP1j ②: Verfügbarkeits-Modell — abgeleiteter Status nach Handoff-Hierarchie"
```

---

### Task 2: Formular-Validierung und Persistenz-Mapping (pure)

**Files:**
- Modify: `apps/web/lib/verfuegbarkeit.ts` (anhängen)
- Test: `apps/web/lib/verfuegbarkeit.test.ts` (anhängen)

**Interfaces:**
- Consumes: `FeldFehler` aus `./formular-modell`, `monatZuVon`/`monatZuBis` aus `./formular-modell`, `datumZuMonat` aus `./formular-modell`.
- Produces: `VergabeFormZeile`, `istLeereVergabe(z)`, `validiereVergaben(vonMonat, bisMonat, zeilen)`, `vergabenZuWerten(zeilen)`, `vergabenZuFormZeilen(daten)` — von Task 3 (Loader), Task 4 (Action) und Task 5 (Panel) konsumiert. Fehler-Keys: `vergabe_${i}_von` / `vergabe_${i}_bis` (i = Index im übergebenen Array).

- [ ] **Step 1: Failing Tests anhängen**

```ts
// anhaengen an apps/web/lib/verfuegbarkeit.test.ts
import {
  istLeereVergabe,
  validiereVergaben,
  vergabenZuFormZeilen,
  vergabenZuWerten,
  type VergabeFormZeile,
} from "./verfuegbarkeit";

const z = (o: Partial<VergabeFormZeile>): VergabeFormZeile => ({
  vonMonat: "",
  bisMonat: "",
  an: "",
  anBhyo: false,
  ...o,
});

describe("validiereVergaben", () => {
  it("leer und Leerzeilen sind gueltig", () => {
    expect(validiereVergaben("2026-01", "2030-12", [])).toEqual({});
    expect(validiereVergaben("2026-01", "2030-12", [z({})])).toEqual({});
  });

  it("bis vor von", () => {
    const f = validiereVergaben("2026-01", "2030-12", [
      z({ vonMonat: "2028-01", bisMonat: "2027-01" }),
    ]);
    expect(f.vergabe_0_bis).toBe("Bis liegt vor Ab");
  });

  it("ausserhalb des Verfuegbarkeitszeitraums", () => {
    const f = validiereVergaben("2026-01", "2030-12", [
      z({ vonMonat: "2025-06" }),
      z({ vonMonat: "2031-01", bisMonat: "2031-06" }),
    ]);
    expect(f.vergabe_0_von).toBe("Liegt vor dem Verfügbarkeitsbeginn");
    expect(f.vergabe_1_von).toBe("Liegt nach dem Verfügbarkeitsende");
    expect(f.vergabe_1_bis).toBe("Liegt nach dem Verfügbarkeitsende");
  });

  it("Ueberlappung zweier Zeitraeume", () => {
    const f = validiereVergaben("2026-01", "2030-12", [
      z({ vonMonat: "2026-01", bisMonat: "2027-06" }),
      z({ vonMonat: "2027-06", bisMonat: "2028-01" }),
    ]);
    expect(f.vergabe_1_von).toBe(
      "Überschneidet sich mit einem anderen Vergabezeitraum",
    );
  });

  it("zwei offene Enden in dieselbe Richtung ueberlappen nach Normalisierung", () => {
    const f = validiereVergaben("2026-01", "2030-12", [
      z({ bisMonat: "2027-06" }),
      z({ bisMonat: "2028-06" }),
    ]);
    expect(f.vergabe_1_von).toBe(
      "Überschneidet sich mit einem anderen Vergabezeitraum",
    );
  });

  it("ueberlappungsfreie Zeitraeume inkl. offener Enden sind gueltig", () => {
    expect(
      validiereVergaben("2026-01", "2030-12", [
        z({ bisMonat: "2027-06" }),
        z({ vonMonat: "2027-07" }),
      ]),
    ).toEqual({});
  });
});

describe("vergabenZuWerten", () => {
  it("laesst Leerzeilen weg und normalisiert Monat -> Datum", () => {
    expect(
      vergabenZuWerten([
        z({}),
        z({ vonMonat: "2027-01", bisMonat: "2028-06", an: "  Stadtwerke  " }),
        z({ bisMonat: "2028-06", anBhyo: true }),
      ]),
    ).toEqual([
      {
        vergebenVon: "2027-01-01",
        vergebenBis: "2028-06-30",
        vergebenAn: "Stadtwerke",
        anBhyo: false,
      },
      { vergebenVon: null, vergebenBis: "2028-06-30", vergebenAn: null, anBhyo: true },
    ]);
  });
});

describe("vergabenZuFormZeilen", () => {
  it("Datum -> Monat, null -> leer", () => {
    expect(
      vergabenZuFormZeilen([
        { vergebenVon: "2027-01-01", vergebenBis: null, vergebenAn: "X", anBhyo: true },
      ]),
    ).toEqual([{ vonMonat: "2027-01", bisMonat: "", an: "X", anBhyo: true }]);
  });
});

describe("istLeereVergabe", () => {
  it("beide Monate leer = Leerzeile, auch mit Text", () => {
    expect(istLeereVergabe(z({ an: "jemand" }))).toBe(true);
    expect(istLeereVergabe(z({ vonMonat: "2027-01" }))).toBe(false);
  });
});
```

- [ ] **Step 2: Fehlschlag verifizieren**

Run: `pnpm --filter web exec vitest run lib/verfuegbarkeit.test.ts`
Expected: FAIL — `validiereVergaben` u. a. nicht exportiert.

- [ ] **Step 3: Implementieren (an verfuegbarkeit.ts anhängen)**

```ts
import {
  datumZuMonat,
  monatZuBis,
  monatZuVon,
  type FeldFehler,
} from "./formular-modell";

// --- Formular-Ebene (Monats-Strings, "" = offenes Ende) ----------------------

export interface VergabeFormZeile {
  vonMonat: string;
  bisMonat: string;
  an: string;
  anBhyo: boolean;
}

/** Beide Daten leer = keine Vergabe (Handoff) — wird nie gespeichert. */
export function istLeereVergabe(zeile: VergabeFormZeile): boolean {
  return !zeile.vonMonat && !zeile.bisMonat;
}

/**
 * Die vier Handoff-Regeln; Keys passen zur Inline-Anzeige im Panel
 * (vergabe_<index>_von / _bis, Index = Position im uebergebenen Array,
 * Leerzeilen behalten ihren Index). Fuer die Ueberlappungspruefung werden
 * offene Enden durch Verfuegbarkeitsbeginn/-ende ersetzt; damit ist auch
 * "hoechstens ein offenes Ende je Richtung" abgedeckt — zwei offene Anfaenge
 * ueberlappen nach Normalisierung immer.
 */
export function validiereVergaben(
  vonMonat: string,
  bisMonat: string,
  zeilen: VergabeFormZeile[],
): FeldFehler {
  const f: FeldFehler = {};
  const belegt = zeilen
    .map((zeile, i) => ({ zeile, i }))
    .filter(({ zeile }) => !istLeereVergabe(zeile));

  for (const { zeile, i } of belegt) {
    if (zeile.vonMonat && zeile.bisMonat && zeile.bisMonat < zeile.vonMonat)
      f[`vergabe_${i}_bis`] = "Bis liegt vor Ab";
    if (vonMonat && zeile.vonMonat && zeile.vonMonat < vonMonat)
      f[`vergabe_${i}_von`] = "Liegt vor dem Verfügbarkeitsbeginn";
    if (bisMonat) {
      if (zeile.vonMonat && zeile.vonMonat > bisMonat)
        f[`vergabe_${i}_von`] = "Liegt nach dem Verfügbarkeitsende";
      if (zeile.bisMonat && zeile.bisMonat > bisMonat)
        f[`vergabe_${i}_bis`] = "Liegt nach dem Verfügbarkeitsende";
    }
  }

  const normalisiert = belegt
    .map(({ zeile, i }) => ({
      i,
      von: zeile.vonMonat || vonMonat,
      bis: zeile.bisMonat || bisMonat,
    }))
    .sort((a, b) => (a.von < b.von ? -1 : a.von > b.von ? 1 : a.i - b.i));
  for (let k = 1; k < normalisiert.length; k++) {
    if (normalisiert[k]!.von <= normalisiert[k - 1]!.bis)
      f[`vergabe_${normalisiert[k]!.i}_von`] =
        "Überschneidet sich mit einem anderen Vergabezeitraum";
  }
  return f;
}

/** Formular -> Persistenz: Leerzeilen weg, Monat -> Datum, leere Enden -> null. */
export function vergabenZuWerten(zeilen: VergabeFormZeile[]): VergabeDaten[] {
  return zeilen.filter((zeile) => !istLeereVergabe(zeile)).map((zeile) => ({
    vergebenVon: zeile.vonMonat ? monatZuVon(zeile.vonMonat) : null,
    vergebenBis: zeile.bisMonat ? monatZuBis(zeile.bisMonat) : null,
    vergebenAn: zeile.an.trim() || null,
    anBhyo: zeile.anBhyo,
  }));
}

/** Persistenz -> Formular (Edit-Prefill). */
export function vergabenZuFormZeilen(daten: VergabeDaten[]): VergabeFormZeile[] {
  return daten.map((d) => ({
    vonMonat: datumZuMonat(d.vergebenVon),
    bisMonat: datumZuMonat(d.vergebenBis),
    an: d.vergebenAn ?? "",
    anBhyo: d.anBhyo,
  }));
}
```

- [ ] **Step 4: Erfolg verifizieren**

Run: `pnpm --filter web exec vitest run lib/verfuegbarkeit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/verfuegbarkeit.ts apps/web/lib/verfuegbarkeit.test.ts
git commit -m "AP1j ②: Vergabe-Validierung und Formular-Mapping (pure, getestet)"
```

---

### Task 3: Loader und Typen erweitern

**Files:**
- Modify: `apps/web/lib/formular-modell.ts` (FormularWerte, FormularZeile, formularZeileZuWerte)
- Modify: `apps/web/lib/stroeme-modell.ts` (Strom um `reserviertBhyo`)
- Modify: `apps/web/lib/stroeme.ts` (`ladeFormularWerte`, `ladeStroeme`, neuer `ladeVergaben`)
- Test: bestehende Suites (`pnpm --filter web test`) + `pnpm --filter web build` als Typprüfung

**Interfaces:**
- Consumes: `vergabenZuFormZeilen`, `VergabeDaten`, `VergabeFormZeile` aus `@/lib/verfuegbarkeit`; `vergabeZeitraum` aus `@bhyo/db/schema`.
- Produces:
  - `FormularWerte` + `{ reserviertBhyo: boolean; vergaben: VergabeFormZeile[] }`
  - `FormularZeile` + `{ reserviertBhyo: boolean }`
  - `formularZeileZuWerte(art, r, vergaben: VergabeDaten[] = [])` (dritter Parameter, Default `[]`)
  - `Strom` + `{ reserviertBhyo: boolean }`
  - `ladeVergaben(art: StromArt, id: string): Promise<VergabeDaten[]>` in `stroeme.ts` — sortiert nach normalisiertem Beginn (`vergeben_von NULLS FIRST, vergeben_bis`)

- [ ] **Step 1: formular-modell.ts erweitern**

In `FormularWerte` vor `beleg` ergänzen:

```ts
  reserviertBhyo: boolean;
  vergaben: VergabeFormZeile[];
```

In `FormularZeile` nach `status` ergänzen: `reserviertBhyo: boolean;`

`formularZeileZuWerte` erhält den dritten Parameter und mappt:

```ts
import { vergabenZuFormZeilen, type VergabeDaten, type VergabeFormZeile } from "./verfuegbarkeit";

export function formularZeileZuWerte(
  art: StromArt,
  r: FormularZeile,
  vergaben: VergabeDaten[] = [],
): FormularWerte {
  return {
    // ... bestehende Felder unverändert ...
    reserviertBhyo: r.reserviertBhyo,
    vergaben: vergabenZuFormZeilen(vergaben),
    status: r.status,
    beleg: belegAusZeile(r),
  };
}
```

Achtung Import-Zyklus: `verfuegbarkeit.ts` importiert bereits aus `formular-modell.ts` (Task 2). Der Rück-Import hier ist nur ein Typ/Funktions-Import ohne Zyklusgefahr zur Laufzeit? Nein — es wäre ein echter Zyklus. **Deshalb:** `vergabenZuFormZeilen`-Aufruf NICHT in formular-modell.ts, sondern in `stroeme.ts` (Loader) durchführen; `formularZeileZuWerte` bekommt stattdessen bereits fertige `vergaben: VergabeFormZeile[] = []` und reicht sie durch:

```ts
// formular-modell.ts — nur Typ-Import, Typen erzeugen keinen Laufzeit-Zyklus:
import type { VergabeFormZeile } from "./verfuegbarkeit";

export function formularZeileZuWerte(
  art: StromArt,
  r: FormularZeile,
  vergaben: VergabeFormZeile[] = [],
): FormularWerte {
  return {
    // ... bestehende Felder unverändert ...
    reserviertBhyo: r.reserviertBhyo,
    vergaben,
    // ...
  };
}
```

- [ ] **Step 2: stroeme-modell.ts** — in `interface Strom` unter „gemeinsam" ergänzen: `reserviertBhyo: boolean;`

- [ ] **Step 3: stroeme.ts erweitern**

In beiden Select-Zweigen von `ladeFormularWerte` und `ladeStroeme` die Spalte aufnehmen (`reserviertBhyo: biomassestrom.reserviertBhyo` bzw. `outputBedarf.reserviertBhyo`; in `ladeStroeme` zusätzlich ins gemappte `Strom`-Objekt). Neuer Loader (Imports: `vergabeZeitraum` aus `@bhyo/db/schema`, `asc`, `sql` nach Bestand; `VergabeDaten`, `vergabenZuFormZeilen` aus `./verfuegbarkeit`):

```ts
/** Vergabezeitraeume eines Stroms, sortiert nach normalisiertem Beginn (AP1j). */
export function ladeVergaben(art: StromArt, id: string): Promise<VergabeDaten[]> {
  return withDb(async (db) => {
    const spalte =
      art === "biomasse"
        ? vergabeZeitraum.biomassestromId
        : vergabeZeitraum.outputBedarfId;
    const rows = await db
      .select({
        vergebenVon: vergabeZeitraum.vergebenVon,
        vergebenBis: vergabeZeitraum.vergebenBis,
        vergebenAn: vergabeZeitraum.vergebenAn,
        anBhyo: vergabeZeitraum.anBhyo,
      })
      .from(vergabeZeitraum)
      .where(eq(spalte, id))
      .orderBy(sql`${vergabeZeitraum.vergebenVon} NULLS FIRST`, vergabeZeitraum.vergebenBis);
    return rows;
  });
}
```

`ladeFormularWerte` lädt zusätzlich die Vergaben und übergibt sie:

```ts
const vergaben = await ladeVergaben(art, id);
return row ? formularZeileZuWerte(art, row, vergabenZuFormZeilen(vergaben)) : null;
```

(Beide bestehenden Zweige — biomasse und output — gleich behandeln; die Vergaben-Query erst NACH dem Row-Fetch bzw. parallel via `Promise.all`, aber nur wenn row existiert ist unnötige Komplexität — einfach sequenziell laden.)

- [ ] **Step 4: Verifizieren**

Run: `pnpm --filter web test && pnpm --filter web build`
Expected: bestehende Tests PASS; Build grün (alle `formularZeileZuWerte`-Aufrufer prüfen — Default-Parameter hält bestehende Aufrufe gültig; `Strom`-Konstruktion in `ladeStroeme` muss `reserviertBhyo` liefern, sonst Typfehler).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/formular-modell.ts apps/web/lib/stroeme-modell.ts apps/web/lib/stroeme.ts
git commit -m "AP1j ②: Loader — Vergaben und reserviert_bhyo in Formularwerte und Strom"
```

---

### Task 4: Server-Action — Vergaben validieren und speichern

**Files:**
- Modify: `apps/web/lib/formular-actions.ts`

**Interfaces:**
- Consumes: `validiereVergaben`, `vergabenZuWerten`, `type VergabeFormZeile` aus `@/lib/verfuegbarkeit`; `vergabeZeitraum` aus `@bhyo/db/schema`.
- Produces: FormData-Vertrag mit dem Panel (Task 5): pro Zeile `vergabe_${i}_marker` (immer "1"), `vergabe_${i}_von`, `vergabe_${i}_bis` (Monats-Strings), `vergabe_${i}_an` (Text), `vergabe_${i}_bhyo` (Checkbox, "on"); Checkbox `reserviert_bhyo` ("on"). Fehler-Keys `vergabe_${i}_von`/`_bis` in `SpeichernErgebnis.feldFehler`.

- [ ] **Step 1: Parsen + Validieren einbauen**

Nach `const eingaben = eingabenAus(formData);`:

```ts
const vergaben: VergabeFormZeile[] = [];
for (let i = 0; formData.get(`vergabe_${i}_marker`) != null; i++) {
  vergaben.push({
    vonMonat: s(text(formData, `vergabe_${i}_von`)),
    bisMonat: s(text(formData, `vergabe_${i}_bis`)),
    an: s(text(formData, `vergabe_${i}_an`)),
    anBhyo: formData.get(`vergabe_${i}_bhyo`) === "on",
  });
}
const reserviertBhyo = formData.get("reserviert_bhyo") === "on";

const feldFehler = {
  ...validiereFormular(art, eingaben),
  ...validiereVergaben(eingaben.vonMonat, eingaben.bisMonat, vergaben),
};
```

`reserviertBhyo` in `gemeinsam` aufnehmen (beide Tabellen haben die Spalte):

```ts
const gemeinsam = {
  // ... bestehende Felder ...
  reserviertBhyo,
};
```

- [ ] **Step 2: Persistieren in der Transaktion**

Hilfsfunktion oberhalb von `stromSpeichern` (nicht exportiert — die Datei ist "use server", Exporte müssen async Server-Actions sein; deshalb als lokale Funktion INNERHALB von `stromSpeichern` definieren oder inline):

```ts
// Vergabezeilen sind Formular-verwaltete Attribute ohne eigenen Status:
// je Speichern vollstaendig ersetzen (Nachvollziehbarkeit liegt in der
// Aenderungshistorie ueber die Begruendungspflicht).
const vergabenSpeichern = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0], // Typ des tx-Parameters wie bei den bestehenden Hilfsfunktionen; praktisch: inline lassen, dann erübrigt sich der Typ
  stromId: string,
) => {
  const elternSpalte =
    art === "biomasse"
      ? vergabeZeitraum.biomassestromId
      : vergabeZeitraum.outputBedarfId;
  await tx.delete(vergabeZeitraum).where(eq(elternSpalte, stromId));
  const werte = vergabenZuWerten(vergaben);
  if (werte.length)
    await tx.insert(vergabeZeitraum).values(
      werte.map((v) => ({
        ...v,
        biomassestromId: art === "biomasse" ? stromId : null,
        outputBedarfId: art === "biomasse" ? null : stromId,
      })),
    );
};
```

Praktisch am einfachsten: den Block direkt inline in beide Pfade setzen — im Anlege-Pfad nach `logAenderung(tx, entitaetTyp, row!.id, ...)` mit `row!.id`, im Bearbeiten-Pfad nach dem `tx.update(...)` mit `id`. Wenn inline dupliziert wird, in beiden Pfaden identisch halten.

- [ ] **Step 3: Verifizieren**

Run: `pnpm --filter web test && pnpm --filter web build`
Expected: PASS / Build grün. (Der Action-Pfad selbst hat keinen Unit-Test — die Logik steckt in den in Task 2 getesteten pure Functions; der Durchstich wird in Task 7 im Browser verifiziert.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/formular-actions.ts
git commit -m "AP1j ②: stromSpeichern — Vergaben validieren, ersetzen, reserviert_bhyo setzen"
```

---

### Task 5: FormularPanel — Sektion „vergabe." mit Zeilen-Liste und Live-Pille

**Files:**
- Modify: `apps/web/components/stroeme/FormularPanel.tsx`
- Modify: `apps/web/app/globals.css` (Zeilen-Layout)

**Interfaces:**
- Consumes: FormData-Vertrag aus Task 4; `FormularWerte.vergaben`/`.reserviertBhyo` aus Task 3; `leiteVerfuegbarkeitAb`, `vergabenZuWerten`, `VERFUEGBARKEIT_PILL`, `type VergabeFormZeile` aus `@/lib/verfuegbarkeit`; `monatZuVon`, `monatZuBis` aus `@/lib/formular-modell`.
- Produces: nichts für spätere Tasks.

**Vorher lesen:** `docs/design-system.md` (verbindlich) und die bestehenden Sektionen des Panels — neue UI folgt exakt den vorhandenen Mustern (`ov-sec`, `pf`, `fp-zeile`, `fp-toggle`, `qual-box`, `btn btn--sm`, `icon-btn`, Phosphor-Icons).

- [ ] **Step 1: State und Sektion einbauen**

Neue States neben den bestehenden (Zeitraum-Inputs werden dafür kontrolliert, damit die Live-Pille auf sie reagiert):

```tsx
const [vonMonat, setVonMonat] = useState(werte?.vonMonat ?? "");
const [bisMonat, setBisMonat] = useState(werte?.bisMonat ?? "");
const [reserviert, setReserviert] = useState(werte?.reserviertBhyo ?? false);
const [vergaben, setVergaben] = useState<VergabeFormZeile[]>(
  () => werte?.vergaben ?? [],
);
```

Die beiden `zeitraum_von`/`zeitraum_bis`-Inputs von `defaultValue` auf `value={vonMonat} onChange={(e) => setVonMonat(e.target.value)}` (bzw. bis) umstellen — Namen und übriges Markup unverändert.

Zeilen-Helfer im Komponentenrumpf:

```tsx
const setzeVergabe = (i: number, patch: Partial<VergabeFormZeile>) =>
  setVergaben((v) => v.map((zeile, j) => (j === i ? { ...zeile, ...patch } : zeile)));
const entferneVergabe = (i: number) =>
  setVergaben((v) => v.filter((_, j) => j !== i));

// Live-Ableitung wie die Qualitaets-Box: reine Anzeige, heute vom Client.
const heute = new Date().toISOString().slice(0, 10);
const verfuegbarkeit =
  vonMonat && bisMonat
    ? leiteVerfuegbarkeitAb(
        heute,
        {
          zeitraumVon: monatZuVon(vonMonat),
          zeitraumBis: monatZuBis(bisMonat),
          reserviertBhyo: reserviert,
        },
        vergabenZuWerten(vergaben),
      )
    : null;
```

Neue Sektion direkt NACH der Sektion „materialart & zeitraum." / „output & zeitraum." und VOR „mengen.":

```tsx
<section className="ov-sec">
  <h3>vergabe.</h3>
  {vergaben.map((zeile, i) => (
    <div key={i} className="fp-vergabe">
      <input type="hidden" name={`vergabe_${i}_marker`} value="1" />
      <div className="fp-vergabe-zeile">
        <label className="pf">
          <span>Vergeben ab</span>
          <span className="pf-feld">
            <input
              type="month"
              name={`vergabe_${i}_von`}
              value={zeile.vonMonat}
              onChange={(e) => setzeVergabe(i, { vonMonat: e.target.value })}
              aria-invalid={f[`vergabe_${i}_von`] ? true : undefined}
            />
          </span>
        </label>
        <label className="pf">
          <span>Vergeben bis</span>
          <span className="pf-feld">
            <input
              type="month"
              name={`vergabe_${i}_bis`}
              value={zeile.bisMonat}
              onChange={(e) => setzeVergabe(i, { bisMonat: e.target.value })}
              aria-invalid={f[`vergabe_${i}_bis`] ? true : undefined}
            />
          </span>
        </label>
        <label className="pf">
          <span>Vergeben an</span>
          <span className="pf-feld">
            <input
              type="text"
              name={`vergabe_${i}_an`}
              value={zeile.an}
              onChange={(e) => setzeVergabe(i, { an: e.target.value })}
              placeholder="z. B. Stadtwerke"
            />
          </span>
        </label>
        <label className="fp-toggle fp-vergabe-bhyo">
          <input
            type="checkbox"
            name={`vergabe_${i}_bhyo`}
            checked={zeile.anBhyo}
            onChange={(e) => setzeVergabe(i, { anBhyo: e.target.checked })}
          />
          <span className="fp-toggle-text">
            <span>an bhyo</span>
          </span>
        </label>
        <button
          type="button"
          className="icon-btn"
          aria-label="Vergabezeitraum entfernen"
          onClick={() => entferneVergabe(i)}
        >
          <i className="ph ph-x" aria-hidden />
        </button>
      </div>
      {(f[`vergabe_${i}_von`] || f[`vergabe_${i}_bis`]) && (
        <span className="pf-fehler">
          {f[`vergabe_${i}_von`] ?? f[`vergabe_${i}_bis`]}
        </span>
      )}
    </div>
  ))}
  <button
    type="button"
    className="btn btn--sm"
    onClick={() =>
      setVergaben((v) => [...v, { vonMonat: "", bisMonat: "", an: "", anBhyo: false }])
    }
  >
    <i className="ph ph-plus" aria-hidden />
    Vergabezeitraum
  </button>
  <p className="fp-hinweis">
    Leer gelassene Enden gelten ab Verfügbarkeitsbeginn bzw. unbefristet;
    eine Zeile ganz ohne Datum wird nicht gespeichert.
  </p>

  <label className="fp-toggle">
    <input
      type="checkbox"
      name="reserviert_bhyo"
      checked={reserviert}
      onChange={(e) => setReserviert(e.target.checked)}
    />
    <span className="fp-toggle-text">
      <span>Für bhyo reserviert</span>
      <span className="c">
        Weiche Markierung ohne Zeitraum – unabhängig von den Vergabezeiträumen.
      </span>
    </span>
  </label>

  <div className="qual-box">
    <span className="qual-label">Verfügbarkeit (abgeleitet)</span>
    <span className="qual-pillen">
      {verfuegbarkeit ? (
        <>
          <span className={`spill spill--${VERFUEGBARKEIT_PILL[verfuegbarkeit.status].tone}`}>
            {VERFUEGBARKEIT_PILL[verfuegbarkeit.status].text}
          </span>
          {verfuegbarkeit.reserviertZusatz && (
            <span className="pill">reserviert (bhyo).</span>
          )}
        </>
      ) : (
        <span className="konf konf--leer">–</span>
      )}
    </span>
    <span className="c">
      Aus Zeitraum, Vergaben und Reservierung berechnet, nicht editierbar.
    </span>
  </div>
</section>
```

- [ ] **Step 2: CSS ergänzen (globals.css, bei den fp-Klassen)**

```css
/* AP1j: Vergabezeile — vier Felder + Entfernen, bricht schmal um. */
.fp-vergabe {
  display: grid;
  gap: 4px;
}
.fp-vergabe-zeile {
  display: grid;
  grid-template-columns: 1fr 1fr 1.3fr auto auto;
  gap: 10px;
  align-items: end;
}
.fp-vergabe-bhyo {
  align-self: end;
  padding-bottom: 6px;
}
@media (max-width: 720px) {
  .fp-vergabe-zeile {
    grid-template-columns: 1fr 1fr;
  }
}
```

(Exakte Gap-/Breakpoint-Werte an die umgebenden `.fp-zeile`-Regeln angleichen — vor dem Einfügen die bestehenden Werte in globals.css nachschlagen und übernehmen.)

- [ ] **Step 3: Verifizieren**

Run: `pnpm --filter web build`
Expected: Build grün. Danach `pnpm --filter web dev` starten und im Browser (http://localhost:3000/register) prüfen: Sektion erscheint, „+ Vergabezeitraum" fügt Zeilen hinzu, Entfernen-X entfernt, Live-Pille reagiert auf Zeitraum/Checkbox (Screenshot machen).

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/stroeme/FormularPanel.tsx apps/web/app/globals.css
git commit -m "AP1j ②: FormularPanel — Sektion vergabe. mit Zeitraum-Liste, Reservierung, Live-Pille"
```

---

### Task 6: Detail — Verfügbarkeits-Pille und Vergabe-Sektion

**Files:**
- Modify: `apps/web/components/stroeme/Pillen.tsx` (VerfuegbarkeitsPill)
- Modify: `apps/web/components/stroeme/Detail.tsx` (optionale Props, Pille, Sektion)
- Modify: `apps/web/app/register/RegisterInhalt.tsx` (Laden + Ableiten + Durchreichen)

**Interfaces:**
- Consumes: `ladeVergaben` (Task 3), `leiteVerfuegbarkeitAb`, `vergabeLabel`, `VERFUEGBARKEIT_PILL`, Typen (Task 1/2).
- Produces: `Detail`-Props `verfuegbarkeit?: VerfuegbarkeitsErgebnis | null` und `vergaben?: VergabeDaten[]` — optional, damit `KarteAnsicht.tsx` und `AuswertungAnsicht.tsx` unverändert bauen (deren Tag kommt in PR ③/④).

- [ ] **Step 1: Pillen.tsx**

```tsx
import { VERFUEGBARKEIT_PILL, type VerfuegbarkeitsErgebnis } from "@/lib/verfuegbarkeit";

/** Verfuegbarkeits-Pille (AP1j): abgeleiteter Status + optionale Zusatz-Reservierung. */
export function VerfuegbarkeitsPill({ ergebnis }: { ergebnis: VerfuegbarkeitsErgebnis }) {
  const p = VERFUEGBARKEIT_PILL[ergebnis.status];
  return (
    <>
      <span className={`spill spill--${p.tone}`}>{p.text}</span>
      {ergebnis.reserviertZusatz && <span className="pill">reserviert (bhyo).</span>}
    </>
  );
}
```

- [ ] **Step 2: Detail.tsx**

Props ergänzen (beide optional):

```tsx
verfuegbarkeit?: VerfuegbarkeitsErgebnis | null;
vergaben?: VergabeDaten[];
```

Im Kopf in `div.ov-pillen` direkt nach der Status-Pille (`</span>` des `pop-anchor`):

```tsx
{verfuegbarkeit && <VerfuegbarkeitsPill ergebnis={verfuegbarkeit} />}
```

Neue Sektion nach „materialart & zeitraum." (nur rendern, wenn `verfuegbarkeit` gesetzt ist — sonst karte./auswertung. unverändert):

```tsx
{verfuegbarkeit && (
  <section className="ov-sec">
    <h3>vergabe.</h3>
    {(vergaben ?? []).length ? (
      <div className="kv">
        {(vergaben ?? []).map((vz, i) => (
          <Kv
            key={i}
            label={vz.anBhyo ? "an bhyo" : (vz.vergebenAn ?? "extern")}
            wert={vergabeLabel(vz.vergebenVon, vz.vergebenBis)}
          />
        ))}
      </div>
    ) : (
      <p className="ov-note">Keine Vergabezeiträume erfasst.</p>
    )}
    {s.reserviertBhyo && (
      <p className="ov-note">Für bhyo reserviert (ohne Zeitraum).</p>
    )}
  </section>
)}
```

Imports entsprechend (`VerfuegbarkeitsPill` aus Pillen, `vergabeLabel`, Typen aus `@/lib/verfuegbarkeit`).

- [ ] **Step 3: RegisterInhalt.tsx**

Nach dem Laden von `detailStrom`/`historie`:

```tsx
const vergaben = detailStrom ? await ladeVergaben(art, detailStrom.id) : [];
// Serverseitig EIN heute je Request — deterministische Anzeige.
const heute = new Date().toISOString().slice(0, 10);
const verfuegbarkeit =
  detailStrom?.zeitraumVon && detailStrom.zeitraumBis
    ? leiteVerfuegbarkeitAb(
        heute,
        {
          zeitraumVon: detailStrom.zeitraumVon,
          zeitraumBis: detailStrom.zeitraumBis,
          reserviertBhyo: detailStrom.reserviertBhyo,
        },
        vergaben,
      )
    : null;
```

Und an `<Detail ... verfuegbarkeit={verfuegbarkeit} vergaben={vergaben} />` durchreichen. Imports ergänzen (`ladeVergaben` aus `@/lib/stroeme`, `leiteVerfuegbarkeitAb` aus `@/lib/verfuegbarkeit`).

- [ ] **Step 4: Verifizieren**

Run: `pnpm --filter web test && pnpm --filter web build`
Expected: PASS/grün (auch KarteAnsicht/AuswertungAnsicht bauen ohne Änderung, weil die Props optional sind). Im Dev-Server: Strom mit Vergabe anlegen, Detail öffnen — Pille und Sektion sichtbar, Randfall Reservierung+extern zeigt Zusatz-Pille.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/stroeme/Pillen.tsx apps/web/components/stroeme/Detail.tsx apps/web/app/register/RegisterInhalt.tsx
git commit -m "AP1j ②: Detail — Verfügbarkeits-Pille und Sektion vergabe. (Register-Kontext)"
```

---

### Task 7: design-system.md, End-to-End-Prüfung im Browser, PR

**Files:**
- Modify: `docs/design-system.md` (Abschnitt Status-/Verfügbarkeits-Pillen)

- [ ] **Step 1: design-system.md ergänzen** — beim bestehenden Pillen-Abschnitt einen kurzen Unterabschnitt „Verfügbarkeits-Pillen (AP1j)" mit der Ton-Zuordnung aus `VERFUEGBARKEIT_PILL` (verfügbar → active/Lime, vergeben (bhyo) → running/Waldgrün, vergeben (extern) & abgelaufen → inactive, reserviert (bhyo) & noch nicht verfügbar → quiet; Zusatz-Reservierung als neutrale kleine `pill`). Hinweis: Status wird abgeleitet, nie gespeichert. Die zwei auswertung.-Switches kommen erst mit PR ④ in die Doku.

- [ ] **Step 2: Gesamtprüfung lokal**

Run: `pnpm --filter web test && pnpm --filter web build`
Expected: alles grün.

- [ ] **Step 3: Durchstich im Dev-Server** (`pnpm --filter web dev`, Browser):
  1. Feedstock bearbeiten → Vergabezeitraum 01/2027–06/2028 extern + Reservierung setzen → Speichern → Detail zeigt „vergeben (extern)." erst ab 2027 (heute 2026: „reserviert (bhyo)."), Sektion listet den Zeitraum.
  2. Überlappende Zeiträume eingeben → Inline-Fehler an der zweiten Zeile, kein Speichern.
  3. Zeile ganz ohne Datum → wird beim Speichern verworfen (Detail zeigt sie nicht).
  4. Screenshots Light/Dark für `docs/design/v2/pruef/` nach Bestandsmuster (Dateinamen `pr2-vergabe-*.jpg`) — optional, wie in PR 7 gehandhabt.

- [ ] **Step 4: Commit + Push + PR**

```bash
git add docs/design-system.md
git commit -m "AP1j ②: design-system.md — Verfügbarkeits-Pillen"
git push -u origin ap1j-vergabe-formular
gh pr create --title "AP1j PR2: Formular/Detail — Vergabezeitraum-Liste, Validierung, Verfügbarkeits-Pille" --body "…(Inhalt, Verweis auf docs/ap1j-handoff-verfuegbarkeit-vergabe.md, Hinweis: vergabe_zeitraum-Zeilen werden beim Speichern ersetzt — Formular-verwaltete Attribute, Historie über Begründungspflicht)…"
```

Expected: PR offen, Preview-Deploy grün; danach Preview im Browser gegen `/api/health`-Commit verifizieren (geteilte Preview-Umgebung!).

---

## Self-Review (durchgeführt)

- **Spec-Abdeckung:** Datenmodell ✓ (PR ①, gemerged) · Status-Hierarchie 1–5 inkl. Randfall ✓ Task 1 · Konvention offener Enden ✓ Task 1/2 · Validierung (4 Regeln) ✓ Task 2 (offene-Enden-Regel via Normalisierung) · Formular-Liste mit „+" ✓ Task 5 · reserviert_bhyo ✓ Task 4/5 · Status-Pille Formular/Detail ✓ Task 5/6 · Leerzeilen nicht speichern ✓ Task 2/4. Bewusst NICHT in PR ②: Tags/Filter in ströme./karte. (PR ③), auswertung.-Rechnung/Switches (PR ④), Verifikations-Kopplung (PR ⑤), CSV-Export (mit PR ③/④, dort werden Spalten sichtbar).
- **Platzhalter:** keine; alle Code-Blöcke vollständig.
- **Typkonsistenz:** `VergabeDaten` (ISO-Daten) vs. `VergabeFormZeile` (Monats-Strings) konsequent getrennt; Konvertierung nur über `vergabenZuWerten`/`vergabenZuFormZeilen`; Fehler-Keys `vergabe_${i}_von|bis` identisch in Task 2/4/5.
