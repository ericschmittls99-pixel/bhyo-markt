/**
 * AP2.2 PR a, Schritt 0: Messung des Protokolls `aenderung` — nur SELECT.
 *
 * Beantwortet vor der Migration 0026: Wie viele Zeilen gibt es, welche
 * Textmuster kommen vor (lässt sich die Art EINDEUTIG ableiten?), und wie
 * viele Altzeilen tragen eine E-Mail, die genau einem Benutzer entspricht?
 * Nach der Migration dient dieselbe Messung als Zielnachweis (Arten,
 * benutzer_id gesetzt/NULL). Läuft gegen Preview (Deploy-CI) und über den
 * Leseweg gegen Production (lese-diagnose.yml).
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });

/**
 * Textmuster, die der Code selbst erzeugt (ohne den Urheber-Praefix
 * "<email>: "). Alles andere ist die freie Begruendung aus dem Formular.
 */
const MUSTER: Array<[string, string]> = [
  ["ersterfassung", "^Ersterfassung$"],
  ["status_gesetzt", "^Status auf .+ gesetzt$"],
  ["verworfen", "^Strom verworfen"],
  ["gesperrt", "^Strom gesperrt$"],
  ["entsperrt", "^Strom entsperrt"],
  ["zugewiesen", " zugewiesen$"],
  ["zuweisung_entfernt", "^Zuweisung entfernt$"],
];

async function main() {
  const ziel = new URL(url!);
  console.log(`PROTOKOLLMESSUNG host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);

  const [z] = await sql`
    select count(*)::int as zeilen,
           min(zeitpunkt)::text as erste,
           max(zeitpunkt)::text as letzte,
           count(*) filter (where benutzer_email is not null)::int as mit_email,
           count(*) filter (where benutzer_email is null)::int as ohne_email,
           count(*) filter (where text ~ '^[^ :]+@[^ :]+: ')::int as mit_praefix
      from aenderung`;
  console.log("ZEILEN " + JSON.stringify(z));

  const typen = await sql`
    select entitaet_typ, count(*)::int as n from aenderung group by 1 order by 1`;
  console.log("JE_TYP " + JSON.stringify(typen));

  // Spalten, die es erst nach 0026 gibt — vorher schweigt die Messung dazu.
  const spalten = await sql`
    select column_name from information_schema.columns
     where table_name = 'aenderung' and column_name in ('art', 'benutzer_id')`;
  const nach0026 = spalten.length === 2;
  console.log(`SPALTEN_0026 ${nach0026 ? "vorhanden" : "fehlen"}`);

  // Textmuster: Praefix abschneiden, gegen die Code-Muster halten.
  const kern = sql`regexp_replace(text, '^[^ :]+@[^ :]+: ', '')`;
  const muster: Record<string, number> = {};
  let erkannt = 0;
  for (const [name, re] of MUSTER) {
    const [r] = await sql`select count(*)::int as n from aenderung where ${kern} ~ ${re}`;
    muster[name] = r!.n;
    erkannt += r!.n;
  }
  muster.freitext = z!.zeilen - erkannt;
  console.log("MUSTER " + JSON.stringify(muster));
  // Mehrdeutig, wenn ein Text auf mehr als ein Muster passt — muss 0 sein.
  const bedingungen = MUSTER.map(([, re]) => sql`(case when ${kern} ~ ${re} then 1 else 0 end)`);
  let summe = bedingungen[0]!;
  for (const b of bedingungen.slice(1)) summe = sql`${summe} + ${b}`;
  const [mehrfach] = await sql`select count(*)::int as n from aenderung where (${summe}) > 1`;
  console.log(`MEHRFACHTREFFER ${mehrfach!.n}`);

  // E-Mail-Join: benutzer.email ist Primaerschluessel, ein Treffer ist also
  // "genau einer". Zusaetzlich (nur Information): Praefix im Text ohne Spalte.
  const [j] = await sql`
    select count(*) filter (where a.benutzer_email is not null and b.email is not null)::int as email_mit_benutzer,
           count(*) filter (where a.benutzer_email is not null and b.email is null)::int as email_ohne_benutzer,
           count(*) filter (where a.benutzer_email is null
                              and exists (select 1 from benutzer b2
                                           where b2.email = substring(a.text from '^([^ :]+@[^ :]+): ')))::int as nur_praefix_mit_benutzer
      from aenderung a left join benutzer b on b.email = a.benutzer_email`;
  console.log("EMAIL_JOIN " + JSON.stringify(j));

  if (nach0026) {
    const arten = await sql`
      select art::text as art, count(*)::int as n,
             count(*) filter (where benutzer_id is not null)::int as mit_benutzer_id
        from aenderung group by 1 order by 1`;
    console.log("ARTEN " + JSON.stringify(arten));
  }

  const beispiele = await sql`
    select entitaet_typ, left(${kern}, 60) as kern, count(*)::int as n
      from aenderung group by 1, 2 order by 3 desc limit 15`;
  console.log("HAEUFIGSTE_TEXTE " + JSON.stringify(beispiele));

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
