import { describe, expect, it } from "vitest";

import { ANKERFAELLE } from "./qualitaet-ankerfaelle";
import {
  BELEG_LABEL,
  BELEG_TYPEN,
  GUELTIG_BIS_BESCHRIFTUNG,
  belegTypRang,
  brauchtGueltigBis,
  deriveQualitaet,
  normalisiereUrl,
  stufeObergrenzeOhneDatei,
} from "./qualitaet";

// E34: Die Ankerfaelle sind die eine Referenz — dieselbe Liste laeuft im
// Deploy-CI gegen die DB-Funktion (scripts/qualitaet-paritaet.ts).
describe("deriveQualitaet – E34-Ankerfaelle", () => {
  for (const a of ANKERFAELLE) {
    it(`${a.name} -> ${a.erwartet}`, () => {
      expect(deriveQualitaet(a.bewertung)).toBe(a.erwartet);
    });
  }

  it("deckt jeden der sieben Typen vollstaendig UND unvollstaendig ab", () => {
    for (const typ of BELEG_TYPEN) {
      expect(ANKERFAELLE.some((a) => a.name === `${typ} vollstaendig (Datei)`)).toBe(true);
      expect(
        ANKERFAELLE.some((a) => a.name === `${typ} unvollstaendig (ohne Datei und Link)`),
      ).toBe(true);
    }
  });
});

describe("deriveQualitaet – Matrix in Worten", () => {
  it("A nur ueber Betriebsdaten und Vertrag", () => {
    const aTypen = BELEG_TYPEN.filter(
      (typ) => deriveQualitaet({ typ, dateiKey: "x" }) === "A",
    );
    expect(aTypen).toEqual(["betriebsdaten", "vertrag"]);
  });

  it("D ist die Untergrenze — kein Typ faellt darunter, unvollstaendig oder nicht", () => {
    for (const typ of BELEG_TYPEN) {
      expect(["A", "B", "C", "D"]).toContain(deriveQualitaet({ typ }));
    }
  });

  it("Gespraech und Webrecherche sind glatt: Datei aendert nichts", () => {
    expect(deriveQualitaet({ typ: "gespraech" })).toBe("C");
    expect(deriveQualitaet({ typ: "gespraech", dateiKey: "x" })).toBe("C");
    expect(deriveQualitaet({ typ: "webrecherche" })).toBe("D");
    expect(deriveQualitaet({ typ: "webrecherche", dateiKey: "x", linkUrl: "https://x" })).toBe("D");
  });
});

describe("E34-Reihenfolge und Beschriftungen", () => {
  it("sieben Typen in der verbindlichen Reihenfolge", () => {
    expect([...BELEG_TYPEN]).toEqual([
      "betriebsdaten",
      "vertrag",
      "absichtserklaerung",
      "angebot",
      "gespraech",
      "dokument",
      "webrecherche",
    ]);
    expect(Object.keys(BELEG_LABEL)).toEqual([...BELEG_TYPEN]);
  });

  it("Rang folgt der Reihenfolge, Unbekanntes sortiert hinten", () => {
    expect(belegTypRang("betriebsdaten")).toBe(0);
    expect(belegTypRang("webrecherche")).toBe(6);
    expect(belegTypRang("dokument_link")).toBe(7);
  });

  it("gueltig_bis: Pflicht und typabhaengige Beschriftung nur bei den oberen vier", () => {
    const mit = BELEG_TYPEN.filter(brauchtGueltigBis);
    expect(mit).toEqual(["betriebsdaten", "vertrag", "absichtserklaerung", "angebot"]);
    expect(GUELTIG_BIS_BESCHRIFTUNG.betriebsdaten).toBe("Daten repräsentativ bis");
    expect(GUELTIG_BIS_BESCHRIFTUNG.vertrag).toBe("Vertrag läuft bis");
    expect(GUELTIG_BIS_BESCHRIFTUNG.absichtserklaerung).toBe("Absichtserklärung gültig bis");
    expect(GUELTIG_BIS_BESCHRIFTUNG.angebot).toBe("Angebot gültig bis");
    for (const typ of ["gespraech", "dokument", "webrecherche"] as const)
      expect(GUELTIG_BIS_BESCHRIFTUNG[typ]).toBeNull();
  });
});

// F7: Live-Hinweis im Formular — Obergrenze je Typ ohne Datei/Link.
describe("stufeObergrenzeOhneDatei", () => {
  it("nennt je Typ die Stufe, die ohne Datei/Link maximal erreichbar ist", () => {
    expect(stufeObergrenzeOhneDatei("betriebsdaten")).toBe("B");
    expect(stufeObergrenzeOhneDatei("vertrag")).toBe("B");
    expect(stufeObergrenzeOhneDatei("absichtserklaerung")).toBe("C");
    expect(stufeObergrenzeOhneDatei("angebot")).toBe("C");
    expect(stufeObergrenzeOhneDatei("dokument")).toBe("D");
  });

  it("liefert null, wenn eine Datei die Stufe nicht hoebe (Gespraech, Webrecherche)", () => {
    expect(stufeObergrenzeOhneDatei("gespraech")).toBeNull();
    expect(stufeObergrenzeOhneDatei("webrecherche")).toBeNull();
  });
});

// F4: Link-Eingabe ohne Schema.
describe("normalisiereUrl", () => {
  it("ergaenzt https:// bei schemaloser Eingabe", () => {
    expect(normalisiereUrl("www.beispiel.de")).toBe("https://www.beispiel.de");
    expect(normalisiereUrl("beispiel.de/pfad?a=1")).toBe("https://beispiel.de/pfad?a=1");
    expect(normalisiereUrl("  www.beispiel.de  ")).toBe("https://www.beispiel.de");
  });
  it("laesst vorhandene Schemata unangetastet", () => {
    expect(normalisiereUrl("https://beispiel.de")).toBe("https://beispiel.de");
    expect(normalisiereUrl("http://beispiel.de")).toBe("http://beispiel.de");
    expect(normalisiereUrl("mailto:info@beispiel.de")).toBe("mailto:info@beispiel.de");
  });
  it("leer bleibt leer", () => {
    expect(normalisiereUrl("")).toBeNull();
    expect(normalisiereUrl(null)).toBeNull();
    expect(normalisiereUrl("   ")).toBeNull();
  });
});
