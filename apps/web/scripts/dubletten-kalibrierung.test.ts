/**
 * AP2.5 PR c: Die Schwellen trennen die Dubletten-Kandidaten des Seeds von
 * den uebrigen Paaren — ohne Datenbank (Eric, 01.10.2026). Aendert jemand
 * Schwellen, Normalisierung oder Seed-Namen, zeigt dieser Test, ob die
 * Trennung haelt. Gleichnamige Paare des Seed-Bestands (seed-daten.ts, acht
 * doppelte Namen) sind echte Namensdubletten und zaehlen hier nicht als
 * falsche Freunde.
 */
import { describe, expect, it } from "vitest";

import { DUBLETTE_SCHWACH, DUBLETTE_STARK, dublettenGrad } from "../lib/akteur-norm";
import { kalibrierPaare, kalibrierungsPaare } from "./dubletten-kalibrierung";

const paare = kalibrierungsPaare(0);

describe("Dubletten-Kalibrierung gegen den Seed", () => {
  it("findet die fuenf Kandidaten des Seeds (drei stark, zwei schwach)", () => {
    const kand = paare.filter((p) => p.kandidat);
    expect(kand).toHaveLength(5);
    expect(kand.filter((p) => p.kandidat === "stark")).toHaveLength(3);
  });
  it("jeder starke Kandidat ist stark (Aehnlichkeit >= stark, gleiche PLZ), jeder schwache schwach", () => {
    for (const p of paare.filter((p) => p.kandidat === "stark")) expect(dublettenGrad(p.sim, p.gleichePlz), `${p.a} · ${p.b}`).toBe("stark");
    for (const p of paare.filter((p) => p.kandidat === "schwach")) expect(dublettenGrad(p.sim, p.gleichePlz), `${p.a} · ${p.b}`).toBe("schwach");
  });
  it("Zusatzregel Wort-Teilmenge macht im Seed kein Paar mit gleicher PLZ neu stark", () => {
    expect(paare.filter((p) => p.gleichePlz && p.teilmenge && dublettenGrad(p.sim, p.gleichePlz) !== "stark")).toEqual([]);
  });
  it("kein Nicht-Kandidat mit verschiedenem Namen erreicht die schwache Schwelle", () => {
    const fremd = paare.filter((p) => !p.kandidat && p.norm[0] !== p.norm[1]);
    const staerkster = fremd.reduce((m, p) => (p.sim > m.sim ? p : m));
    expect(staerkster.sim, `${staerkster.a} · ${staerkster.b}`).toBeLessThan(DUBLETTE_SCHWACH);
    // Mit Ortsbezug werden falsche Freunde am selben Ort bewusst vorgeschlagen (stark ab 0,6).
    expect(DUBLETTE_STARK).toBeLessThanOrEqual(staerkster.sim);
  });
});

describe("Kalibrier-Paare der geteilten Fixture-Liste (Eric 01.10.2026)", () => {
  const alle = kalibrierPaare();
  it("Aehnlichkeit und Ergebnis jedes Paars sind festgehalten (Fixture = Messung)", () => {
    for (const p of alle) {
      expect(p.gerechnet, `${p.a} · ${p.b}`).toBeCloseTo(p.aehnlichkeit, 9);
      expect(p.teilmenge, `${p.a} · ${p.b}`).toBe(p.wortTeilmenge);
      expect(p.ergebnis, `${p.a} · ${p.b}`).toBe(p.grad);
    }
  });
  it("alle Seed-Kandidaten werden gefunden (stark bzw. schwach)", () => {
    for (const p of alle.filter((x) => x.klasse === "seed_stark")) expect(p.ergebnis).toBe("stark");
    for (const p of alle.filter((x) => x.klasse === "seed_schwach")) expect(p.ergebnis).toBe("schwach");
  });
  it("echte Varianten: Treffer und die ausdruecklich benannten Nicht-Treffer bei den gewaehlten Schwellen", () => {
    const varianten = alle.filter((x) => x.klasse === "variante");
    const nicht = varianten.filter((x) => !x.ergebnis).map((x) => `${x.a} · ${x.b}${x.gleicherOrt ? "" : " (ohne Ortsbezug)"}`);
    // Was hier steht, steht auch im Bericht (docs/ap25-dubletten-kalibrierung.md) — aendert sich die Liste, aendert sich der Bericht.
    expect(nicht).toEqual([
      "Kompostwerk Vorderpfalz · Kompostwerk Vorderpflaz (ohne Ortsbezug)",
      "Gem. Haßloch · Gemeinde Haßloch (ohne Ortsbezug)",
      "Stadtwerke Speyer · Stadtwerke Speyer Energie (ohne Ortsbezug)",
    ]);
    // Zusatzregel Wort-Teilmenge (Eric 01.10.2026): genau dieses Paar wird dadurch gefunden, sonst nichts.
    expect(varianten.filter((x) => x.ergebnis !== x.ohneRegel).map((x) => `${x.a} · ${x.b}`)).toEqual(["AVR Abfallverwertung Rhein-Neckar · AVR Rhein-Neckar"]);
  });
  it("kommunale falsche Treffer: keiner erreicht die schwache Schwelle; die Fehlalarme mit Ortsbezug sind ausdruecklich benannt", () => {
    const kommunal = alle.filter((x) => x.klasse === "kommunal");
    expect(kommunal.length).toBeGreaterThan(0);
    for (const p of kommunal) expect(p.gerechnet, `${p.a} · ${p.b}`).toBeLessThan(DUBLETTE_SCHWACH);
    // Die Zusatzregel erzeugt keinen neuen Fehlalarm (Bedingung fuer ihre Uebernahme).
    for (const p of kommunal) expect(p.ergebnis, `${p.a} · ${p.b}`).toBe(p.ohneRegel);
    expect(kommunal.filter((x) => x.ergebnis).map((x) => `${x.a} · ${x.b}`)).toEqual([
      "Stadt Speyer · Stadtwerke Speyer",
      "Gemeinde Haßloch · Gemeindewerke Haßloch",
      "Stadt Hockenheim · Stadtwerke Hockenheim",
    ]);
  });
});
