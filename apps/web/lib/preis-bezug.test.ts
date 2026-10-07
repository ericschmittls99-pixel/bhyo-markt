/**
 * E69 (Eric 07.10.2026): Der Preis wird mit seinem Bezug erfasst; die Auswertung
 * rechnet mit dem abgeleiteten Preis €/t atro. Rot-Nachweis: vor E69 rechnete
 * potenzialEuroFeedstock und der Korridor mit dem Rohwert — 30 €/t FM bei 30 % TS
 * ergaben 30 statt 100 €/t atro. Diese Faelle halten die Regel fest.
 */
import { describe, expect, it } from "vitest";

import { kpiKarten, potenzialZeilen, preisKorridorRoh, preisKorridorZeilen, preisVergleichbar, zaehleNichtVergleichbar } from "./auswertung-modell";
import { potenzialEuroFeedstock } from "./potenzial";
import { NICHT_VERGLEICHBAR, preisAtro, preisAtroVon, preisEinheitAnzeige, preisNichtVergleichbar } from "./preis-bezug";
import { preisKorridorEinzel } from "./preiskorridor-einzel";
import type { Strom } from "./stroeme-modell";

const strom = (patch: Partial<Strom>): Strom => ({
  id: "x",
  art: "biomasse",
  akteurId: "a",
  akteurName: "A",
  sektorLabel: null,
  sektor: null,
  bezeichnung: null,
  ort: null,
  verwaltung: null,
  regionIds: [],
  regionNamen: [],
  lng: null,
  lat: null,
  cluster: null,
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
  // E69: die bestehenden Faelle rechnen in €/t atro — der Bezug steht jetzt ausdruecklich dabei.
  preisBezug: "atro",
  gruppe: null,
  gruppeLabel: null,
  produktCode: null,
  produktLabel: null,
  kategorie: null,
  mengeWert: null,
  mengeEinheit: null,
  preis: null,
  preisEinheit: null,
  zeitraumVon: null,
  zeitraumBis: null,
  saisonalitaet: null,
  qualitaet: null,
  status: "entwurf",
  reserviertBhyo: false,
  reserviertSeit: null,
  erstelltAm: "2026-09-01",
  beleg: null,
  vollstaendigkeit: 0,
  ...patch,
});

const fm30 = strom({ id: "fm", cluster: "organische_rest_abfallstoffe", materialartCode: "guelle", preisMittel: 30, preisBezug: "fm", tsAnteil: 30, mengeFm: 100, mengeAtro: 27, aschegehalt: 10 });
const atro50 = strom({ id: "atro", cluster: "organische_rest_abfallstoffe", materialartCode: "guelle", preisMittel: 50, preisBezug: "atro", tsAnteil: 30, mengeFm: 100, mengeAtro: 27, aschegehalt: 10 });
const fmOhneTs = strom({ id: "ohne", cluster: "organische_rest_abfallstoffe", materialartCode: "guelle", preisMittel: 40, preisBezug: "fm", tsAnteil: null, mengeFm: 100, mengeAtro: null, aschegehalt: null });
const unbekannt = strom({ id: "unb", cluster: "organische_rest_abfallstoffe", materialartCode: "guelle", preisMittel: 40, preisBezug: "unbekannt", tsAnteil: 30, mengeFm: 100, mengeAtro: 27, aschegehalt: 10 });

