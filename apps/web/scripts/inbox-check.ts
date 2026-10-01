/**
 * AP2.2 PR b (inbox-check): inbox_eintrag hat EINE Schreibstelle — lib/inbox.
 * Kein INSERT/UPDATE auf inbox_eintrag ausserhalb, weder ueber Drizzle
 * (`insert(inboxEintrag)`, `update(inboxEintrag)`) noch als rohes SQL.
 * Quellentextbasiert wie protokoll-check; Tests und scripts/ ausgenommen.
 */
import { readFileSync } from "node:fs";
import { sep } from "node:path";

import { dateien, type Lücke } from "./schreibpfade";

const WURZEL = process.cwd();

export function findeLuecken(wurzel = WURZEL): Lücke[] {
  const luecken: Lücke[] = [];
  for (const datei of dateien(wurzel)) {
    const rel = datei.slice(wurzel.length + 1);
    if (rel.startsWith(`lib${sep}inbox${sep}`) || rel.startsWith(`scripts${sep}`)) continue;
    const quelle = readFileSync(datei, "utf8");
    if (/\.(insert|update)\(\s*inboxEintrag\s*\)/.test(quelle) || /(insert\s+into|update)\s+"?inbox_eintrag\b/i.test(quelle)) {
      luecken.push({ datei: rel, pfad: "(Datei)", grund: "INSERT/UPDATE auf inbox_eintrag ausserhalb von lib/inbox" });
    }
  }
  // AP2.5 PR b (E57): Der Loeschpruefungs-Hinweis traegt nur die ID der Person —
  // ein INSERT in lib/inbox, der diesen Typ nennt, darf weder notiz noch aufgabe setzen.
  for (const datei of dateien(wurzel)) {
    const rel = datei.slice(wurzel.length + 1);
    if (!rel.startsWith(`lib${sep}inbox${sep}`) || /\.test\.tsx?$/.test(rel)) continue;
    const quelle = readFileSync(datei, "utf8");
    for (const m of quelle.matchAll(/insert\s+into\s+inbox_eintrag\s*\(([^)]*)\)([\s\S]*?)(?:returning|$)/gi)) {
      if (!/kontaktperson_loeschpruefung/.test(m[2]!)) continue;
      if (/\b(notiz|aufgabe)\b/.test(m[1]!)) luecken.push({ datei: rel, pfad: "(Datei)", grund: "E57: Loeschpruefungs-Hinweis mit Freitext (notiz/aufgabe) — nur die ID der Person" });
    }
  }
  return luecken;
}

if (process.argv[1]?.endsWith("inbox-check.ts")) {
  const luecken = findeLuecken();
  if (luecken.length === 0) {
    console.log("inbox-check OK — inbox_eintrag wird nur in lib/inbox geschrieben.");
  } else {
    for (const l of luecken) console.error(`::error file=${l.datei}::${l.pfad} — ${l.grund}`);
    process.exit(1);
  }
}
