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
import { aehnlichkeit, akteurNameNorm, DUBLETTE_SCHWACH, DUBLETTE_STARK, dublettenGrad, wortTeilmenge } from "../lib/akteur-norm";
import { A25_AKTEURE, A25_ORTE } from "./seed-akteure-daten";
import { baueSeedDaten } from "./seed-daten";
import { AEHNLICHKEIT_FIXTURES, KALIBRIER_PAARE, type KalibrierKlasse, type KalibrierPaar } from "@bhyo/db/dubletten-fixtures";

export interface Paar {
  a: string;
  b: string;
  norm: [string, string];
  sim: number;
  /** Kandidat laut Seed-Hinweis: "stark" / "schwach" / null. */
  kandidat: "stark" | "schwach" | null;
  gleichePlz: boolean;
  teilmenge: boolean;
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
      paare.push({ a: x.name, b: y.name, norm, sim, kandidat, gleichePlz: !!x.plz && x.plz === y.plz, teilmenge: wortTeilmenge(norm[0], norm[1]) });
    }
  return paare.sort((p, q) => q.sim - p.sim || p.a.localeCompare(q.a, "de"));
}

/** Die Kalibrier-Paare der geteilten Fixture-Liste, nachgerechnet bei den gewaehlten Schwellen. */
export function kalibrierPaare(): (KalibrierPaar & { gerechnet: number; teilmenge: boolean; ohneRegel: "stark" | "schwach" | null; ergebnis: "stark" | "schwach" | null; norm: [string, string] })[] {
  return KALIBRIER_PAARE.map((p) => {
    const norm: [string, string] = [akteurNameNorm(p.a), akteurNameNorm(p.b)];
    const gerechnet = aehnlichkeit(norm[0], norm[1]);
    const teilmenge = wortTeilmenge(norm[0], norm[1]);
    return { ...p, norm, gerechnet, teilmenge, ohneRegel: dublettenGrad(gerechnet, p.gleicherOrt), ergebnis: dublettenGrad(gerechnet, p.gleicherOrt, teilmenge) };
  });
}

const KLASSE_TEXT: Record<KalibrierKlasse, string> = {
  seed_stark: "Seed-Kandidaten stark",
  seed_schwach: "Seed-Kandidaten schwach",
  variante: "echte Varianten (sollen gefunden werden)",
  kommunal: "kommunale falsche Treffer (sollen nicht erscheinen)",
};

export function klassenBericht(): string {
  const z: string[] = [];
  const alle = kalibrierPaare();
  for (const klasse of ["seed_stark", "seed_schwach", "variante", "kommunal"] as KalibrierKlasse[]) {
    const p = alle.filter((x) => x.klasse === klasse);
    const gefunden = p.filter((x) => x.ergebnis !== null);
    const soll = klasse !== "kommunal";
    z.push(`### ${KLASSE_TEXT[klasse]}: ${soll ? `${gefunden.length} von ${p.length} gefunden` : `${gefunden.length} von ${p.length} Fehlalarme`}`);
    z.push("");
    const ohne = p.filter((x) => x.ohneRegel !== null).length;
    z.push(`Ohne Zusatzregel „Wort-Teilmenge": ${soll ? `${ohne} von ${p.length} gefunden` : `${ohne} von ${p.length} Fehlalarme`}; mit Regel: ${soll ? `${gefunden.length} gefunden` : `${gefunden.length} Fehlalarme`}.`);
    z.push("");
    z.push("| Paar | normalisiert | Ähnlichkeit | Wort-Teilmenge | Ortsbezug | ohne Regel | Ergebnis |", "|---|---|---|---|---|---|---|");
    for (const x of p) z.push(`| ${x.a} · ${x.b} | ${x.norm[0]} · ${x.norm[1]} | ${x.gerechnet.toFixed(3)} | ${x.teilmenge ? "ja" : "–"} | ${x.gleicherOrt ? "ja" : "–"} | ${x.ohneRegel ?? "–"} | ${x.ergebnis ?? "–"}${soll && !x.ergebnis ? " **(nicht gefunden)**" : !soll && x.ergebnis ? " **(Fehlalarm)**" : ""}${x.ergebnis !== x.ohneRegel ? " **(durch Regel)**" : ""} |`);
    const nicht = soll ? p.filter((x) => !x.ergebnis) : p.filter((x) => x.ergebnis);
    z.push("");
    if (soll && nicht.length) z.push(`Nicht gefunden: ${nicht.map((x) => `„${x.a}" · „${x.b}"${x.gleicherOrt ? "" : " (ohne Ortsbezug)"}`).join("; ")}.`);
    if (!soll && nicht.length) z.push(`Fehlalarme: ${nicht.map((x) => `„${x.a}" · „${x.b}" (${x.ergebnis})`).join("; ")}.`);
    z.push("");
  }
  return z.join("\n");
}

