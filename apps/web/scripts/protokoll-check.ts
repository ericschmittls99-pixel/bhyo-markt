/**
 * AP2.2 PR a (protokoll-check): Das Ereignisprotokoll hat EINE Schreibstelle
 * und JEDER Schreibpfad benutzt sie. Zwei Pruefungen:
 *
 *  (a) Kein INSERT auf `aenderung` ausserhalb von lib/protokoll — weder ueber
 *      Drizzle (`insert(aenderung)`) noch als rohes SQL (`insert into aenderung`).
 *  (b) Jeder Schreibpfad (dieselbe Ermittlung wie rechte-check) ruft
 *      `protokolliere(` mit einer Art des Enums auf — im Pfad selbst, in einem
 *      lokalen Helfer oder in einer aus `@/lib/...` importierten Funktion
 *      (eine Ebene; das Protokoll darf in der Transaktion eines Bausteins
 *      sitzen, z. B. lib/bewertung.ts fuer app/api/projekte).
 *
 * Quellentextbasiert wie rechte-check: Der morgige Schreibpfad ohne Ereignis
 * soll von der CI gemeldet werden, nicht von einer leeren Inbox.
 */
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";

import { dateien, schreibpfade, type Lücke } from "./schreibpfade";

const WURZEL = process.cwd();

/** Die Arten des Enums, aus packages/db/src/schema.ts SELBST gelesen. */
function ereignisArten(wurzel: string): Set<string> {
  const quelle = readFileSync(join(wurzel, "..", "..", "packages", "db", "src", "schema.ts"), "utf8");
  const start = quelle.indexOf('pgEnum("ereignis_art"');
  if (start === -1) throw new Error("schema.ts: Enum ereignis_art nicht gefunden — Test kaputt.");
  const block = quelle.slice(start, quelle.indexOf("]);", start));
  const werte = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).filter((w) => w !== "ereignis_art" && w !== "altbestand");
  if (werte.length === 0) throw new Error("schema.ts: ereignis_art ohne Werte — Test kaputt.");
  return new Set(werte);
}

export function findeLuecken(wurzel = WURZEL): Lücke[] {
  const luecken: Lücke[] = [];
  const schreibstelle = join("lib", "protokoll", "index.ts");

  // (a) Einzige Schreibstelle.
  for (const datei of dateien(wurzel)) {
    const rel = datei.slice(wurzel.length + 1);
    if (rel === schreibstelle || rel.startsWith(`scripts${sep}`)) continue;
    const quelle = readFileSync(datei, "utf8");
    if (/\.insert\(\s*aenderung\s*\)/.test(quelle) || /insert\s+into\s+"?aenderung\b/i.test(quelle)) {
      luecken.push({ datei: rel, pfad: "(Datei)", grund: "INSERT auf aenderung ausserhalb von lib/protokoll" });
    }
  }

  // (b) Jeder Schreibpfad protokolliert mit einer Art.
  const arten = ereignisArten(wurzel);
  for (const pfad of schreibpfade(wurzel)) {
    // Benannte Ausnahme (AP2.2 PR b): Die Inbox-Aktionen aendern nur den
    // Lese-/Erledigt-Zustand der EIGENEN Eintraege — kein fachliches
    // Ereignis, deshalb kein Protokoll. Andere Pfade in lib/inbox gibt es
    // nicht (die Zustellung ist ein Baustein von protokolliere).
    if (pfad.datei === join("lib", "inbox", "actions.ts")) continue;
    const text = pfad.mitImporten;
    if (!/\bprotokolliere\s*\(/.test(text)) {
      luecken.push({ datei: pfad.datei, pfad: pfad.pfad, grund: `${pfad.artText}: kein Aufruf von protokolliere()` });
      continue;
    }
    const literale = [...text.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!).filter((l) => arten.has(l));
    if (literale.length === 0) {
      luecken.push({ datei: pfad.datei, pfad: pfad.pfad, grund: `${pfad.artText}: protokolliere() ohne Art des Enums ereignis_art als Literal` });
    }
  }
  return luecken;
}

if (process.argv[1]?.endsWith("protokoll-check.ts")) {
  const luecken = findeLuecken();
  if (luecken.length === 0) {
    console.log("protokoll-check OK — eine Schreibstelle (lib/protokoll), jeder Schreibpfad protokolliert (benannte Ausnahme: lib/inbox/actions.ts, Inbox-Zustand ist kein Ereignis).");
  } else {
    for (const l of luecken) console.error(`::error file=${l.datei}::${l.pfad} — ${l.grund}`);
    process.exit(1);
  }
}
