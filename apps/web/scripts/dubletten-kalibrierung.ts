/**
 * AP2.5 PR c: Kalibrierung der Dubletten-Schwellen OHNE Datenbank (Eric,
 * 01.10.2026: lokal oder in der CI, nie gegen die gemeinsame Preview).
 * Rechnet die pg_trgm-Aehnlichkeit (lib/akteur-norm.ts) ueber alle Paare der
 * Seed-Namen — Seed-A25 (seed-akteure-daten.ts) und der Seed-Bestand
 * (seed-daten.ts) — und druckt den Bericht als Markdown fuer
 * docs/ap25-dubletten-kalibrierung.md: alle Paare ab 0,30, die Kandidaten
 * des Seeds (hinweis „Dublette …"), die Luecke zwischen dem schwaechsten
 * Kandidaten und dem staerksten Nicht-Kandidaten, und die gewaehlten
 * Schwellen. dubletten-kalibrierung.test.ts haelt die Trennung fest.
 */
import { aehnlichkeit, akteurNameNorm, DUBLETTE_SCHWACH, DUBLETTE_STARK, dublettenGrad } from "../lib/akteur-norm";
import { A25_AKTEURE, A25_ORTE } from "./seed-akteure-daten";
import { baueSeedDaten } from "./seed-daten";
import { AEHNLICHKEIT_FIXTURES } from "@bhyo/db/dubletten-fixtures";

export interface Paar {
  a: string;
  b: string;
  norm: [string, string];
  sim: number;
  /** Kandidat laut Seed-Hinweis: "stark" / "schwach" / null. */
  kandidat: "stark" | "schwach" | null;
  gleichePlz: boolean;
}

export function kalibrierungsPaare(ab = 0.3): Paar[] {
  const namen = [
    ...A25_AKTEURE.map((a) => ({ name: a.name, plz: A25_ORTE[a.ortIdx]!.plz, gruppe: a.hinweis?.match(/^Dublette (stark|schwach) (\w+)/) ?? null })),
    ...baueSeedDaten().akteure.map((a) => ({ name: a.name.replace(/^Seed: /, ""), plz: "", gruppe: null })),
  ];
  const paare: Paar[] = [];
  for (let i = 0; i < namen.length; i++)
    for (let j = i + 1; j < namen.length; j++) {
      const x = namen[i]!;
      const y = namen[j]!;
      const norm: [string, string] = [akteurNameNorm(x.name), akteurNameNorm(y.name)];
      const sim = aehnlichkeit(norm[0], norm[1]);
      if (sim < ab) continue;
      const kandidat = x.gruppe && y.gruppe && x.gruppe[2] === y.gruppe[2] ? (x.gruppe[1] as "stark" | "schwach") : null;
      paare.push({ a: x.name, b: y.name, norm, sim, kandidat, gleichePlz: !!x.plz && x.plz === y.plz });
    }
  return paare.sort((p, q) => q.sim - p.sim || p.a.localeCompare(q.a, "de"));
}

export function bericht(): string {
  const paare = kalibrierungsPaare();
  const z = ["| Paar | normalisiert | Ähnlichkeit | Seed-Kandidat | gleiche PLZ | Vorschlag |", "|---|---|---|---|---|---|"];
  for (const p of paare) {
    const grad = dublettenGrad(p.sim, p.gleichePlz);
    z.push(`| ${p.a} · ${p.b} | ${p.norm[0]} · ${p.norm[1]} | ${p.sim.toFixed(3)} | ${p.kandidat ?? "–"} | ${p.gleichePlz ? "ja" : "–"} | ${grad ?? "–"} |`);
  }
  const kand = paare.filter((p) => p.kandidat);
  const fremd = paare.filter((p) => !p.kandidat);
  const minKand = Math.min(...kand.map((p) => p.sim));
  const maxFremd = Math.max(...fremd.map((p) => p.sim));
  z.push("");
  z.push(`Kandidaten des Seeds: ${kand.length} Paare, schwächster ${minKand.toFixed(3)}.`);
  z.push(`Nicht-Kandidaten ab 0,30: ${fremd.length} Paare, stärkster ${maxFremd.toFixed(3)} (${fremd[0] ? `${fremd[0].a} · ${fremd[0].b}` : "–"}).`);
  z.push(`Schwellen: stark ≥ ${DUBLETTE_STARK} mit gleicher PLZ oder gleichem Kreis-ARS, schwach ≥ ${DUBLETTE_SCHWACH}.`);
  return z.join("\n");
}

if (process.argv[1] && /dubletten-kalibrierung\.ts$/.test(process.argv[1])) {
  console.log(bericht());
  console.log("\nFixture-Aehnlichkeiten (TS):");
  for (const [a, b] of AEHNLICHKEIT_FIXTURES) console.log(`${JSON.stringify(a)} · ${JSON.stringify(b)} = ${aehnlichkeit(a, b)}`);
}
