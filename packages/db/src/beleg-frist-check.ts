/**
 * E33 Schritt 3: Fristen-Vorpruefung und Nachweis fuer den CHECK
 * beleg_gueltig_bis_check (Migration 0022) — gegen die echte Datenbank.
 *
 * VOR der Migration (Constraint fehlt noch): Bricht ab, wenn ein Beleg der
 * oberen vier Typen ohne gueltig_bis existiert, und nennt die Belegnummern.
 * Laeuft in deploy.yml (Preview, vor "Migrate Preview-DB") und in
 * migrate-production.yml (vor "Migrate Production-DB"), damit kein Lauf in
 * eine Migration geht, die scheitern muss — und weil die Migration selbst
 * keinen Fachwert schreibt, ist Nachtragen in der Anwendung der einzige Weg.
 *
 * NACH der Migration (Constraint da): Der CHECK muss GREIFEN — ein Vertrag
 * ohne Datum wird abgewiesen, ein Gespraech ohne Datum geht durch (beides in
 * zurueckgerollten Transaktionen). Und der Bestand ist leer an Verstoessen,
 * was der Constraint garantiert und der Zaehler zeigt.
 *
 * Schreibt nichts Bleibendes.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });

const OBERE_VIER = ["betriebsdaten", "vertrag", "absichtserklaerung", "angebot"];
const ROLLBACK = Symbol("rollback");

async function probe(fn: (tx: postgres.TransactionSql) => Promise<void>): Promise<string | null> {
  try {
    await sql.begin(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
    return null;
  } catch (e) {
    if (e === ROLLBACK) return null;
    return e instanceof Error ? e.message.split("\n")[0]! : String(e);
  }
}

async function main() {
  const ziel = new URL(url!);
  console.log(`FRISTCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  const ohne = await sql`
    select beleg_nr, typ::text as typ, metadata->>'seed' is not null as seed
      from beleg
     where typ::text in ${sql(OBERE_VIER)} and gueltig_bis is null
     order by beleg_nr`;
  const [z] = await sql`
    select count(*)::int as belege,
           count(*) filter (where typ::text in ${sql(OBERE_VIER)})::int as obere_vier
      from beleg`;
  console.log(`BESTAND belege=${z!.belege} obere_vier=${z!.obere_vier} ohne_gueltig_bis=${ohne.length}`);
  if (ohne.length) {
    console.log("OHNE_DATUM " + ohne.map((o) => `${o.beleg_nr}(${o.typ}${o.seed ? ", seed" : ""})`).join(", "));
  }

  const [c] = await sql`
    select count(*)::int as n from pg_constraint
     where conname = 'beleg_gueltig_bis_check' and conrelid = 'beleg'::regclass`;
  const constraintDa = (c!.n as number) > 0;
  console.log(`CONSTRAINT_VORHANDEN ${constraintDa}`);

  if (!constraintDa) {
    // Vorpruefung: nur der Bestand entscheidet.
    if (ohne.length) {
      fehler.push(
        `${ohne.length} Beleg(e) der oberen vier Typen ohne gueltig_bis — Migration 0022 wuerde scheitern. ` +
          `Erst in der Anwendung nachtragen (Belegnummern oben), nichts migrieren.`,
      );
    } else {
      console.log("Vorpruefung OK: keine Zeile ohne Datum — Migration 0022 darf laufen.");
    }
  } else {
    // Nachweis: der CHECK greift in beide Richtungen.
    const abgewiesen = await probe(async (tx) => {
      await tx`insert into beleg (typ, metadata) values ('vertrag', ${tx.json({ quellenangabe: "Frist-Check E33" })})`;
    });
    const greift = abgewiesen !== null && abgewiesen.includes("beleg_gueltig_bis_check");
    console.log(`CHECK_GREIFT vertrag_ohne_datum abgewiesen=${greift}${abgewiesen ? ` grund="${abgewiesen}"` : ""}`);
    if (!greift) fehler.push("Vertrag ohne gueltig_bis wurde NICHT abgewiesen");

    const durch = await probe(async (tx) => {
      await tx`insert into beleg (typ, metadata) values ('gespraech', ${tx.json({ quellenangabe: "Frist-Check E33" })})`;
    });
    console.log(`CHECK_LAESST_DURCH gespraech_ohne_datum ok=${durch === null}${durch ? ` grund="${durch}"` : ""}`);
    if (durch !== null) fehler.push(`Gespraech ohne gueltig_bis wurde abgewiesen: ${durch}`);

    if (ohne.length) fehler.push(`${ohne.length} Zeilen verletzen den CHECK trotz Constraint — unplausibel, pruefen`);
  }

  await sql.end();
  if (fehler.length) {
    console.error("::error::FRISTEN-CHECK VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("Fristen-Check OK.");
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
