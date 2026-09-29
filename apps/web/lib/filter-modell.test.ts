/**
 * E32: die beiden dauerhaften Prüfungen des Filtermodells.
 *
 * **Vollständigkeit** ist der Test, der den `landkreis`-Fall gefunden hätte:
 * Der Filter war für Outputs eingeführt, `FACETTEN.biomasse` kannte ihn
 * nicht, und `filterStroeme` iterierte über `FACETTEN[s.art]` — ein
 * `landkreis=…` in der Adresszeile filterte Feedstock-Ströme also nie.
 * Lautlos: kein Fehler, keine leere Liste, nur ein Filter, der nichts tat.
 *
 * **Einzigkeit** hält den Zustand fest, der das möglich gemacht hat: drei
 * Facettenlisten nebeneinander und `BEREICH_KEYS` dreimal mit zwei
 * verschiedenen Inhalten.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  altwertZuNeu,
  ANSICHTEN,
  FILTER,
  FILTER_PARAMS,
  filterFuer,
  filterHinweis,
  filterLabel,
  gilt,
  leiste,
  leseSicht,
  ruecksetzPatch,
  SICHTEN,
  type Ansicht,
  type Sicht,
} from "./filter-modell";
import {
  filterAusSearchParams, angewandteSchluessel } from "./stroeme-modell";

describe("Vollständigkeit: jeder geltende Filter wird auch angewendet", () => {
  it("für jede Kombination aus Ansicht und Sicht ist die Zugehörigkeit festgelegt", () => {
    // Nicht „irgendwie definiert", sondern: für JEDE Kombination liefert das
    // Modell eine Antwort, und sie ist eine Festlegung, kein Zufall.
    for (const ansicht of ANSICHTEN) {
      for (const sicht of SICHTEN) {
        for (const f of FILTER) {
          expect(typeof gilt(f, ansicht, sicht)).toBe("boolean");
        }
      }
    }
  });

  it("jeder geltende Schlüssel wird von filterStroeme angewendet", () => {
    const angewandt = new Set(angewandteSchluessel());
    const luecken: string[] = [];

    for (const ansicht of ANSICHTEN) {
      for (const sicht of SICHTEN) {
        for (const f of filterFuer(ansicht, sicht)) {
          for (const art of f.arten) {
            // Gilt der Filter für diese Sicht überhaupt?
            if (sicht !== "alle" && sicht !== art) continue;
            if (!angewandt.has(`${f.key}:${art}`)) {
              luecken.push(`${f.key} gilt in ${ansicht}/${art}, wird aber nicht angewendet`);
            }
          }
        }
      }
    }

    // Aussagekräftig statt „expected 3 to be 0": Wer den Test rot sieht, soll
    // sofort wissen, welcher Filter wo ins Leere greift.
    expect([...new Set(luecken)]).toEqual([]);
  });

  it("jeder angewendete Schlüssel ist auch im Modell definiert", () => {
    // Die Gegenrichtung: kein Filter, der wirkt, ohne sichtbar und
    // rücksetzbar zu sein (E32).
    const keys = new Set(FILTER.map((f) => f.key));
    const verwaist = [...new Set(angewandteSchluessel().map((s) => s.split(":")[0]!))].filter(
      (k) => !keys.has(k),
    );
    expect(verwaist).toEqual([]);
  });
});

describe("Einzigkeit: genau eine Definition", () => {
  it("kein Schlüssel und kein Parameter doppelt", () => {
    const keys = FILTER.map((f) => f.key);
    expect(keys).toEqual([...new Set(keys)]);
    expect(FILTER_PARAMS).toEqual([...new Set(FILTER_PARAMS)]);
  });

  it("die Parameterzahl passt zum Typ", () => {
    for (const f of FILTER) {
      if (f.typ === "bereich") expect(f.params.length).toBe(2);
      else if (f.typ === "hierarchie") expect(f.params.length).toBeGreaterThan(1);
      // Zeitfenster: zwei Grenzen plus der benannte Zustand.
      else if (f.typ === "zeitfenster") expect(f.params.length).toBe(3);
      else expect(f.params.length).toBe(1);
    }
  });

  it("bei Hierarchien decken sich Ebenen und Parameter — Reihenfolge inklusive", () => {
    // Zwei Listen fuer dieselbe Sache waeren zwei Wahrheiten: Die Ebenen
    // bestimmen die Anzeige, die Parameter die Adresszeile. Driften sie
    // auseinander, filtert der Baum etwas anderes, als er zeigt.
    for (const f of FILTER.filter((x) => x.typ === "hierarchie")) {
      expect(f.ebenen, `${f.key} hat keine Ebenen`).toBeDefined();
      expect(f.ebenen!.map((e) => e.param)).toEqual([...f.params]);
    }
  });

  it("keine zweite Facetten- oder Bereichsliste im Code", () => {
    // Vor E32 standen dieselben Facetten dreimal nebeneinander und
    // BEREICH_KEYS dreimal mit ZWEI verschiedenen Inhalten. Eine zweite
    // Liste ist keine Verdopplung, sie ist eine zweite Wahrheit.
    const treffer: string[] = [];
    for (const datei of quellen(join(process.cwd(), "app"))
      .concat(quellen(join(process.cwd(), "components")))
      .concat(quellen(join(process.cwd(), "lib")))) {
      // Das Modell selbst DARF die Schluessel nennen — es ist die eine
      // Definition, von der alle anderen ableiten.
      if (kurz(datei) === join("lib", "filter-modell.ts")) continue;
      // Ohne Kommentare: Die Modelldatei und die Toolbars NENNEN die alten
      // Namen, um zu erklaeren, warum es sie nicht mehr gibt. Ein Guard, der
      // am Erklaertext scheitert, wird durch Umformulieren umgangen statt
      // befolgt — geprueft wird, was der Code tut.
      const text = ohneKommentare(readFileSync(datei, "utf8"));
      if (/\bBEREICH_KEYS\b/.test(text)) treffer.push(`${kurz(datei)}: BEREICH_KEYS`);
      // Eine HANDGESCHRIEBENE Facettenliste erkennt man am woertlichen
      // Schluessel (`key: "cluster"`), nicht an der Deklaration: Eine aus dem
      // Modell abgeleitete Liste ist erlaubt und noetig — sie traegt nur
      // keine eigenen Namen.
      if (/FacettenChipDef/.test(text) && /\bkey:\s*"/.test(text)) {
        treffer.push(`${kurz(datei)}: eigene Facettenliste`);
      }
    }
    expect(treffer).toEqual([]);
  });

  it("die geteilten Parameter kommen aus dem Modell, nicht aus einer Liste daneben", () => {
    for (const datei of quellen(join(process.cwd(), "app")).concat(
      quellen(join(process.cwd(), "components")),
    )) {
      expect(ohneKommentare(readFileSync(datei, "utf8"))).not.toMatch(
        /GETEILTE_FILTER_PARAMS/,
      );
    }
  });
});

describe("sicht aus der Adresszeile", () => {
  it("nimmt die erlaubten Werte", () => {
    for (const s of SICHTEN) {
      expect(leseSicht(s, "feedstock")).toEqual({ sicht: s, umgeschrieben: false });
    }
  });

  it("setzt einen unbekannten Wert auf den Standard UND meldet das Umschreiben", () => {
    // Stillschweigend ausweichen waere genau das, was E32 abschafft: Die URL
    // behauptete dann etwas anderes als die Anzeige zeigt.
    expect(leseSicht("biomasse", "feedstock")).toEqual({
      sicht: "feedstock",
      umgeschrieben: true,
    });
    expect(leseSicht("quatsch", "feedstock")).toEqual({
      sicht: "feedstock",
      umgeschrieben: true,
    });
  });

  it("ohne Parameter wird nichts umgeschrieben", () => {
    expect(leseSicht(undefined, "feedstock")).toEqual({
      sicht: "feedstock",
      umgeschrieben: false,
    });
  });

  it("respektiert eine eingeschränkte Werteliste", () => {
    // auswertung. kennt kein "alle".
    const erlaubt: Sicht[] = ["feedstock", "outputs"];
    expect(leseSicht("alle", "feedstock", erlaubt)).toEqual({
      sicht: "feedstock",
      umgeschrieben: true,
    });
  });
});

function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function quellen(wurzel: string, treffer: string[] = []): string[] {
  let eintraege: string[];
  try {
    eintraege = readdirSync(wurzel);
  } catch {
    return treffer;
  }
  for (const e of eintraege) {
    if (e === "node_modules" || e === ".next") continue;
    const voll = join(wurzel, e);
    if (statSync(voll).isDirectory()) quellen(voll, treffer);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) treffer.push(voll);
  }
  return treffer;
}

const kurz = (p: string) => p.slice(process.cwd().length + 1);

// Typ-Rauchprobe: `Ansicht` bleibt exportiert und benutzbar.
const _a: Ansicht = "stroeme";
void _a;

describe("Die Stromart wird mitgetragen", () => {
  it("`sicht` ist kein Datenfilter, gehört aber in die Navigationslinks", () => {
    // Regression aus dem Preview-Test (25.09.2026): Die abgeloeste Liste
    // GETEILTE_FILTER_PARAMS enthielt "sicht"; FILTER_PARAMS enthaelt sie
    // bewusst nicht (sie filtert nicht, sie waehlt die Stromart). Beim
    // Umstellen fiel sie deshalb aus den Links — wer von Feedstock auf die
    // Karte wechselte, landete auf der Voreinstellung.
    expect(FILTER_PARAMS).not.toContain("sicht");
    const sidebar = readFileSync(
      join(process.cwd(), "components/shell/Sidebar.tsx"),
      "utf8",
    );
    expect(sidebar).toMatch(/p\.set\("sicht"/);
  });
});

describe("Zurückgehaltene Filter werden in ALLEN Ansichten ausgewiesen", () => {
  it("jede Filterleiste rendert die Leisten-Hinweise", () => {
    // Im Preview-Test (25.09.2026) gefunden: Die Prop war ueberall
    // durchgereicht, aber KarteToolbar rendert sie nicht — der Hinweis fehlte
    // genau dort still. E32 verlangt ihn in jeder Ansicht. Seit F5 PR B ist
    // das Rendern in EIN Bauteil gezogen (LeistenHinweise, traegt auch die
    // Nicht-beruecksichtigt-Saetze); geprueft wird beides: jede Leiste bindet
    // das Bauteil mit BEIDEN Props ein, und das Bauteil rendert den Hinweis.
    for (const datei of [
      "components/stroeme/FilterSortZeile.tsx",
      "components/karte/KarteToolbar.tsx",
      "components/auswertung/AuswertungToolbar.tsx",
    ]) {
      const text = readFileSync(join(process.cwd(), datei), "utf8");
      expect(text, `${datei} rendert die Leisten-Hinweise nicht`).toMatch(
        /<LeistenHinweise\s+zurueckgehalten=\{zurueckgehalten\}\s+hinweise=\{hinweise\}/,
      );
    }
    const bauteil = readFileSync(
      join(process.cwd(), "components/stroeme/LeistenHinweise.tsx"),
      "utf8",
    );
    expect(bauteil).toMatch(/zurueckgehalten\.length > 0/);
    expect(bauteil).toMatch(/hinweise\.map/);
  });
});

// E34: Migration 0021 hat `dokument_link` in `dokument` umbenannt. Alte
// Adressen (Lesezeichen, geteilte Links) filtern weiter richtig, statt still
// eine leere Liste zu zeigen.
describe("Altwert-Mapping (E34)", () => {
  it("bildet belegtyp=dokument_link auf dokument ab, andere Werte unverändert", () => {
    expect(altwertZuNeu("belegtyp", "dokument_link")).toBe("dokument");
    expect(altwertZuNeu("belegtyp", "vertrag")).toBe("vertrag");
    expect(altwertZuNeu("cluster", "dokument_link")).toBe("dokument_link");
  });

  it("greift beim Einlesen der Adresszeile — gemischt und mit Duplikat", () => {
    const f = filterAusSearchParams({ belegtyp: "dokument_link,vertrag" });
    expect(f.belegtyp).toEqual(["dokument", "vertrag"]);
  });
});

// Produktionsfehler 28.09.2026: „Filter zurücksetzen" ließ Blattparameter
// der Bäume stehen. Der Test läuft über die Filterliste, die auch die
// Vollständigkeitsprüfung nutzt — ein neuer Filter ist automatisch dabei.
describe("Filter zurücksetzen leert jeden geltenden Filter vollständig", () => {
  /** Beispielwerte je Filterart; Bäume in drei Varianten (Eltern, Kind, gemischt). */
  function belegungen(def: (typeof FILTER)[number]): Record<string, string>[] {
    if (def.typ === "hierarchie") {
      const [eltern, ...kinder] = def.params;
      const blatt = kinder[kinder.length - 1] ?? eltern!;
      return [
        { [eltern!]: "a" },
        { [blatt]: "b" },
        Object.fromEntries(def.params.map((p, i) => [p, `w${i}`])),
      ];
    }
    return [Object.fromEntries(def.params.map((p) => [p, def.typ === "monat" ? "2026-01" : def.typ === "datum" ? "2026-01-01" : "1"]))];
  }

  for (const ansicht of ANSICHTEN) {
    for (const sicht of SICHTEN) {
      it(`${ansicht}/${sicht}: nach dem Zurücksetzen ist kein geltender Filter mehr gesetzt`, () => {
        const luecken: string[] = [];
        for (const def of filterFuer(ansicht, sicht)) {
          for (const belegung of belegungen(def)) {
            const werte = filterAusSearchParams(belegung) as unknown as Record<string, unknown>;
            const vorher = leiste(ansicht, sicht, werte);
            expect(vorher.irgendeinFilter, `${def.key} ${JSON.stringify(belegung)} gilt als gesetzt`).toBe(true);
            // Wie useUrlZustand.setze: null loescht den Parameter.
            const patch = ruecksetzPatch(vorher);
            const nachher: Record<string, string> = { ...belegung };
            for (const k of Object.keys(patch)) delete nachher[k];
            const werteNachher = filterAusSearchParams(nachher) as unknown as Record<string, unknown>;
            const l = leiste(ansicht, sicht, werteNachher);
            if (l.irgendeinFilter) luecken.push(`${def.key} ${JSON.stringify(belegung)} → bleibt ${JSON.stringify(nachher)}`);
          }
        }
        expect(luecken).toEqual([]);
      });
    }
  }

  it("das Einzel-Aufheben eines Baums (leere) leert alle Ebenen des Baums", async () => {
    const { leere } = await import("./hierarchie");
    for (const def of FILTER.filter((f) => f.typ === "hierarchie")) {
      expect(Object.keys(leere([...def.ebenen!])).sort()).toEqual([...def.params].sort());
    }
  });
});

