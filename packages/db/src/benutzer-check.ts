/**
 * F8/E30: dauerhafter DB-Check der Benutzertabelle — laeuft im Deploy-CI gegen
 * die echte Preview-DB (wie verwaltung-check und beleg-nr-check). Drei
 * Zusicherungen:
 *
 * 1. Mindestens ein AKTIVER Admin. Die Durchsetzung ist fail closed; ohne
 *    Admin kann niemand mehr Rollen vergeben — das System waere zugesperrt,
 *    und zwar ohne Fehlermeldung, die darauf hinweist.
 * 2. Alle E-Mails in Kleinschreibung. Gross-/Kleinschreibung darf nicht
 *    darueber entscheiden, ob jemand hereinkommt.
 * 3. Der CHECK greift wirklich: Ein INSERT mit Grossbuchstaben muss scheitern.
 *    Eine Regel, die nur im Schema steht und nicht geprueft wird, ist keine.
 *
 * Schreibt nichts Bleibendes: Fall 3 scheitert und rollt zurueck.
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
  console.log(`BENUTZERCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  const [z] = await sql`
    select count(*)::int as benutzer,
           count(*) filter (where rolle = 'admin' and aktiv)::int as aktive_admins,
           count(*) filter (where email <> lower(email))::int as falsche_schreibweise,
           count(*) filter (where not aktiv)::int as inaktive,
           count(*) filter (where id is null)::int as ohne_id,
           count(distinct id)::int as ids
    from benutzer`;
  console.log("BENUTZER " + JSON.stringify(z));
  // AP2.1 PR b0: jede Zeile traegt eine eindeutige ID (Migration 0024).
  if (z!.ohne_id > 0) fehler.push(`${z!.ohne_id} Benutzer ohne id`);
  if (z!.ids !== z!.benutzer) fehler.push("benutzer.id nicht eindeutig");
  if (z!.aktive_admins < 1) fehler.push("kein aktiver Admin — Zugang waere gesperrt");
  if (z!.falsche_schreibweise > 0) {
    fehler.push(`${z!.falsche_schreibweise} E-Mail(s) nicht in Kleinschreibung`);
  }

  // (3) Der CHECK muss greifen, nicht nur dastehen.
  let abgewiesen = false;
  try {
    await sql`insert into benutzer (email, rolle) values ('Gross.Schreibung@bhyo.de', 'betrachter')`;
    // Kam der INSERT durch, sofort wieder entfernen — der Check hinterlaesst nichts.
    await sql`delete from benutzer where email = 'Gross.Schreibung@bhyo.de'`;
  } catch {
    abgewiesen = true;
  }
  console.log(`GROSSSCHREIBUNG_ABGEWIESEN ${abgewiesen}`);
  if (!abgewiesen) fehler.push("CHECK benutzer_email_lower_check greift nicht");

  await sql.end();
  if (fehler.length) {
    console.error("::error::BENUTZER-CHECK VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("Benutzer-Check OK.");
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
