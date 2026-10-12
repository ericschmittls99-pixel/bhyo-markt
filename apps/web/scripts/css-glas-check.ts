/**
 * Glas-Blur im Build (Befund 12.10.2026, E77 R3): Das Quell-CSS fuehrte
 * `backdrop-filter` und danach `-webkit-backdrop-filter`; der CSS-Minifier
 * des Builds (Lightning CSS) fasst beide als eine Eigenschaft zusammen und
 * gab nur die -webkit-Form aus. Chrome wendet `-webkit-backdrop-filter`
 * nicht an (gemessen: computed backdrop-filter = none) — der Glas-Blur
 * fehlte damit app-weit in Chrome. Jetzt steht im Quell-CSS nur die
 * unpraefixte Eigenschaft; Praefixe setzt der Build nach Zielbrowsern.
 *
 * Dieser Check liest das gebaute CSS und verlangt (Bedingung Eric 12.10.2026):
 * in jeder Regel mit backdrop-filter stehen BEIDE Formen, -webkit- vor
 * unpraefixt (pruefeRegeln); dazu die Summen je Datei (pruefeGlas).
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

/**
 * Bedingung Eric 12.10.2026: in JEDER Regel des gebauten CSS, die backdrop-filter
 * setzt, stehen beide Formen — `-webkit-backdrop-filter` VOR `backdrop-filter`
 * (Safari liest die praefixte Form, Chrome die unpraefixte; die spaetere
 * gewinnt bei gleicher Eigenschaft, deshalb die Reihenfolge).
 * Liefert je Verstoss den Regelanfang (Selektor) — leer = gruen.
 */
export function pruefeRegeln(css: string, datei = ""): string[] {
  const fehler: string[] = [];
  // Regelbloecke grob trennen: alles bis zur schliessenden Klammer; @media-Huellen
  // stoeren nicht, weil nur Bloecke mit backdrop-filter betrachtet werden.
  for (const block of css.split("}")) {
    if (!/backdrop-filter\s*:/.test(block)) continue;
    const selektor = block.slice(0, block.indexOf("{")).trim().slice(-60);
    const webkit = block.search(/-webkit-backdrop-filter\s*:/);
    const unpraefixt = block.search(/(^|[^-])backdrop-filter\s*:/);
    const ort = `${datei ? datei + " " : ""}${selektor}`;
    if (webkit < 0) fehler.push(`${ort}: -webkit-backdrop-filter fehlt`);
    else if (unpraefixt < 0) fehler.push(`${ort}: backdrop-filter (unpraefixt) fehlt`);
    else if (webkit > unpraefixt) fehler.push(`${ort}: -webkit-backdrop-filter muss vor backdrop-filter stehen`);
  }
  return fehler;
}

/** Summen ueber alle Dateien: ohne unpraefixte Vorkommen ist der Build rot. */
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
  const texte = new Map(dateien.map((d) => [d, readFileSync(d, "utf8")]));
  const befunde = dateien.map((d) => ({ datei: d, ...zaehleBackdrop(texte.get(d)!) })).filter((b) => b.unpraefixt + b.webkit > 0);
  for (const b of befunde) console.log(`CSS-GLAS ${b.datei}: unpraefixt=${b.unpraefixt} webkit=${b.webkit}`);
  const fehler = [...pruefeGlas(befunde), ...befunde.flatMap((b) => pruefeRegeln(texte.get(b.datei)!, b.datei))];
  // Beleg fuer den Bericht: die erste Regel mit beiden Formen im Klartext.
  for (const b of befunde) {
    const m = texte.get(b.datei)!.match(/[^{}]{0,80}\{[^{}]*-webkit-backdrop-filter:[^{}]*\}/);
    if (m) { console.log(`CSS-GLAS Beispiel: ${m[0].trim().slice(0, 300)}`); break; }
  }
  if (fehler.length) {
    console.error(`CSS-GLAS ROT — ${fehler.join("; ")}`);
    process.exit(1);
  }
  console.log(`CSS-GLAS OK — ${dateien.length} Dateien, ${befunde.reduce((n, b) => n + b.unpraefixt, 0)} unpraefixte backdrop-filter.`);
}
