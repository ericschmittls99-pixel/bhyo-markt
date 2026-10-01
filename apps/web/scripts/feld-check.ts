/**
 * AP2.4 PR a (E62, D6): Waechter der Feldeinstufung — jede Spalte der vier
 * Tabellen im Drizzle-Schema hat genau eine Einstufung in
 * lib/feldeinstufung.ts (fachlich / redaktionell / technisch), und keine
 * Einstufung nennt eine Spalte, die es nicht mehr gibt. Eine neue Spalte
 * ohne Einstufung macht den Lauf rot — wie die Export-Einstufung (E36).
 * Laeuft im CI (typen-und-tests) und als Vitest-Fall (lib/feldeinstufung.test.ts).
 */
import { beleg, biomassestrom, outputBedarf, vergabeZeitraum } from "@bhyo/db/schema";
import { getTableColumns } from "drizzle-orm";

import { FELD_EINSTUFUNG, type FeldTabelle } from "../lib/feldeinstufung";

const TABELLEN: Record<FeldTabelle, Record<string, { name: string }>> = {
  biomassestrom: getTableColumns(biomassestrom),
  output_bedarf: getTableColumns(outputBedarf),
  beleg: getTableColumns(beleg),
  vergabe_zeitraum: getTableColumns(vergabeZeitraum),
};

export interface FeldLuecke {
  tabelle: FeldTabelle;
  spalte: string;
  grund: "ohne Einstufung" | "Einstufung ohne Spalte";
}

export function findeFeldLuecken(): FeldLuecke[] {
  const luecken: FeldLuecke[] = [];
  for (const tabelle of Object.keys(TABELLEN) as FeldTabelle[]) {
    const spalten = Object.values(TABELLEN[tabelle]).map((c) => c.name);
    const eingestuft = Object.keys(FELD_EINSTUFUNG[tabelle]);
    for (const sp of spalten) if (!eingestuft.includes(sp)) luecken.push({ tabelle, spalte: sp, grund: "ohne Einstufung" });
    for (const sp of eingestuft) if (!spalten.includes(sp)) luecken.push({ tabelle, spalte: sp, grund: "Einstufung ohne Spalte" });
  }
  return luecken;
}

if (process.argv[1] && /feld-check\.ts$/.test(process.argv[1])) {
  const luecken = findeFeldLuecken();
  if (luecken.length) {
    for (const l of luecken) console.error(`::error::${l.tabelle}.${l.spalte} — ${l.grund}`);
    console.error(`feld-check VERLETZT: ${luecken.length} Luecke(n) in der Feldeinstufung (lib/feldeinstufung.ts).`);
    process.exit(1);
  }
  const n = (Object.keys(TABELLEN) as FeldTabelle[]).reduce((a, t) => a + Object.keys(TABELLEN[t]).length, 0);
  console.log(`feld-check OK — ${n} Spalten in 4 Tabellen, jede genau einmal eingestuft.`);
}
