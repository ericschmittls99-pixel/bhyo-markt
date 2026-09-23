import { describe, expect, it } from "vitest";

import { deriveQualitaet } from "../lib/qualitaet";
import { validiereVergaben, vergabenZuFormZeilen } from "../lib/verfuegbarkeit";
import { BASIS_JAHR, baueSeedDaten, type SeedStrom } from "./seed-daten";

/** Abgeleitete Stufe eines Seed-Stroms — derselbe Weg wie die DB-Funktion. */
const stufe = (s: SeedStrom) =>
  s.beleg
    ? deriveQualitaet({
        typ: s.beleg.typ as never,
        externNachvollziehbar: s.beleg.extern,
        erhebungsdatum: s.beleg.erhebungsdatum,
        linkUrl: s.beleg.linkUrl,
        gueltigBis: s.beleg.gueltigBis,
        metadata: { quellenangabe: s.beleg.quellenangabe },
      })
    : null;

/**
 * Spec-Invarianten des Seed-v2-Auftrags (Eric, 22.09.2026) — jede Zahl hier
 * kommt woertlich aus dem Auftrag. Die Tests laufen OHNE Datenbank gegen den
 * puren Generator; der Writer (seed-preview.ts) prueft dieselben Invarianten
 * nach dem Insert nochmals aus der DB.
 */

const B = BASIS_JAHR;
const daten = baueSeedDaten();
const { feedstock, outputs } = daten;
const alle = [...feedstock, ...outputs];

const anker = (n: string) => {
  const s = alle.find((x) => x.anker === n);
  expect(s, `Anker ${n} fehlt`).toBeDefined();
  return s!;
};
const jahr = (iso: string) => Number(iso.slice(0, 4));
const saisonSumme = (s: SeedStrom) => s.saisonalitaet.reduce((a, b) => a + b, 0);

describe("Umfang und Marker", () => {
  it("60 Feedstock, 50 Outputs, alle mit SEED-v2-Marker in der Bezeichnung", () => {
    expect(feedstock).toHaveLength(60);
    expect(outputs).toHaveLength(50);
    for (const s of alle) expect(s.bezeichnung.endsWith(" · SEED-v2")).toBe(true);
  });

  it("deterministisch: zwei Laeufe erzeugen identische Daten (inkl. IDs)", () => {
    expect(baueSeedDaten()).toEqual(daten);
  });
});

