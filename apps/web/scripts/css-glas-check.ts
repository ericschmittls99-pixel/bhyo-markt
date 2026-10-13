/**
 * Glas-Blur im Build (Befund 12.10.2026, E77 R3): Das Quell-CSS fuehrte
 * `backdrop-filter` und danach `-webkit-backdrop-filter`; der CSS-Minifier
 * des Builds (Lightning CSS) fasst beide als eine Eigenschaft zusammen und
 * gab nur die -webkit-Form aus. Chrome wendet `-webkit-backdrop-filter`
 * nicht an (gemessen: computed backdrop-filter = none) — der Glas-Blur
 * fehlte damit app-weit in Chrome. Jetzt steht im Quell-CSS nur die
 * unpraefixte Eigenschaft; Praefixe setzt der Build nach Zielbrowsern.
 *
 * Dieser Check liest das gebaute CSS und verlangt: jede Datei mit
 * `-webkit-backdrop-filter:` enthaelt mindestens ebenso viele unpraefixte
 * `backdrop-filter:`, und insgesamt gibt es unpraefixte Vorkommen.
 * Aufrufer: deploy.yml nach dem Build (Schutz braucht Aufrufer).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface GlasBefund {
  datei: string;
  unpraefixt: number;
  webkit: number;
}

/** Zaehlt unpraefixte und -webkit-Vorkommen in einem CSS-Text (reine Funktion, getestet). */
export function zaehleBackdrop(css: string): { unpraefixt: number; webkit: number } {
  const webkit = (css.match(/-webkit-backdrop-filter\s*:/g) ?? []).length;
  const alle = (css.match(/backdrop-filter\s*:/g) ?? []).length;
  return { unpraefixt: alle - webkit, webkit };
}

/** Dateien, die den Check NICHT bestehen (leer = gruen). */
export function pruefeGlas(befunde: GlasBefund[]): string[] {
  const fehler: string[] = [];
  if (befunde.reduce((n, b) => n + b.unpraefixt, 0) === 0) fehler.push("kein unpraefixtes backdrop-filter im Build");
  for (const b of befunde) {
    if (b.webkit > 0 && b.unpraefixt < b.webkit) fehler.push(`${b.datei}: ${b.webkit} -webkit-, nur ${b.unpraefixt} unpraefixt`);
  }
  return fehler;
}

function cssDateien(wurzel: string): string[] {
  const aus: string[] = [];
  const lauf = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) lauf(p);
      else if (n.endsWith(".css")) aus.push(p);
    }
  };
  lauf(wurzel);
  return aus;
}

if (process.argv[1] && /css-glas-check\.ts$/.test(process.argv[1])) {
  const wurzel = process.argv[2] ?? ".open-next/assets/_next/static";
  const dateien = cssDateien(wurzel);
  const befunde = dateien.map((d) => ({ datei: d, ...zaehleBackdrop(readFileSync(d, "utf8")) })).filter((b) => b.unpraefixt + b.webkit > 0);
  for (const b of befunde) console.log(`CSS-GLAS ${b.datei}: unpraefixt=${b.unpraefixt} webkit=${b.webkit}`);
  const fehler = pruefeGlas(befunde);
  if (fehler.length) {
    console.error(`CSS-GLAS ROT — ${fehler.join("; ")}`);
    process.exit(1);
  }
  console.log(`CSS-GLAS OK — ${dateien.length} Dateien, ${befunde.reduce((n, b) => n + b.unpraefixt, 0)} unpraefixte backdrop-filter.`);
}