export function bericht(): string {
  const paare = kalibrierungsPaare();
  const z = ["| Paar | normalisiert | Ähnlichkeit | Seed-Kandidat | gleiche PLZ | Vorschlag |", "|---|---|---|---|---|---|"];
  for (const p of paare) {
    const grad = dublettenGrad(p.sim, p.gleichePlz, p.teilmenge);
    z.push(`| ${p.a} · ${p.b} | ${p.norm[0]} · ${p.norm[1]} | ${p.sim.toFixed(3)} | ${p.kandidat ?? "–"} | ${p.gleichePlz ? "ja" : "–"} | ${grad ?? "–"}${grad !== dublettenGrad(p.sim, p.gleichePlz) ? " (durch Regel)" : ""} |`);
  }
  const kand = paare.filter((p) => p.kandidat);
  const fremd = paare.filter((p) => !p.kandidat);
  const minKand = Math.min(...kand.map((p) => p.sim));
  const maxFremd = Math.max(...fremd.map((p) => p.sim));
  z.push("");
  z.push(`Kandidaten des Seeds: ${kand.length} Paare, schwächster ${minKand.toFixed(3)}.`);
  z.push(`Nicht-Kandidaten ab 0,30: ${fremd.length} Paare, stärkster ${maxFremd.toFixed(3)} (${fremd[0] ? `${fremd[0].a} · ${fremd[0].b}` : "–"}).`);
  const neuStark = paare.filter((p) => p.gleichePlz && p.teilmenge && dublettenGrad(p.sim, p.gleichePlz) !== "stark");
  z.push(`Schwellen: stark ≥ ${DUBLETTE_STARK} mit gleicher PLZ oder Sitz-Abstand ≤ 2 km, schwach ≥ ${DUBLETTE_SCHWACH}; Zusatzregel Wort-Teilmenge macht ${neuStark.length} Seed-Paar(e) neu stark${neuStark.length ? `: ${neuStark.map((p) => `${p.a} · ${p.b}`).join("; ")}` : ""}.`);
  return z.join("\n");
}

if (process.argv[1] && /dubletten-kalibrierung\.ts$/.test(process.argv[1])) {
  if (process.argv[2] === "--fixtures") {
    // Druckt die Kalibrier-Paare mit nachgerechneter Aehnlichkeit und Ergebnis als TS-Zeilen (zum Uebernehmen in dubletten-fixtures.ts).
    for (const p of kalibrierPaare()) console.log(`  { a: ${JSON.stringify(p.a)}, b: ${JSON.stringify(p.b)}, klasse: "${p.klasse}", gleicherOrt: ${p.gleicherOrt}, aehnlichkeit: ${p.gerechnet}, wortTeilmenge: ${p.teilmenge}, grad: ${p.ergebnis ? `"${p.ergebnis}"` : "null"} },`);
  } else {
  console.log("## Kalibrier-Paare (geteilte Fixture-Liste)\n");
  console.log(klassenBericht());
  console.log("## Seed-Namen: alle Paare ab 0,30\n");
  console.log(bericht());
  }
  console.log("\nFixture-Aehnlichkeiten (TS):");
  if (process.argv[2] !== "--fixtures") for (const [a, b] of AEHNLICHKEIT_FIXTURES) console.log(`${JSON.stringify(a)} · ${JSON.stringify(b)} = ${aehnlichkeit(a, b)}`);
}
