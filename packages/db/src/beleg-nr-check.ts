/**
 * E28/E29: dauerhafter DB-Check der Belegnummer — laeuft im Deploy-CI gegen
 * die echte Preview-DB (wie der Verwaltungs-Check). Drei Zusicherungen:
 *
 * 1. Vollstaendigkeit und Eindeutigkeit: Belege = befuellte Nummern =
 *    verschiedene Nummern, und jede Nummer passt auf B-000000.
 * 2. Der Unveraenderlichkeits-Trigger prueft `IS DISTINCT FROM`, nicht die
 *    blosse Anwesenheit der Spalte im UPDATE: Ein UPDATE, das beleg_nr mit
 *    DEMSELBEN Wert mitschreibt, geht durch (Review Eric, 23.09.2026) —
 *    sonst braeche jedes ORM, das alle Spalten mitschickt.
 * 3. Eine echte Aenderung scheitert.
 *
 * Schreibt nichts Bleibendes: Fall 2 ist ein No-Op-UPDATE auf einer
 * bestehenden Zeile, Fall 3 scheitert und rollt zurueck.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });

async function main() {
  const ziel = new URL(url!);
  console.log(`BELEGNRCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  const [z] = await sql`
    select count(*)::int as belege,
           count(beleg_nr)::int as mit_nr,
           count(distinct beleg_nr)::int as verschieden,
           count(*) filter (where beleg_nr !~ '^B-[0-9]{6}$')::int as formatfehler
    from beleg`;
  console.log("BELEGNR " + JSON.stringify(z));
  if (z!.belege !== z!.mit_nr) fehler.push(`${z!.belege - z!.mit_nr} Belege ohne Nummer`);
  if (z!.belege !== z!.verschieden) fehler.push("Nummern nicht eindeutig");
  if (z!.formatfehler) fehler.push(`${z!.formatfehler} Nummern verletzen B-000000`);

  if (z!.belege > 0) {
    const [probe] = await sql`select id, beleg_nr from beleg order by beleg_nr limit 1`;
    // (2) Gleicher Wert muss durchgehen — der Trigger darf nicht auf die
    // blosse Anwesenheit der Spalte reagieren.
    try {
      await sql`update beleg set beleg_nr = ${probe!.beleg_nr} where id = ${probe!.id}`;
      console.log("UNVERAENDERT_OK gleicher Wert geht durch");
    } catch (e) {
      fehler.push(`UPDATE mit gleichem Wert abgewiesen: ${(e as Error).message}`);
    }
    // (3) Echte Aenderung muss scheitern.
    let abgewiesen = false;
    try {
      await sql`update beleg set beleg_nr = 'B-999999' where id = ${probe!.id}`;
    } catch {
      abgewiesen = true;
    }
    console.log(`AENDERUNG_ABGEWIESEN ${abgewiesen}`);
    if (!abgewiesen) fehler.push("Aenderung der beleg_nr wurde NICHT abgewiesen");
  }

  await sql.end();
  if (fehler.length) {
    console.error("::error::BELEGNUMMER-CHECK VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("Belegnummer-Check OK.");
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
