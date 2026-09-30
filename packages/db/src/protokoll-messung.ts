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

  // AP2.2 PR b/c: Inbox — Zeilen je Zustand/Typ und die Indizes (Zielnachweis nach 0027/0028).
  const [inboxTabelle] = await sql`select count(*)::int as n from information_schema.tables where table_name = 'inbox_eintrag'`;
  if (inboxTabelle!.n === 1) {
    const [ib] = await sql`
      select count(*)::int as zeilen,
             count(*) filter (where zustand = 'offen')::int as offen,
             count(*) filter (where zustand = 'offen' and gelesen_am is null)::int as ungelesen
        from inbox_eintrag`;
    const idx = await sql`select indexname from pg_indexes where tablename = 'inbox_eintrag' order by indexname`;
    const typen = await sql`select enumlabel from pg_enum where enumtypid = 'inbox_typ'::regtype order by enumsortorder`;
    console.log("INBOX " + JSON.stringify({ ...ib, indizes: idx.map((i) => i.indexname), typen: typen.map((t) => t.enumlabel) }));
  } else {
    console.log("INBOX Tabelle fehlt (vor 0027)");
  }

  // AP2.3 (E60): Parameter mit Verlauf — Definitionen, Startwerte, heutiger Wert je Schluessel.
  const [paramTabelle] = await sql`select count(*)::int as n from information_schema.tables where table_name = 'parameter_wert'`;
  if (paramTabelle!.n === 1) {
    const defs = await sql`
      select d.schluessel, d.einheit,
             (select count(*)::int from parameter_wert w where w.schluessel = d.schluessel) as werte,
             (select count(*)::int from parameter_wert w where w.schluessel = d.schluessel and w.gueltig_ab = '-infinity') as startwerte,
             parameter_wert(d.schluessel, current_date) as heute
        from parameter_definition d order by d.schluessel`;
    const [pz] = await sql`select count(*)::int as definitionen from parameter_definition`;
    console.log("PARAMETER " + JSON.stringify({ definitionen: pz!.definitionen, schluessel: defs.map((d) => `${d.schluessel}=${d.heute} ${d.einheit} (werte ${d.werte}, seit_einfuehrung ${d.startwerte})`) }));
  } else {
    console.log("PARAMETER Tabelle fehlt (vor 0029)");
  }

  // AP2.3 PR b, Messung Zeitzone des Basisdatums: Belege, deren Kalendertag in
  // UTC von dem in Europe/Berlin abweicht (erstellt_am zwischen 22:00 und
  // 24:00 UTC bzw. 23:00 im Winter). reserviert_seit ist ein date — kein Zeitanteil.
  const [tz] = await sql`
    select count(*)::int as belege,
           count(*) filter (where (erstellt_am at time zone 'UTC')::date <> (erstellt_am at time zone 'Europe/Berlin')::date)::int as utc_ungleich_berlin,
           count(*) filter (where typ in ('gespraech','dokument','webrecherche') and (erstellt_am at time zone 'UTC')::date <> (erstellt_am at time zone 'Europe/Berlin')::date)::int as davon_typfrist
      from beleg`;
  console.log("ZEITZONE_BASISDATUM " + JSON.stringify(tz));

  // AP2.3 PR b (E59), Messung Sektorliste nach Migration 0030/0031: Spalten
  // id/aktiv, aktive und deaktivierte Sektoren, Akteure je Zustand, die
  // Funktion sektor_label_norm, der eindeutige Index darauf, die CHECKs;
  // Dubletten und reservierte Bezeichnungen unter der E61-Vergleichsform
  // (Tab/CR/LF am Rand zaehlen mit). Vor 0030/0031 fehlt Struktur — dann
  // steht das so da, kein Fehler.
  const [sk] = await sql`select
      exists (select 1 from information_schema.columns where table_name = 'sektor' and column_name = 'aktiv') as spalte_aktiv,
      exists (select 1 from information_schema.columns where table_name = 'sektor' and column_name = 'id') as spalte_id,
      exists (select 1 from pg_indexes where tablename = 'sektor' and indexname = 'sektor_label_norm_idx' and indexdef like '%UNIQUE%' and indexdef like '%sektor_label_norm(label)%') as unique_index,
      exists (select 1 from pg_proc where proname = 'sektor_label_norm') as funktion_norm,
      (select array_agg(conname order by conname) from pg_constraint where conrelid = 'sektor'::regclass and contype = 'c')::text as checks`;
  if (sk!.spalte_aktiv) {
    const [z] = await sql`select
        count(*)::int as sektoren,
        count(*) filter (where aktiv)::int as aktiv,
        count(*) filter (where not aktiv)::int as inaktiv,
        (select count(*)::int from akteur a join sektor s on s.code = a.sektor where s.aktiv) as akteure_an_aktiven,
        (select count(*)::int from akteur a join sektor s on s.code = a.sektor where not s.aktiv) as akteure_an_inaktiven,
        (select count(*)::int from akteur where sektor is null) as akteure_ohne_sektor,
        (select count(*)::int from (select lower(btrim(label, E' \t\r\n')) from sektor group by 1 having count(*) > 1) d) as dubletten,
        (select count(*)::int from sektor where lower(btrim(label, E' \t\r\n')) in ('abnehmer', 'ohne sektor')) as reservierte_labels
      from sektor`;
    console.log("SEKTOR " + JSON.stringify({ ...sk, ...z }));
  } else {
    console.log("SEKTOR " + JSON.stringify({ ...sk, hinweis: "vor 0030" }));
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