// Rückmeldung 1 (28.09.2026): Reihenfolge im Popover „Weitere Filter" —
// Zeile 1 „Verfügbar ab" | „Erstellt am", Zeile 2 „Vollständigkeit min/max";
// der Rest folgt in Modellreihenfolge. Eine Quelle für alle drei Seiten.
describe("Popover Weitere Filter: Reihenfolge und Vollständigkeit", () => {
  it("ströme./feedstock beginnt mit vonAb, erstellt, vollMin, vollMax", () => {
    const l = leiste("stroeme", "feedstock", {});
    expect(l.bereichParams.slice(0, 4)).toEqual(["vonAb", "erstellt", "vollMin", "vollMax"]);
  });
  it("enthält genau die Nicht-Facetten-Parameter der geltenden Filter, nichts doppelt", () => {
    for (const ansicht of ["stroeme", "karte", "auswertung"] as const) {
      for (const sicht of ["feedstock", "outputs"] as const) {
        // E56: Schalter stehen in der Kopfzeile, nicht im Popover „Weitere Filter".
        const erwartet = filterFuer(ansicht, sicht)
          .filter((f) => !["facette", "hierarchie", "text", "schalter"].includes(f.typ))
          .flatMap((f) => f.params);
        const ist = leiste(ansicht, sicht, {}).bereichParams;
        expect([...ist].sort(), `${ansicht}/${sicht}`).toEqual([...erwartet].sort());
        expect(new Set(ist).size).toBe(ist.length);
      }
    }
  });
  it("auswertung. (ohne Verfügbar ab) beginnt mit erstellt, vollMin, vollMax", () => {
    expect(leiste("auswertung", "feedstock", {}).bereichParams.slice(0, 3)).toEqual(["erstellt", "vollMin", "vollMax"]);
  });
});