describe("Feedstock §1", () => {
  it("Materialarten-Verteilung exakt nach Auftrag", () => {
    const soll: Record<string, number> = {
      waldrestholz: 6,
      saegemehl: 5,
      altholz_a1_a3: 5,
      landschaftspflegeholz: 4,
      gruenschnitt: 6,
      landschaftspflegeschnitt: 3,
      stroh: 5,
      rebholz: 3,
      fruchttrester: 2,
      gaerreste_fest: 4,
      klaerschlamm: 5,
      bioabfall: 6,
      papierschlamm: 2,
      miscanthus: 2,
      getreidespelzen: 2,
    };
    const ist: Record<string, number> = {};
    for (const s of feedstock)
      ist[s.materialartCode!] = (ist[s.materialartCode!] ?? 0) + 1;
    expect(ist).toEqual(soll);
  });

  it("Preisregeln: min <= mittel <= max (signiert); Klassen-Mittelwerte; 8 ohne Preis", () => {
    const ohne = feedstock.filter((s) => s.preisMittel == null);
    expect(ohne).toHaveLength(8);
    const klasse: Record<string, [number, number]> = {
      waldrestholz: [55, 110],
      saegemehl: [55, 110],
      stroh: [55, 110],
      miscanthus: [55, 110],
      landschaftspflegeholz: [55, 110],
      getreidespelzen: [55, 110],
      altholz_a1_a3: [-15, 25],
      rebholz: [-15, 25],
      gruenschnitt: [-90, -25],
      landschaftspflegeschnitt: [-90, -25],
      bioabfall: [-90, -25],
      gaerreste_fest: [-90, -25],
      papierschlamm: [-90, -25],
      fruchttrester: [-90, -25],
      klaerschlamm: [-170, -100],
    };
    for (const s of feedstock) {
      if (s.preisMittel == null) continue;
      expect(s.preisMin!).toBeLessThanOrEqual(s.preisMittel);
      expect(s.preisMittel).toBeLessThanOrEqual(s.preisMax!);
      if (s.anker) continue; // Anker (A9-positiv, A10-Spanne) duerfen abweichen
      const [lo, hi] = klasse[s.materialartCode!]!;
      expect(s.preisMittel, s.materialartCode).toBeGreaterThanOrEqual(lo);
      expect(s.preisMittel, s.materialartCode).toBeLessThanOrEqual(hi);
    }
  });

  it("TS-Gehalte plausibel je Art (inkl. genau 1x getrockneter Klaerschlamm mit 90)", () => {
    const ts = (code: string) =>
      feedstock.filter((s) => s.materialartCode === code).map((s) => s.tsAnteilPct!);
    expect(ts("stroh").every((v) => v === 86)).toBe(true);
    expect(ts("getreidespelzen").every((v) => v === 88)).toBe(true);
    expect(ts("miscanthus").every((v) => v === 80)).toBe(true);
    expect(ts("waldrestholz").every((v) => v >= 45 && v <= 65)).toBe(true);
    const ks = ts("klaerschlamm").sort((a, b) => a - b);
    expect(ks).toEqual([25, 25, 25, 25, 90]);
  });

  it("Mengen 500..25.000 t FM/a, genau 2 Ausreisser > 20.000, Median ~4.000", () => {
    const mengen = feedstock.map((s) => s.mengeRohFm!).sort((a, b) => a - b);
    expect(mengen[0]!).toBeGreaterThanOrEqual(500);
    expect(mengen[mengen.length - 1]!).toBeLessThanOrEqual(25000);
    expect(mengen.filter((m) => m > 20000)).toHaveLength(2);
    const median = (mengen[29]! + mengen[30]!) / 2;
    expect(median).toBeGreaterThan(2000);
    expect(median).toBeLessThan(7000);
  });

  it("Saisonalitaet: Summe 100 ± 0,1; charakteristische Profile", () => {
    for (const s of alle) expect(Math.abs(saisonSumme(s) - 100)).toBeLessThan(0.1);
    const profil = (code: string) =>
      feedstock.find((s) => s.materialartCode === code && !s.anker)!.saisonalitaet;
    const anteil = (p: number[], von: number, bis: number) =>
      p.slice(von, bis + 1).reduce((a, b) => a + b, 0);
    expect(anteil(profil("stroh"), 6, 8)).toBeGreaterThan(60); // Jul-Sep
    expect(anteil(profil("rebholz"), 0, 2)).toBeGreaterThan(50); // Jan-Mrz
    expect(anteil(profil("fruchttrester"), 8, 10)).toBeGreaterThan(70); // Sep-Nov
    expect(anteil(profil("gruenschnitt"), 4, 9)).toBeGreaterThan(65); // Mai-Okt
    expect(anteil(profil("waldrestholz"), 9, 11) + anteil(profil("waldrestholz"), 0, 2)).toBeGreaterThan(60); // Okt-Mrz
    for (const v of profil("klaerschlamm")) expect(Math.abs(v - 100 / 12)).toBeLessThan(0.2);
  });

  it("Zeitraum-Buckets 10/25/15/8 plus die zwei Zeitraum-Anker", () => {
    const paare = feedstock.map((s) => `${jahr(s.zeitraumVon)}..${jahr(s.zeitraumBis)}`);
    const zaehl = (p: string) => paare.filter((x) => x === p).length;
    expect(zaehl(`${B - 2}..${B}`)).toBe(10);
    expect(zaehl(`${B}..${B + 5}`)).toBe(25);
    expect(zaehl(`${B + 1}..${B + 8}`)).toBe(15);
    expect(zaehl(`${B + 2}..${B + 12}`)).toBe(8);
    expect(anker("A1").zeitraumBis).toBe(`${B}-06-30`);
    expect(jahr(anker("A2").zeitraumBis)).toBe(B + 40);
  });

  // E23: der Seed traegt KEINE Stufe mehr — die Verteilung wird aus den
  // Belegfeldern ABGELEITET (deriveQualitaet, identisch zur DB-Funktion).
  // Die Ziehliste 15/20/18/7 gilt weiter fuer die Zielstufen; die 9
  // entwurf-Stroeme haben keinen Beleg und damit keine Stufe (Pille "–").
  it("abgeleitete Qualitaet 14/19/18/7 bei 58 Belegen, 2 unbelegt-Anker", () => {
    const mit = feedstock.filter((s) => s.beleg);
    const q = (g: string) => mit.filter((s) => stufe(s) === g).length;
    expect(mit).toHaveLength(58);
    expect([q("A"), q("B"), q("C"), q("D")]).toEqual([14, 19, 18, 7]);
    expect(feedstock.filter((s) => s.status === "geprueft")).toHaveLength(39);
  });

  // E24: genau 2+1 Stroeme bleiben BEWUSST ohne Beleg — Ankerfall "unbelegt".
  it("unbelegt-Anker A15a/A15b/A15c sind die einzigen Stroeme ohne Beleg", () => {
    const feedOhne = feedstock.filter((s) => !s.beleg);
    const outOhne = outputs.filter((s) => !s.beleg);
    expect(feedOhne.map((s) => s.anker).sort()).toEqual(["A15a", "A15b"]);
    expect(outOhne.map((s) => s.anker)).toEqual(["A15c"]);
    for (const s of [...feedOhne, ...outOhne]) expect(s.status).toBe("entwurf");
  });

  it("kein Stufenwert im Seed-Input (E23) — Felder statt Ergebnis", () => {
    for (const s of [...feedstock, ...outputs])
      expect("qualitaet" in s).toBe(false);
  });

  it("abgeleitete Output-Qualitaet 11/17/15/6 bei 49 Belegen, 1 unbelegt-Anker", () => {
    const mit = outputs.filter((s) => s.beleg);
    const q = (g: string) => mit.filter((s) => stufe(s) === g).length;
    expect(mit).toHaveLength(49);
    expect([q("A"), q("B"), q("C"), q("D")]).toEqual([11, 17, 15, 6]);
  });

  it("Vergaben: 12 extern (5 laufend / 4 Teiljahr / 3 zukuenftig), 6 an bhyo, 7 reserviert", () => {
    const mitExtern = feedstock.filter((s) => s.vergaben.some((v) => !v.anBhyo));
    const mitBhyo = feedstock.filter((s) => s.vergaben.some((v) => v.anBhyo));
    const reserviert = feedstock.filter((s) => s.reserviertBhyo);
    expect(mitExtern).toHaveLength(12);
    expect(mitBhyo).toHaveLength(6);
    expect(reserviert).toHaveLength(7);
    for (const s of reserviert) {
      expect(s.reserviertSeit).toBeTruthy();
      expect(s.reserviertSeit! >= `${B - 1}-03-22`).toBe(true);
      expect(s.reserviertSeit! <= `${B}-09-22`).toBe(true);
    }
    const externe = mitExtern.map((s) => s.vergaben.find((v) => !v.anBhyo)!);
    // Kategorien nach Spec: Teiljahr = Dauer < 12 Monate; sonst laufend
    // (beginnt bis heute, inkl. unbefristet) oder erst zukuenftig beginnend.
    const monate = (v: (typeof externe)[number]) =>
      v.vergebenBis == null
        ? 99
        : (Number(v.vergebenBis.slice(0, 4)) - Number(v.vergebenVon!.slice(0, 4))) * 12 +
          (Number(v.vergebenBis.slice(5, 7)) - Number(v.vergebenVon!.slice(5, 7))) + 1;
    const teil = externe.filter((v) => monate(v) < 12);
    const laufend = externe.filter((v) => monate(v) >= 12 && v.vergebenVon! <= `${B}-09-22`);
    const zukunft = externe.filter((v) => monate(v) >= 12 && v.vergebenVon! > `${B}-09-22`);
    expect(laufend).toHaveLength(5);
    expect(teil).toHaveLength(4);
    expect(zukunft).toHaveLength(3);
  });

  it("jede Vergabenliste ist validierungskonform (Zeitraum, Ueberlappung)", () => {
    for (const s of alle) {
      if (!s.vergaben.length) continue;
      const fehler = validiereVergaben(
        s.zeitraumVon.slice(0, 7),
        s.zeitraumBis.slice(0, 7),
        vergabenZuFormZeilen(s.vergaben),
      );
      expect(fehler, s.bezeichnung).toEqual({});
    }
  });

  it("Geografie: Region-Box, mind. 3 Quasi-Duplikat-Paare", () => {
    for (const s of alle) {
      expect(s.lng).toBeGreaterThan(7.9);
      expect(s.lng).toBeLessThan(9.5);
      expect(s.lat).toBeGreaterThan(49.0);
      expect(s.lat).toBeLessThan(49.8);
    }
    let paare = 0;
    for (let i = 0; i < feedstock.length; i++)
      for (let j = i + 1; j < feedstock.length; j++) {
        const a = feedstock[i]!;
        const b = feedstock[j]!;
        if (Math.abs(a.lng - b.lng) < 0.005 && Math.abs(a.lat - b.lat) < 0.005) paare++;
      }
    expect(paare).toBeGreaterThanOrEqual(3);
  });
});

