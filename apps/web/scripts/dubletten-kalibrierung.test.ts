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
import { kalibrierungsPaare } from "./dubletten-kalibrierung";

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
  it("kein Nicht-Kandidat mit verschiedenem Namen erreicht die schwache Schwelle", () => {
    const fremd = paare.filter((p) => !p.kandidat && p.norm[0] !== p.norm[1]);
    const staerkster = fremd.reduce((m, p) => (p.sim > m.sim ? p : m));
    expect(staerkster.sim, `${staerkster.a} · ${staerkster.b}`).toBeLessThan(DUBLETTE_SCHWACH);
    // Mit Ortsbezug werden falsche Freunde am selben Ort bewusst vorgeschlagen (stark ab 0,6).
    expect(DUBLETTE_STARK).toBeLessThanOrEqual(staerkster.sim);
  });
});