// Rueckmeldung Echtbetrieb (29.09.2026): EINE Beschriftung fuer denselben
// Filter in allen Ansichten (E32); die Bezugszeit steht im Hinweis.
describe("Verfügbarkeit: eine Beschriftung, Bezugszeit im Hinweis", () => {
  const def = FILTER.find((f) => f.key === "verfuegbarkeit")!;
  it("heißt in ströme., karte. und auswertung. gleich", () => {
    for (const ansicht of ["stroeme", "karte", "auswertung"] as const) {
      expect(filterLabel(def, ansicht)).toBe("Verfügbarkeit");
    }
  });
  it("Hinweis: heute in ströme./karte., das gewählte Fenster in auswertung.", () => {
    expect(filterHinweis(def, "stroeme")).toBe("bezogen auf heute");
    expect(filterHinweis(def, "karte")).toBe("bezogen auf heute");
    expect(filterHinweis(def, "auswertung")).toBe("bezogen auf das gewählte Jahr bzw. den gewählten Zeitraum");
  });
  it("kein anderer Filter trägt eine abweichende Beschriftung je Ansicht", () => {
    for (const f of FILTER) {
      for (const ansicht of ["stroeme", "karte", "auswertung"] as const) expect(filterLabel(f, ansicht)).toBe(f.label);
    }
  });
});