describe("Outputs §2", () => {
  it("Produkt-Verteilung (Pflanzenkohle entfernt: +3 CO2, +2 Synthesegas, +1 Asche)", () => {
    const soll: Record<string, number> = {
      h2_niederdruck: 7,
      h2_hochdruck: 7,
      synthesegas: 10,
      waerme: 9,
      co2: 13,
      asche: 4,
    };
    const ist: Record<string, number> = {};
    for (const s of outputs) ist[s.produktCode!] = (ist[s.produktCode!] ?? 0) + 1;
    expect(ist).toEqual(soll);
  });

  it("Einheiten und Preisbereiche je Produkt; 6 ohne Preis", () => {
    expect(outputs.filter((s) => s.preis == null)).toHaveLength(6);
    for (const s of outputs) {
      const p = s.produktCode!;
      if (p.startsWith("h2_"))
        expect(["t/a", "MWh/a"]).toContain(s.mengeEinheit);
      if (p === "synthesegas")
        expect(["MWh/a", "Nm³/a"]).toContain(s.mengeEinheit);
      if (["waerme", "co2", "asche"].includes(p))
        expect(s.mengeEinheit).toBe(p === "waerme" ? "MWh/a" : "t/a");
      if (s.preis == null) continue;
      if (p.startsWith("h2_")) {
        expect(s.preisEinheit).toBe("€/MWh");
        expect(s.preis).toBeGreaterThanOrEqual(180); // 18..28 ct/kWh
        expect(s.preis).toBeLessThanOrEqual(280);
      }
      if (p === "waerme") {
        expect(s.preis).toBeGreaterThanOrEqual(40);
        expect(s.preis).toBeLessThanOrEqual(90);
      }
      if (p === "co2") {
        expect(s.preisEinheit).toBe("€/kg");
        expect(s.preis).toBeGreaterThanOrEqual(0.1);
        expect(s.preis).toBeLessThanOrEqual(0.3);
      }
      // Beschluss 22.09.2026: Asche ist Erloes, nie Entsorgungsposition.
      if (p === "asche") {
        expect(s.preisEinheit).toBe("€/t");
        expect(s.preis).toBeGreaterThanOrEqual(10);
        expect(s.preis).toBeLessThanOrEqual(40);
      }
    }
  });

  it("Waerme winterlastig; Deckungen: >=5 extern, >=3 an bhyo", () => {
    const w = outputs.find((s) => s.produktCode === "waerme" && !s.anker)!;
    const winter =
      w.saisonalitaet[0]! + w.saisonalitaet[1]! + w.saisonalitaet[10]! + w.saisonalitaet[11]!;
    expect(winter).toBeGreaterThan(45);
    expect(outputs.filter((s) => s.vergaben.some((v) => !v.anBhyo)).length).toBeGreaterThanOrEqual(5);
    expect(outputs.filter((s) => s.vergaben.some((v) => v.anBhyo)).length).toBeGreaterThanOrEqual(3);
  });
});

