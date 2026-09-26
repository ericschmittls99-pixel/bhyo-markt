/**
 * Go-live: Nachweis der Wiederherstellung. Vergleicht nach einem
 * pg_restore die Zeilenzahl JEDER Tabelle im Schema public zwischen dem
 * Restore-Ziel (RESTORE_DATABASE_URL, ein Neon-Branch) und Production
 * (DATABASE_URL, die Leserolle). Dazu Migrationsstand, PostGIS und die
 * Enum-Werte auf beiden Seiten.
 *
 * Tabellenliste aus information_schema, nicht von Hand — eine neue Tabelle
 * kann so nicht unbemerkt aus dem Vergleich fallen.
 *
 * Abbruch (Exit 1), wenn dem Restore eine Tabelle fehlt oder der
 * Migrationsstand abweicht. Abweichende Zeilenzahlen werden ausgewiesen,
 * brechen aber nicht ab: Der Dump ist von 02:00 UTC, Production kann sich
 * seither veraendert haben — das Ergebnis gehoert in den Bericht.
 *
 * Nur lesend auf beiden Seiten.
 */
import postgres from "postgres";

const restoreUrl = process.env.RESTORE_DATABASE_URL;
const prodUrl = process.env.DATABASE_URL;
if (!restoreUrl || !prodUrl) {
  console.error("RESTORE_DATABASE_URL und DATABASE_URL (Production, lesend) sind Pflicht.");
  process.exit(2);
}
const restoreHost = new URL(restoreUrl).hostname;
if (restoreHost.startsWith("ep-purple-glade") || restoreHost.startsWith("ep-rough-term")) {
  console.error(`::error::RESTORE_DATABASE_URL zeigt auf ${restoreHost} — das ist Production oder Preview, kein Restore-Ziel. Abbruch.`);
  process.exit(1);
}

const restore = postgres(restoreUrl, { max: 1, fetch_types: false });
const prod = postgres(prodUrl, { max: 1, fetch_types: false });

async function tabellen(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`;
  return rows.map((r) => r.table_name as string);
}

async function zaehle(sql: postgres.Sql, t: string): Promise<number> {
  const [r] = await sql`select count(*)::int as n from ${sql(t)}`;
  return r!.n as number;
}

async function stand(sql: postgres.Sql) {
  const [m] = await sql`select count(*)::int as n, max(created_at)::text as zuletzt from drizzle.__drizzle_migrations`;
  const [p] = await sql`select extversion from pg_extension where extname = 'postgis'`;
  const enums = await sql`
    select t.typname as enum, string_agg(e.enumlabel, ',' order by e.enumsortorder) as werte
      from pg_type t join pg_enum e on e.enumtypid = t.oid
     where t.typnamespace = 'public'::regnamespace group by t.typname order by t.typname`;
  return { migrationen: m!.n as number, zuletzt: m!.zuletzt as string, postgis: (p?.extversion as string) ?? null, enums: enums.map((e) => `${e.enum}=${e.werte}`) };
}

async function main() {
  console.log(`RESTORE host=${restoreHost}`);
  console.log(`PRODUCTION host=${new URL(prodUrl!).hostname} (lesend)`);
  const fehler: string[] = [];

  const [tRestore, tProd] = await Promise.all([tabellen(restore), tabellen(prod)]);
  const fehlend = tProd.filter((t) => !tRestore.includes(t));
  const zusaetzlich = tRestore.filter((t) => !tProd.includes(t));
  if (fehlend.length) fehler.push(`Tabellen fehlen im Restore: ${fehlend.join(", ")}`);
  if (zusaetzlich.length) console.log(`HINWEIS zusaetzliche Tabellen im Restore: ${zusaetzlich.join(", ")}`);

  console.log("ZAEHLUNG tabelle | production | restore | differenz");
  let abweichungen = 0;
  for (const t of tProd) {
    if (!tRestore.includes(t)) continue;
    const [np, nr] = await Promise.all([zaehle(prod, t), zaehle(restore, t)]);
    const diff = nr - np;
    if (diff !== 0) abweichungen++;
    console.log(`  ${t} | ${np} | ${nr} | ${diff === 0 ? "gleich" : diff > 0 ? `+${diff}` : diff}`);
  }
  console.log(`ABWEICHUNGEN ${abweichungen} von ${tProd.length} Tabellen (Dump von 02:00 UTC; Aenderungen seither sind erwartbar)`);

  const [sr, sp] = await Promise.all([stand(restore), stand(prod)]);
  console.log("STAND production " + JSON.stringify(sp));
  console.log("STAND restore    " + JSON.stringify(sr));
  if (sr.migrationen !== sp.migrationen) fehler.push(`Migrationsstand: Restore ${sr.migrationen}, Production ${sp.migrationen}`);
  if (!sr.postgis) fehler.push("PostGIS fehlt im Restore");
  if (sr.enums.join("|") !== sp.enums.join("|")) fehler.push("Enum-Werte weichen ab");

  await Promise.all([restore.end(), prod.end()]);
  if (fehler.length) {
    console.error("::error::RESTORE-NACHWEIS VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("Restore-Nachweis OK: alle Tabellen vorhanden, Migrationsstand, PostGIS und Enums gleich.");
}

void main().catch(async (e) => {
  console.error(e);
  await Promise.all([restore.end(), prod.end()]);
  process.exit(2);
});
