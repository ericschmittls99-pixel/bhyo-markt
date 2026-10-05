/**
 * Eigener Migrations-Runner (Betriebs-PR, Eric 05.10.2026). Ersetzt
 * `drizzle-kit migrate`, das Fehler schluckt („applying migrations…" und
 * Exit 1, ohne Statement, Code oder Meldung — erlebt am 04.10.2026 mit der
 * tmp-PR-Migration auf der Preview).
 *
 * Gleiches Verfahren wie drizzle-kit: drizzle-orm/postgres-js/migrator liest
 * migrations/meta/_journal.json, wendet fehlende Migrationen in EINER
 * Transaktion an und fuehrt drizzle.__drizzle_migrations fort (gleiche
 * Tabelle, gleiche Hashes). Unterschiede:
 *   - NOTICE-Zeilen der Migrationen (Zaehlbeweise) werden als `NOTICE …`
 *     ausgegeben, nicht als Objekt-Dump;
 *   - ein Fehler wird mit Statement (query), Postgres-Code, Meldung und
 *     Detail/Hinweis ausgegeben und endet mit Exit 1;
 *   - Zielnachweis (Host, Datenbank) vor dem Lauf wie bei den DB-Checks.
 *
 * Aufruf: tsx src/migrieren.ts   (DATABASE_URL aus der Umgebung)
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

interface PgFehler {
  code?: string;
  message?: string;
  detail?: string;
  hint?: string;
  query?: string;
  position?: string;
  schema_name?: string;
  table_name?: string;
  constraint_name?: string;
  where?: string;
}

/**
 * Fehlertext mit allem, was Postgres mitgibt — nie nur „Exit 1". drizzle
 * verpackt den Postgres-Fehler (DrizzleQueryError mit `cause`); Code, Detail
 * und Position stehen in der Ursache, das Statement im Mantel. Beides wird
 * zusammengefuehrt (Rot-Nachweis 05.10.2026 zeigte sonst „Code: –").
 */
export function fehlerBericht(f: unknown): string {
  const mantel = (f ?? {}) as PgFehler & { cause?: unknown };
  const ursache = (mantel.cause ?? {}) as PgFehler;
  const e: PgFehler = { ...mantel, ...Object.fromEntries(Object.entries(ursache).filter(([, v]) => v !== undefined)) };
  if (!e.query && mantel.query) e.query = mantel.query;
  // `message` eines Error ist nicht aufzaehlbar — ausdruecklich uebernehmen.
  e.message = ursache.message ?? mantel.message;
  const zeilen = [
    `Meldung:   ${e.message ?? String(f)}`,
    `Code:      ${e.code ?? "–"}`,
    `Detail:    ${e.detail ?? "–"}`,
    `Hinweis:   ${e.hint ?? "–"}`,
    `Kontext:   ${e.where ?? "–"}`,
    `Objekt:    ${[e.schema_name, e.table_name, e.constraint_name].filter(Boolean).join(".") || "–"}`,
    `Position:  ${e.position ?? "–"}`,
    `Statement: ${e.query ? e.query.trim().slice(0, 2000) : "–"}`,
  ];
  return zeilen.join("\n");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("::error::MIGRATION ROT: DATABASE_URL fehlt.");
    process.exit(2);
  }
  const ziel = new URL(url);
  console.log(`MIGRATION host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const client = postgres(url, {
    max: 1,
    fetch_types: false,
    onnotice: (n) => console.log(`NOTICE ${n.message}`),
  });
  const db = drizzle(client);
  const ordner = new URL("../migrations", import.meta.url).pathname;
  try {
    const [vorher] = await client`select count(*)::int as n from drizzle.__drizzle_migrations`.catch(() => [{ n: 0 }]);
    await migrate(db, { migrationsFolder: ordner });
    const [nachher] = await client`select count(*)::int as n, max(created_at) as letzte from drizzle.__drizzle_migrations`;
    console.log(`MIGRATION OK — angewendet vorher=${vorher!.n} nachher=${nachher!.n} (neu: ${nachher!.n - vorher!.n}).`);
  } catch (f) {
    console.error("::error::MIGRATION ROT — nichts angewendet (Transaktion zurueckgerollt).");
    console.error(fehlerBericht(f));
    await client.end().catch(() => {});
    process.exit(1);
  }
  await client.end();
}

if (process.argv[1]?.endsWith("migrieren.ts")) {
  void main();
}
