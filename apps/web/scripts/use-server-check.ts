/**
 * use-server-check (Betrieb, Eric 09.10.2026): Dateien mit der Direktive
 * "use server" exportieren AUSSCHLIESSLICH async-Funktionen — keine
 * Konstanten, keine synchronen Funktionen, keine Re-Exports. Next.js prueft
 * das erst beim Build (Turbopack: „Server Actions must be async functions"),
 * nicht bei tsc und nicht in vitest; zweimal ist das erst auf der Preview
 * aufgefallen (use-server-Konstante → POST 500; sync-Export in
 * lib/import-actions.ts → Deploy rot, #214). Hier laeuft die Pruefung
 * statisch in typen-und-tests, auf dem TypeScript-Syntaxbaum, ohne Build.
 *
 * Erlaubt: `export async function …`, `export default async function …`,
 * reine Typ-Exporte (`export type`, `export interface`). Alles andere, was
 * `export` traegt, ist eine Luecke mit Datei und Zeile.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

export interface UseServerLuecke {
  datei: string;
  zeile: number;
  name: string;
  grund: string;
}

const ORDNER = ["app", "lib", "components"];
const ENDUNGEN = /\.(ts|tsx)$/;

function dateien(wurzel: string): string[] {
  const aus: string[] = [];
  const lauf = (d: string) => {
    let eintraege: string[] = [];
    try {
      eintraege = readdirSync(d);
    } catch {
      return;
    }
    for (const e of eintraege) {
      const p = join(d, e);
      if (e === "node_modules" || e.startsWith(".")) continue;
      const st = statSync(p);
      if (st.isDirectory()) lauf(p);
      else if (ENDUNGEN.test(e) && !/\.test\.tsx?$/.test(e)) aus.push(p);
    }
  };
  for (const o of ORDNER) lauf(join(wurzel, o));
  return aus.sort();
}

/** Traegt die Datei die Direktive "use server" am Anfang (Prolog)? */
export function istUseServer(quelle: ts.SourceFile): boolean {
  for (const st of quelle.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) {
      if (st.expression.text === "use server") return true;
      continue; // weitere Direktiven im Prolog
    }
    return false;
  }
  return false;
}

/** Luecken einer Datei: jeder Export, der keine async-Funktion und kein reiner Typ ist. */
export function pruefeDatei(pfad: string, text: string): UseServerLuecke[] {
  const quelle = ts.createSourceFile(pfad, text, ts.ScriptTarget.Latest, true, pfad.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (!istUseServer(quelle)) return [];
  const luecken: UseServerLuecke[] = [];
  const zeile = (n: ts.Node) => quelle.getLineAndCharacterOfPosition(n.getStart(quelle)).line + 1;
  // Namen, die zur Laufzeit nicht existieren: Typ-Importe (`import type`, `import { type X }`),
  // Typ-Aliase und Interfaces der Datei — ein `export { X }` darauf ist erlaubt (TS loescht es).
  const typNamen = new Set<string>();
  for (const st of quelle.statements) {
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) typNamen.add(st.name.text);
    if (ts.isImportDeclaration(st) && st.importClause) {
      const ic = st.importClause;
      if (ic.isTypeOnly) {
        if (ic.name) typNamen.add(ic.name.text);
        if (ic.namedBindings && ts.isNamedImports(ic.namedBindings)) for (const e of ic.namedBindings.elements) typNamen.add(e.name.text);
      } else if (ic.namedBindings && ts.isNamedImports(ic.namedBindings)) {
        for (const e of ic.namedBindings.elements) if (e.isTypeOnly) typNamen.add(e.name.text);
      }
    }
  }
  const hatExport = (n: ts.Node) => (ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) : false);
  const istAsync = (n: ts.Node) => (ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) : false);
  for (const st of quelle.statements) {
    if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) continue; // reine Typen, zur Laufzeit weg
    if (ts.isFunctionDeclaration(st)) {
      if (hatExport(st) && !istAsync(st)) luecken.push({ datei: pfad, zeile: zeile(st), name: st.name?.text ?? "default", grund: "synchrone Funktion exportiert" });
      continue;
    }
    if (ts.isVariableStatement(st)) {
      if (hatExport(st)) for (const d of st.declarationList.declarations) luecken.push({ datei: pfad, zeile: zeile(d), name: d.name.getText(quelle), grund: "Konstante/Variable exportiert" });
      continue;
    }
    if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      if (!st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause) && st.exportClause.elements.every((e) => e.isTypeOnly || typNamen.has((e.propertyName ?? e.name).text))) continue;
      luecken.push({ datei: pfad, zeile: zeile(st), name: st.moduleSpecifier ? `from ${st.moduleSpecifier.getText(quelle)}` : st.exportClause?.getText(quelle) ?? "*", grund: "Re-Export" });
      continue;
    }
    if (ts.isExportAssignment(st)) {
      const e = st.expression;
      const ok = (ts.isFunctionExpression(e) || ts.isArrowFunction(e)) && (ts.getModifiers(e) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (!ok) luecken.push({ datei: pfad, zeile: zeile(st), name: "default", grund: "Default-Export ist keine async-Funktion" });
      continue;
    }
    if ((ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || ts.isModuleDeclaration(st)) && hatExport(st)) {
      luecken.push({ datei: pfad, zeile: zeile(st), name: st.name?.getText(quelle) ?? "?", grund: "Klasse/Enum/Namespace exportiert" });
    }
  }
  return luecken;
}

export function pruefeUseServer(wurzel: string): { dateien: number; luecken: UseServerLuecke[] } {
  const alle = dateien(wurzel);
  let n = 0;
  const luecken: UseServerLuecke[] = [];
  for (const p of alle) {
    const text = readFileSync(p, "utf8");
    if (!/["']use server["']/.test(text.slice(0, 2000))) continue; // schneller Vorfilter, die Direktive prueft der Syntaxbaum
    const l = pruefeDatei(relative(wurzel, p), text);
    const quelle = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
    if (istUseServer(quelle)) n++;
    luecken.push(...l);
  }
  return { dateien: n, luecken };
}

if (process.argv[1] && /use-server-check\.ts$/.test(process.argv[1])) {
  const wurzel = process.env.USE_SERVER_WURZEL ?? process.cwd();
  const { dateien: n, luecken } = pruefeUseServer(wurzel);
  if (luecken.length) {
    for (const l of luecken) console.error(`::error file=apps/web/${l.datei},line=${l.zeile}::${l.datei}:${l.zeile} — ${l.name}: ${l.grund}`);
    console.error(`use-server-check VERLETZT: ${luecken.length} Export(e) in "use server"-Dateien sind keine async-Funktionen.`);
    process.exit(1);
  }
  console.log(`use-server-check OK — ${n} "use server"-Datei(en), nur async-Funktionen exportiert.`);
}