describe("E69: abgeleiteter Preis €/t atro", () => {
  it("30 €/t FM bei 30 % TS sind 100 €/t atro; 50 €/t atro bleiben 50", () => {
    expect(preisAtro(30, "fm", 30)).toBe(100);
    expect(preisAtro(50, "atro", 30)).toBe(50);
    expect(preisAtroVon(fm30)).toEqual({ min: 100, mittel: 100, max: 100 });
    expect(preisAtroVon(strom({ preisMin: 24, preisMittel: 30, preisMax: 36, preisBezug: "fm", tsAnteil: 30 }))).toEqual({ min: 80, mittel: 100, max: 120 });
  });
  it("FM ohne TS-Anteil und Bezug unbekannt sind nicht vergleichbar — kein Rohwert, kein Potenzial", () => {
    expect(preisAtro(40, "fm", null)).toBeNull();
    expect(preisAtro(40, "unbekannt", 30)).toBeNull();
    expect(preisNichtVergleichbar(fmOhneTs)).toBe(true);
    expect(preisNichtVergleichbar(unbekannt)).toBe(true);
    expect(preisNichtVergleichbar(strom({ preisMittel: null }))).toBe(false);
    expect(preisVergleichbar(fmOhneTs)).toBe(false);
    expect(potenzialEuroFeedstock(fmOhneTs)).toBeNull();
    expect(potenzialEuroFeedstock(unbekannt)).toBeNull();
  });
  it("Rot-Nachweis: das Potenzial rechnet mit 100, nicht mit 30 (−100 × 27 t atro)", () => {
    expect(potenzialEuroFeedstock(fm30)).toBe(-(100 * 27));
    expect(potenzialEuroFeedstock(atro50)).toBe(-(50 * 27));
  });
  it("Korridor und Potenzial je Cluster schliessen nicht vergleichbare Stroeme aus und nennen ihre Zahl", () => {
    const pool = [fm30, atro50, fmOhneTs, unbekannt];
    const roh = preisKorridorRoh(pool.filter(preisVergleichbar));
    expect(roh).toMatchObject({ leer: false, mittel: 75 });
    expect(zaehleNichtVergleichbar(pool)).toBe(2);
    const zeile = preisKorridorZeilen(pool, pool).find((z) => z.key === "organische_rest_abfallstoffe")!;
    expect(zeile.mittelText).toBe("75");
    expect(zeile.zusatz).toContain(`2 ${NICHT_VERGLEICHBAR}`);
    const pot = potenzialZeilen(pool, pool).find((z) => z.key === "organische_rest_abfallstoffe")!;
    // −(100 × 27) − (50 × 27) = −4.050; die beiden nicht vergleichbaren zaehlen nicht mit.
    expect(pot.mittelText).toBe("-4.050");
    expect(pot.zusatz).toContain(`2 ${NICHT_VERGLEICHBAR}`);
  });
  it("ein Cluster nur mit nicht vergleichbaren Preisen ist leer und sagt warum", () => {
    const zeile = preisKorridorZeilen([fmOhneTs, unbekannt], [fmOhneTs, unbekannt]).find((z) => z.key === "organische_rest_abfallstoffe")!;
    expect(zeile.leer).toBe(true);
    expect(zeile.hinweis).toMatch(/2 Belege nicht vergleichbar/);
  });
  it("KPI-Kacheln: ø Preis in €/t atro, Caption nennt die nicht vergleichbaren", () => {
    const k = kpiKarten([fm30, atro50, fmOhneTs], "feedstock" as never);
    expect(k[2]).toMatchObject({ wert: "75", einheit: "€/t atro" });
    expect(k[2]!.caption).toMatch(/1 Beleg nicht vergleichbar/);
    expect(k[3]!.caption).toMatch(/1 Beleg nicht vergleichbar/);
  });
  it("E38 am Einzelstrom: eigener Korridor in €/t atro, nicht vergleichbarer Strom bekommt den benannten Zustand", () => {
    const pool = [fm30, atro50, strom({ id: "p3", cluster: "organische_rest_abfallstoffe", preisMittel: 60, preisBezug: "atro", tsAnteil: 30, mengeAtro: 10 })];
    const k = preisKorridorEinzel(fm30, pool, { cluster: { organische_rest_abfallstoffe: "Organische Reststoffe" } });
    expect(k.eigen).toEqual({ min: 100, mittel: 100, max: 100 });
    expect(k.band?.n).toBe(2);
    const nv = preisKorridorEinzel(fmOhneTs, [...pool, fmOhneTs], { cluster: {} });
    expect(nv.zustand).toMatch(/nicht vergleichbar/);
    expect(nv.band).toBeNull();
    // Der nicht vergleichbare Strom ist auch fuer andere kein Vergleichswert.
    expect(preisKorridorEinzel(fm30, [...pool, fmOhneTs], { cluster: {} }).band?.n).toBe(2);
  });
  it("Anzeige des Bezugs", () => {
    expect(preisEinheitAnzeige("fm")).toBe("€/t FM");
    expect(preisEinheitAnzeige("atro")).toBe("€/t atro");
    expect(preisEinheitAnzeige("unbekannt")).toBe("€/t (Bezug unbekannt)");
  });
});