describe("Ankerfaelle §3", () => {
  it("A1: abgelaufen zum Stichtag, traegt Jan-Jun-Anteile in B", () => {
    const s = anker("A1");
    expect(s.zeitraumBis).toBe(`${B}-06-30`);
  });
  it("A2: Zeitraumende B+40 (E16-Deckel)", () => {
    expect(jahr(anker("A2").zeitraumBis)).toBe(B + 40);
  });
  it("A3: Stroh spitz (Jul-Sep > 60 %) mit externer Vergabe exakt Jul-Sep B+2", () => {
    const s = anker("A3");
    expect(s.materialartCode).toBe("stroh");
    const julSep = s.saisonalitaet[6]! + s.saisonalitaet[7]! + s.saisonalitaet[8]!;
    expect(julSep).toBeGreaterThan(60);
    expect(s.vergaben).toEqual([
      {
        vergebenVon: `${B + 2}-07-01`,
        vergebenBis: `${B + 2}-09-30`,
        vergebenAn: expect.any(String),
        anBhyo: false,
      },
    ]);
  });
  it("A4: Teilvergabe Jan-Jun B+2 bei Gleichverteilung", () => {
    const s = anker("A4");
    expect(s.vergaben[0]).toMatchObject({
      vergebenVon: `${B + 2}-01-01`,
      vergebenBis: `${B + 2}-06-30`,
      anBhyo: false,
    });
    for (const v of s.saisonalitaet) expect(Math.abs(v - 100 / 12)).toBeLessThan(0.2);
  });
  it("A5: externe Vergabe mit leerem Bis (unbefristet)", () => {
    const v = anker("A5").vergaben[0]!;
    expect(v.vergebenBis).toBeNull();
    expect(v.vergebenVon).not.toBeNull();
    expect(v.anBhyo).toBe(false);
  });
  it("A6: reserviert + Verfuegbarkeit ab 01.01.B+2", () => {
    const s = anker("A6");
    expect(s.reserviertBhyo).toBe(true);
    expect(s.zeitraumVon).toBe(`${B + 2}-01-01`);
  });
  it("A7: reserviert UND aktive externe Vergabe", () => {
    const s = anker("A7");
    expect(s.reserviertBhyo).toBe(true);
    const v = s.vergaben.find((x) => !x.anBhyo)!;
    expect(v.vergebenVon! <= `${B}-09-22`).toBe(true);
    expect(v.vergebenBis! >= `${B}-09-22`).toBe(true);
  });
  it("A8: reserviert_seit aelter als 12 Monate", () => {
    const s = anker("A8");
    expect(s.reserviertBhyo).toBe(true);
    expect(s.reserviertSeit! < `${B - 1}-09-22`).toBe(true);
  });
  it("A9: zwei Gruenschnitt-Belege, einer positiv, einer negativ", () => {
    const a = anker("A9a");
    const b = anker("A9b");
    expect(a.materialartCode).toBe("gruenschnitt");
    expect(b.materialartCode).toBe("gruenschnitt");
    expect(a.preisMittel!).toBeGreaterThan(0);
    expect(b.preisMittel!).toBeLessThan(0);
  });
  it("A10: Spanne ueber den Vorzeichenwechsel (-40 / -5 / +30)", () => {
    const s = anker("A10");
    expect([s.preisMin, s.preisMittel, s.preisMax]).toEqual([-40, -5, 30]);
  });
  it("A11: Spelzen mit genau EINEM bepreisten Beleg (Bandbreite n=1)", () => {
    const spelzen = feedstock.filter((s) => s.materialartCode === "getreidespelzen");
    expect(spelzen).toHaveLength(2);
    expect(spelzen.filter((s) => s.preisMittel != null)).toHaveLength(1);
    expect(anker("A11").preisMittel).not.toBeNull();
  });
  it("A12: Waerme gross (nicht target) — 30.000 MWh/a", () => {
    const s = anker("A12");
    expect(s.produktCode).toBe("waerme");
    expect(s.mengeWert).toBe(30000);
  });
  it("A13: Output ohne Preis mit grosser Menge", () => {
    const s = anker("A13");
    expect(s.preis).toBeNull();
    expect(s.mengeWert!).toBeGreaterThanOrEqual(10000);
  });
  it("A14: zwei Feedstock-Belege an praktisch identischer Koordinate", () => {
    const a = anker("A14a");
    const b = anker("A14b");
    expect(Math.abs(a.lng - b.lng)).toBeLessThan(0.001);
    expect(Math.abs(a.lat - b.lat)).toBeLessThan(0.001);
  });
});
