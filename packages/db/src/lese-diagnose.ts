/**
 * Leseweg auf Production (Entscheidung Eric, 24.09.2026, Variante b).
 *
 * Zweck: Zielnachweis und Abweichungslisten sollen VOR einem Merge laufen
 * können, also von einem Branch, der nicht `main` ist. Das Environment
 * `production` lässt das nicht zu — seine Branch-Policy erlaubt nur `main`,
 * und zwar auch für rein lesende Jobs. Statt den schreibenden Zugang
 * aufzuweichen, gibt es eine zweite Zugangsberechtigung, die nichts anderes
 * kann als lesen.
 *
 * Die entscheidende Zusicherung prüft dieses Skript SELBST: Es versucht im
 * selben Lauf zu schreiben und muss daran scheitern. Eine Rolle, von der nur
 * behauptet wird, sie sei lesend, ist keine Zusicherung — sie ist eine
 * Annahme über eine Einstellung, die jemand später ändern kann.
 *
 * Schreibender Zugriff auf Production bleibt ausschließlich über `main`
 * möglich (Environment `production` + ziel-wache in migrate-production.yml).
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt — Secret DATABASE_URL_PRODUCTION_LESEND gesetzt?");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });

/** Tabelle für den Schreibversuch: fachlich, vorhanden, unverfänglich. */
const PROBE_TABELLE = "aenderung";

async function main() {
  const ziel = new URL(url!);
  const fehler: string[] = [];

  // --- Zielnachweis im gewohnten Format, plus die Rolle ---------------------
  // Die Rolle kommt aus der Verbindung selbst, nicht aus einer Konstante:
  // So beschreibt das Log, womit tatsächlich verbunden wurde.
  const [wer] = await sql`select current_user as rolle, current_database() as db`;
  console.log(
    `LESEND host=${ziel.hostname} db=${wer!.db} rolle=${wer!.rolle}`,
  );

  if (!ziel.hostname.startsWith("ep-purple-glade")) {
    console.error(
      `::error::Nicht der Production-Endpoint (${ziel.hostname}) — erwartet ep-purple-glade-*. Abbruch.`,
    );
    process.exit(1);
  }

  // --- Kontrollzählung und Migrationsstand ----------------------------------
  const [z] = await sql`
    select (select count(*) from materialart)::int    as materialarten,
           (select count(*) from output_produkt)::int as produkte,
           (select count(*) from biomassestrom)::int  as feedstock,
           (select count(*) from output_bedarf)::int  as outputs,
           (select count(*) from benutzer)::int       as benutzer`;
  console.log("KONTROLLE " + JSON.stringify(z));

  // Neon-Kontingent (Go-live, 28.09.2026): Datenbankgroesse und die groessten
  // Tabellen — rein lesend, gehoert in die Kontingent-Tabelle des Berichts.
  const [groesse] = await sql`select pg_size_pretty(pg_database_size(current_database())) as db`;
  const tabellen = await sql`
    select relname as tabelle, pg_size_pretty(pg_total_relation_size(c.oid)) as gesamt,
           pg_total_relation_size(c.oid) as bytes
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by pg_total_relation_size(c.oid) desc limit 6`;
  console.log(`GROESSE db=${groesse!.db} | ` + tabellen.map((t) => `${t.tabelle}=${t.gesamt}`).join(" "));

  const [m] = await sql`
    select count(*)::int as migrationen,
           max(created_at)::text as zuletzt
      from drizzle.__drizzle_migrations`;
  console.log("MIGRATIONEN " + JSON.stringify(m));

  // --- Standardrechte: gelten sie fuer die MIGRIERENDE Rolle? --------------
  // Standardrechte (ALTER DEFAULT PRIVILEGES) gelten pro vergebender Rolle.
  // Sind sie fuer die falsche gesetzt, hat die Leserolle auf jede KUENFTIG
  // migrierte Tabelle kein SELECT — und das faellt genau dann auf, wenn der
  // Leseweg fuer den Zielnachweis vor einer Migration gebraucht wird.
  // Deshalb wird es hier gemessen, nicht angenommen (Review Eric, 24.09.2026).
  const [besitzer] = await sql`
    select tableowner as rolle from pg_tables where tablename = 'biomassestrom'`;
  const standard = await sql`
    select n.nspname as schema,
           pg_get_userbyid(d.defaclrole) as vergeber,
           array_to_string(d.defaclacl, ' ') as rechte
      from pg_default_acl d
      join pg_namespace n on n.oid = d.defaclnamespace
     where d.defaclobjtype = 'r'`;
  console.log(`TABELLENBESITZER ${besitzer!.rolle}`);
  console.log("STANDARDRECHTE " + JSON.stringify(standard));

  for (const schema of ["public", "drizzle"]) {
    const treffer = standard.find(
      (d) =>
        d.schema === schema &&
        d.vergeber === besitzer!.rolle &&
        String(d.rechte).includes(`${wer!.rolle}=r/`),
    );
    if (!treffer) {
      fehler.push(
        `Standardrechte fuer Schema ${schema} fehlen oder gelten nicht fuer ${besitzer!.rolle} — ` +
          `kuenftige Tabellen waeren fuer ${wer!.rolle} nicht lesbar`,
      );
    }
  }

  // --- Die Zusicherung: Schreiben MUSS scheitern ----------------------------
  // Zwei Wege, weil ein fehlendes INSERT-Recht nicht automatisch ein fehlendes
  // UPDATE-Recht bedeutet — beide werden einzeln geprueft.
  for (const [was, versuch] of [
    [
      "INSERT",
      () => sql`
        insert into ${sql(PROBE_TABELLE)} (entitaet_typ, entitaet_id, text)
        values ('lesetest', gen_random_uuid(), 'darf nicht gelingen')`,
    ],
    [
      "UPDATE",
      () => sql`update ${sql(PROBE_TABELLE)} set text = text where false`,
    ],
  ] as const) {
    let abgewiesen = false;
    let meldung = "";
    try {
      await versuch();
    } catch (e) {
      abgewiesen = true;
      meldung = e instanceof Error ? e.message.split("\n")[0]! : String(e);
    }
    console.log(
      `SCHREIBVERSUCH ${was} abgewiesen=${abgewiesen}${meldung ? ` grund="${meldung}"` : ""}`,
    );
    if (!abgewiesen) {
      fehler.push(
        `${was} auf ${PROBE_TABELLE} ist GELUNGEN — die Rolle ${wer!.rolle} hat zu viele Rechte`,
      );
    }
  }

  await sql.end();

  if (fehler.length) {
    const nachSql = fehler.some((f) => f.startsWith("Standardrechte"))
      ? `\nNachzutragen im Neon SQL Editor (als ${besitzer!.rolle} oder Eigentuemer):\n` +
        ["public", "drizzle"]
          .map(
            (sch) =>
              `ALTER DEFAULT PRIVILEGES FOR ROLE ${besitzer!.rolle} IN SCHEMA ${sch} GRANT SELECT ON TABLES TO ${wer!.rolle};`,
          )
          .join("\n")
      : "";
    console.error(
      "::error title=LESEWEG UNVOLLSTAENDIG::" +
        fehler.join(" · ") +
        ". Diese Zugangsberechtigung darf ausschliesslich SELECT koennen — " +
        "aber auf alles Fachliche, auch auf kuenftig migrierte Tabellen." +
        nachSql,
    );
    process.exit(1);
  }
  console.log("Leseweg OK — Zielnachweis gedruckt, Schreiben abgewiesen.");
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
