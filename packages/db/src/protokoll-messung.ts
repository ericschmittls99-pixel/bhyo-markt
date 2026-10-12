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

  // AP2.4 PR a (E62), Messung nach Migration 0032: die sieben neuen
  // Ereignisarten, die Funktion strom_verifikation(date), qualitaetsstufe mit
  // vier Parametern, die neu angelegte GENERATED-Spalte beleg.qualitaet und
  // beleg.abgelaufen_am. Mit Struktur: Stroeme je Zustand am heutigen Stichtag
  // und die geprueften Stroeme ohne Beleg bzw. ohne Pruefereignis — die
  // Vorher-Messung fuer den Zustand ohne_beleg (PR b). Vor 0032 fehlt die
  // Struktur — dann steht das so da, kein Fehler.
  const arten = await sql`select enumlabel from pg_enum where enumtypid = 'ereignis_art'::regtype order by enumsortorder`;
  const ARTEN_0032 = ["in_pruefung_gegeben", "geprueft", "zurueckgegeben", "reaktiviert", "zurueckgesetzt", "als_abgelaufen_markiert", "abgelaufen_aufgehoben"];
  const vorhandeneArten = new Set(arten.map((a) => a.enumlabel as string));
  const [vs] = await sql`select
      exists (select 1 from pg_proc where proname = 'strom_verifikation' and pronargs = 1) as funktion_verifikation,
      exists (select 1 from pg_proc where proname = 'qualitaetsstufe' and pronargs = 4) as qualitaetsstufe_4,
      (select is_generated = 'ALWAYS' from information_schema.columns where table_name = 'beleg' and column_name = 'qualitaet') as qualitaet_generated,
      exists (select 1 from information_schema.columns where table_name = 'beleg' and column_name = 'abgelaufen_am') as spalte_abgelaufen_am`;
  const struktur = {
    ereignisarten: arten.length,
    arten_0032_fehlen: ARTEN_0032.filter((a) => !vorhandeneArten.has(a)),
    ...vs,
  };
  // AP2.4 PR b (E63), Messung nach Migration 0033: Parameter
  // verifikation.vorlauf_tage, Tabelle job_lauf, die beiden Idempotenz-Indizes
  // der Hinweise (NULLS NOT DISTINCT), Ereignisart reverifiziert, Inbox-Typen
  // verifikation_laeuft_ab/verifikation_abgelaufen. Vor 0033: „fehlt" — das
  // ist der Rot-Nachweis gegen eine echte Datenbank ohne 0033, kein Fehler.
  const [m33] = await sql`select
      exists (select 1 from parameter_definition where schluessel = 'verifikation.vorlauf_tage') as parameter_vorlauf_tage,
      exists (select 1 from information_schema.tables where table_name = 'job_lauf') as job_lauf,
      (select count(*)::int from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relname in ('inbox_eintrag_biomasse_hinweis_uidx', 'inbox_eintrag_output_hinweis_uidx') and i.indisunique and i.indnullsnotdistinct) as idempotenz_indizes,
      exists (select 1 from pg_enum where enumtypid = 'ereignis_art'::regtype and enumlabel = 'reverifiziert') as art_reverifiziert,
      (select count(*)::int from pg_enum where enumtypid = 'inbox_typ'::regtype and enumlabel in ('verifikation_laeuft_ab', 'verifikation_abgelaufen')) as inbox_typen_hinweise`;
  const vollstaendig33 = m33!.parameter_vorlauf_tage && m33!.job_lauf && m33!.idempotenz_indizes === 2 && m33!.art_reverifiziert && m33!.inbox_typen_hinweise === 2;
  const fehlt33 = [
    !m33!.parameter_vorlauf_tage && "parameter verifikation.vorlauf_tage",
    !m33!.job_lauf && "job_lauf",
    m33!.idempotenz_indizes !== 2 && `idempotenz_indizes ${m33!.idempotenz_indizes}/2`,
    !m33!.art_reverifiziert && "ereignisart reverifiziert",
    m33!.inbox_typen_hinweise !== 2 && `inbox_typen_hinweise ${m33!.inbox_typen_hinweise}/2`,
  ].filter(Boolean);
  console.log("MIGRATION_0033 " + JSON.stringify({ stand: vollstaendig33 ? "vorhanden" : "fehlt", ...m33, fehlt: fehlt33 }));
  if (vs!.funktion_verifikation) {
    const [jl] = m33!.job_lauf
      ? await sql`with l as (select * from job_lauf where job = 'verifikation' order by stichtag desc limit 1)
                  select (select count(*)::int from job_lauf where job = 'verifikation') as laeufe,
                         l.stichtag::text as letzter_stichtag, l.ergebnis as letztes_ergebnis, l.anzahl as letzte_anzahl,
                         l.abgeraeumt as letzte_abgeraeumt,
                         l.ausgeloest_am::text as ausgeloest_am,
                         l.gestartet_am::text as gestartet_am, l.beendet_am::text as beendet_am,
                         extract(epoch from (l.gestartet_am - l.ausgeloest_am))::numeric(10,3) as verbindung_s,
                         extract(epoch from (l.beendet_am - l.gestartet_am))::numeric(10,3) as dauer_s,
                         l.schritte as letzte_schritte
                    from l`
      : [{ laeufe: null, letzter_stichtag: null, letztes_ergebnis: null }];
    console.log("JOB_LAUF " + JSON.stringify(jl));
    // AP2.9 (E76, Eric 10.10.2026): die juengste job_lauf-Zeile des Roundups —
    // Summen des Laufs stehen in schritte (empfaenger, wuerde_senden, gesendet,
    // fehler, ursache_<code>, modus); die Zeilen je Nutzer bleiben im Worker-Log.
    // Nur SELECT; ohne Lauf (vor dem ersten Werktag) laeufe=0. Der Fehlertext
    // (job_lauf.fehler) wird NICHT gedruckt — ein Drizzle-Fehler nennt Query und
    // Parameter, darunter koennte eine Adresse stehen (E73, Bedingung Eric
    // 10.10.2026: nur Summen und Modus); gedruckt wird nur seine Laenge.
    const [rl] = m33!.job_lauf
      ? await sql`with l as (select * from job_lauf where job = 'roundup' order by stichtag desc limit 1)
                  select (select count(*)::int from job_lauf where job = 'roundup') as laeufe,
                         l.stichtag::text as letzter_stichtag, l.ergebnis as letztes_ergebnis, l.anzahl as letzte_anzahl,
                         length(l.fehler) as fehler_laenge,
                         l.ausgeloest_am::text as ausgeloest_am,
                         l.gestartet_am::text as gestartet_am, l.beendet_am::text as beendet_am,
                         extract(epoch from (l.beendet_am - l.gestartet_am))::numeric(10,3) as dauer_s,
                         l.schritte as letzte_schritte
                    from l`
      : [{ laeufe: null }];
    console.log("JOB_LAUF_ROUNDUP " + JSON.stringify(rl ?? { laeufe: 0 }));
    // E73 Altbestand (Eric 10.10.2026): je Job die Zeilen mit Fehlertext, davon mit „@" und davon
    // schon als Fehlerklasse (db_fehler/…, seit #219). Nur Zaehler, nie der Text. Alte Rohtexte
    // bereinigt kein Skript — das entscheidet Eric.
    const jf = m33!.job_lauf
      ? await sql`select job, count(*)::int as mit_fehler,
                         count(*) filter (where fehler like '%@%')::int as mit_at,
                         count(*) filter (where fehler ~ '^(db_fehler|graph|fehler)/')::int as als_klasse,
                         max(length(fehler))::int as max_laenge
                    from job_lauf where fehler is not null group by job order by job`
      : [];
    console.log("JOB_LAUF_FEHLER " + JSON.stringify(jf));
    const zustaende = await sql`
      select art, zustand, count(*)::int as n
        from strom_verifikation(current_date) group by 1, 2 order by 1, 2`;
    const [ohne] = await sql`select
        (select count(*)::int from biomassestrom where status = 'geprueft' and beleg_id is null)
        + (select count(*)::int from output_bedarf where status = 'geprueft' and beleg_id is null) as geprueft_ohne_beleg,
        (select count(*)::int from strom_verifikation(current_date) v
          where v.status = 'geprueft' and v.verifiziert_am is null) as geprueft_ohne_pruefereignis`;
    console.log("VERIFIKATION " + JSON.stringify({ ...struktur, ...ohne, zustaende: zustaende.map((z) => `${z.art}/${z.zustand}=${z.n}`) }));
  } else {
    console.log("VERIFIKATION " + JSON.stringify({ ...struktur, hinweis: "vor 0032" }));
  }

  // AP2.5 Schritt 0 (Bestandsaufnahme Akteur-Modell, Auftrag Eric 01.10.2026):
  // Akteure je Status/Sektor, Pflegegrad der Kontaktfelder, Rollen, Interessen;
  // Stroeme je Akteur (verwaist = ohne Strom, ohne Beleg = kein Strom mit
  // Beleg, mehrere Orte/PLZ je Akteur, Pins), Namensdubletten in der
  // Vergleichsform lower/btrim, Rechtsformen im Namen, VG250-Ebenen,
  // Protokollarten zum Akteur. Nur SELECT.
  const [ak] = await sql`select
      count(*)::int as akteure,
      count(*) filter (where sektor = 'ohne_sektor')::int as ohne_sektor,
      (select count(*)::int from kontaktperson) as kontaktpersonen,
      (select count(*)::int from akteur_interesse) as interessen,
      (select array_agg(status || '=' || n order by status) from (select status::text as status, count(*) as n from akteur group by 1) s)::text as je_status,
      (select array_agg(coalesce(sektor, 'NULL') || '=' || n order by n desc) from (select sektor, count(*) as n from akteur group by 1) s)::text as je_sektor
    from akteur`;
  console.log("AKTEUR " + JSON.stringify(ak));
  const [as_] = await sql`with s as (
      select akteur_id, ort, plz, standort_geom, beleg_id from biomassestrom
      union all
      select akteur_id, ort, plz, standort_geom, beleg_id from output_bedarf
    ), je as (
      select a.id,
             count(s.akteur_id)::int as stroeme,
             count(s.beleg_id)::int as mit_beleg,
             count(s.standort_geom)::int as mit_pin,
             count(distinct s.plz) filter (where s.plz is not null)::int as plz_anzahl,
             count(distinct lower(btrim(s.ort))) filter (where s.ort is not null)::int as orte_anzahl
        from akteur a left join s on s.akteur_id = a.id group by a.id)
    select
      count(*) filter (where stroeme = 0)::int as verwaist_ohne_strom,
      count(*) filter (where stroeme > 0 and mit_beleg = 0)::int as mit_strom_ohne_beleg,
      count(*) filter (where stroeme > 0 and mit_pin = 0)::int as mit_strom_ohne_pin,
      count(*) filter (where plz_anzahl > 1)::int as mehrere_plz,
      count(*) filter (where orte_anzahl > 1)::int as mehrere_orte,
      max(stroeme)::int as max_stroeme_je_akteur,
      (select count(*)::int from s where plz is null and ort is null) as stroeme_ohne_ort_und_plz
    from je`;
  console.log("AKTEUR_STROEME " + JSON.stringify(as_));
  const [an] = await sql`select
      (select count(*)::int from (select lower(btrim(name)) from akteur group by 1 having count(*) > 1) d) as namensdubletten_gruppen,
      (select count(*)::int from akteur where name ~* '\\m(gmbh|mbh|gbr|kg|ag|e\\.?k\\.?|ohg|ug|se|e\\.?v\\.?|co\\.?)\\M') as namen_mit_rechtsform,
      (select count(*)::int from akteur where name like 'Seed:%' or name like 'Test:%') as testdaten_namen,
      (select array_agg(ebene || '=' || n) from (select ebene::text as ebene, count(*) as n from verwaltungsgebiet group by 1) v)::text as vg250_ebenen,
      (select count(*)::int from pg_extension where extname = 'pg_trgm') as pg_trgm,
      (select array_agg(art || '=' || n order by n desc) from (select art::text as art, count(*) as n from aenderung where entitaet_typ = 'akteur' group by 1) p)::text as protokoll_arten_akteur
    `;
  console.log("AKTEUR_NAMEN " + JSON.stringify(an));

  // E73 (08.10.2026): Logs eines oeffentlichen Repos sind oeffentlich — keine
  // Freitexte (Zugriffsanfragen, Aufgaben, Begruendungen) mehr, nur Arten und Zahlen.
  const beispiele = await sql`
    select entitaet_typ, art::text as art, count(*)::int as n
      from aenderung group by 1, 2 order by 3 desc limit 15`;
  console.log("HAEUFIGSTE_ARTEN " + JSON.stringify(beispiele));

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
