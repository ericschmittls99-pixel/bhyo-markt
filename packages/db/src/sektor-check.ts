/**
 * Sektor-Check — dauerhafter DB-Check im Deploy-CI gegen die echte
 * Preview-DB. Seit AP2.3 PR b (E59) pflegt der Admin die Sektorliste in
 * einstellungen.; der Check prueft deshalb die STRUKTUR und die Regeln,
 * nicht mehr eine feste Werteliste (F5 PR B hatte die acht Werte von 0020
 * abgefragt — eine Liste, die der Admin aendern darf, kann kein Check
 * festschreiben). Zusicherungen:
 *
 * 1. Struktur (Migrationen 0030/0031): Spalten id (uuid, unique) und aktiv,
 *    die Funktion sektor_label_norm, der eindeutige Index darauf, die CHECKs
 *    fuer Code, Bezeichnung und reservierte Bezeichnung (E61).
 * 2. Keine Dubletten der Bezeichnung (Schreibweise/Randleerraum egal) — und
 *    der Index greift, beim Anlegen wie beim Umbenennen: ' ENERGIE ',
 *    'eNeRgIe', '  Energie' und 'energie\t' (Tabulator, E61) neben 'Energie'
 *    werden abgewiesen (INSERT), ebenso das Umbenennen eines anderen Sektors
 *    auf ' energie ' (UPDATE).
 * 3. Reservierte Werte (E61; seit AP2.5 PR a1 / E66 umgekehrt fuer
 *    ohne_sektor, Migration 0035): 'abnehmer' (eine Rolle, 0020) existiert
 *    nicht als Zeile und laesst sich weder anlegen noch per Umbenennen
 *    erreichen; 'ohne_sektor' ist die Systemzeile — genau einmal vorhanden,
 *    weder umbenennbar noch deaktivierbar noch loeschbar (Trigger), kein
 *    zweiter INSERT, kein Umbenennen eines anderen Codes darauf. Die Bezeichnungen
 *    'Abnehmer' und 'ohne Sektor' (Schreibweise/Randleerraum egal) werden
 *    beim Anlegen und beim Umbenennen abgewiesen. Ein Code ausserhalb
 *    snake_case und eine leere Bezeichnung ebenso.
 * 4. Kein Akteur traegt einen Sektor, den es nicht gibt — der
 *    Fremdschluessel sichert das, und der Check belegt, dass er greift.
 *    Mindestens ein Sektor ist aktiv (sonst ist die Auswahl leer).
 * 5. Die Schreibfaelle der Akteur-Anlage (POST /api/akteure) gehen durch:
 *    MIT aktivem Sektor, OHNE Sektor — und ein Akteur an einem
 *    deaktivierten Sektor bleibt gueltig (deaktivieren loescht nichts).
 *
 * Nachweis nach E21 gegen die echte Tabelle, jede Probe in einer
 * zurueckgerollten Transaktion — nichts bleibt liegen.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });
const ROLLBACK = "__rollback__";

/** Fuehrt fn in einer Transaktion aus und rollt immer zurueck; liefert den Fehlertext, wenn fn scheitert. */
async function probe(fn: (tx: postgres.TransactionSql) => Promise<void>): Promise<string | null> {
  try {
    await sql.begin(async (tx) => {
      await fn(tx);
      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error && e.message === ROLLBACK)) return e instanceof Error ? e.message : String(e);
  }
  return null;
}

async function main() {
  const ziel = new URL(url!);
  console.log(`SEKTORCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  // (1) Struktur
  const spalten = (await sql`select column_name, data_type from information_schema.columns where table_name = 'sektor'`).map(
    (r) => `${r.column_name}:${r.data_type}`,
  );
  const [idx] = await sql`select count(*)::int as n from pg_indexes where tablename = 'sektor' and indexname = 'sektor_label_norm_idx' and indexdef like '%UNIQUE%' and indexdef like '%sektor_label_norm(label)%'`;
  const [fn] = await sql`select count(*)::int as n from pg_proc where proname = 'sektor_label_norm'`;
  const checks = (await sql`select conname from pg_constraint where conrelid = 'sektor'::regclass and contype = 'c' order by conname`).map((r) => r.conname as string);
  console.log(`STRUKTUR spalten=${JSON.stringify(spalten)} funktion=${fn!.n} label_index=${idx!.n} checks=${JSON.stringify(checks)}`);
  const strukturFehler: string[] = [];
  if (!spalten.includes("id:uuid")) strukturFehler.push("Spalte id (uuid) fehlt");
  if (!spalten.includes("aktiv:boolean")) strukturFehler.push("Spalte aktiv (boolean) fehlt");
  if (fn!.n !== 1) strukturFehler.push("Funktion sektor_label_norm fehlt");
  if (idx!.n !== 1) strukturFehler.push("eindeutiger Index sektor_label_norm_idx auf sektor_label_norm(label) fehlt");
  for (const c of ["sektor_code_check", "sektor_label_check", "sektor_label_reserviert_check"]) if (!checks.includes(c)) strukturFehler.push(`CHECK ${c} fehlt`);
  if (strukturFehler.length) {
    console.error("::error::SEKTOR-CHECK VERLETZT (Migration 0030/0031 fehlt): " + strukturFehler.join(" · "));
    await sql.end();
    process.exit(1);
  }

  // (2) Dubletten und Index
  const [dub] = await sql`select count(*)::int as n from (select sektor_label_norm(label) from sektor group by 1 having count(*) > 1) d`;
  const [erster] = await sql`select code, label from sektor order by sortierung, label limit 1`;
  const dublette = await probe(async (tx) => {
    await tx`insert into sektor (code, label) values ('probe_dublette', ${" " + String(erster!.label).toUpperCase() + " "})`;
  });
  console.log(`LABEL dubletten=${dub!.n} index_greift=${dublette !== null}`);
  if (dub!.n > 0) fehler.push(`${dub!.n} Bezeichnungen doppelt (Schreibweise egal)`);
  if (dublette === null) fehler.push("Eine Bezeichnung liess sich ein zweites Mal anlegen — Index greift nicht");
  // Weitere Schreibweisen beim Anlegen — und das Umbenennen (UPDATE) eines
  // anderen Sektors auf eine vorhandene Bezeichnung.
  const label = String(erster!.label);
  const varianten = [
    label.split("").map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join(""),
    "  " + label,
    label.toUpperCase() + "   ",
    // E61: Tabulator/CR/LF am Rand — vorher (0030, btrim ohne Zeichenliste) ging das durch.
    label.toLowerCase() + "\t",
    "\r\n" + label,
  ];
  for (const v of varianten) {
    const grund = await probe(async (tx) => {
      await tx`insert into sektor (code, label) values ('probe_variante', ${v})`;
    });
    console.log(`DUBLETTE_INSERT ${JSON.stringify(v)} abgewiesen=${grund !== null}`);
    if (grund === null) fehler.push(`Bezeichnung ${JSON.stringify(v)} liess sich neben "${label}" anlegen`);
  }
  const [zweiter] = await sql`select code from sektor where code <> ${erster!.code as string} order by sortierung, label limit 1`;
  if (zweiter) {
    const grund = await probe(async (tx) => {
      await tx`update sektor set label = ${" " + label.toUpperCase() + " "} where code = ${zweiter.code as string}`;
    });
    console.log(`DUBLETTE_UPDATE ${zweiter.code} -> ${JSON.stringify(" " + label.toUpperCase() + " ")} abgewiesen=${grund !== null}`);
    if (grund === null) fehler.push(`Umbenennen von ${zweiter.code} auf die Bezeichnung von ${erster!.code} kam durch`);
  }

  // (3) Geschuetzte Werte (E61, seit AP2.5 PR a1 / E66 umgekehrt fuer ohne_sektor):
  //     'abnehmer' bleibt eine Rolle — keine Zeile, kein INSERT, kein Umbenennen darauf.
  //     'ohne_sektor' ist die SYSTEMZEILE: genau einmal vorhanden, Bezeichnung
  //     „ohne Sektor", aktiv; sie laesst sich weder umbenennen noch deaktivieren
  //     noch loeschen (Trigger sektor_systemzeile_wache), kein zweiter INSERT,
  //     kein Umbenennen eines anderen Codes darauf. Vor 0035 ist das rot.
  const [abn] = await sql`select count(*)::int as n from sektor where code = 'abnehmer'`;
  const [sys] = await sql`select count(*)::int as n, bool_or(label = 'ohne Sektor') as label_ok, bool_or(aktiv) as aktiv from sektor where code = 'ohne_sektor'`;
  console.log(`SYSTEMZEILE abnehmer_zeilen=${abn!.n} ohne_sektor_zeilen=${sys!.n} label_ok=${sys!.label_ok} aktiv=${sys!.aktiv}`);
  if (abn!.n !== 0) fehler.push("'abnehmer' existiert als Sektor (Rolle, keine Zeile)");
  if (sys!.n !== 1 || !sys!.label_ok || !sys!.aktiv) fehler.push("Systemzeile ohne_sektor fehlt oder ist falsch (genau einmal, Bezeichnung 'ohne Sektor', aktiv) — Migration 0035");
  const abnehmerUpdate = await probe(async (tx) => {
    await tx`update sektor set code = 'abnehmer' where code = ${erster!.code as string}`;
  });
  console.log(`GESCHUETZT_UPDATE_CODE ${erster!.code} -> abnehmer abgewiesen=${abnehmerUpdate !== null}`);
  if (abnehmerUpdate === null) fehler.push("Umbenennen des Codes auf abnehmer kam durch — CHECK gilt nicht fuer UPDATE");
  const abnehmerInsert = await probe(async (tx) => {
    await tx`insert into sektor (code, label) values ('abnehmer', 'Probe Abnehmer')`;
  });
  if (abnehmerInsert === null) fehler.push("INSERT des Codes abnehmer kam durch");
  const systemProben: [string, (tx: postgres.TransactionSql) => Promise<unknown>][] = [
    ["INSERT zweite ohne_sektor-Zeile", (tx) => tx`insert into sektor (code, label, sortierung) values ('ohne_sektor', 'Probe', 0)`],
    ["UPDATE Code eines anderen Sektors auf ohne_sektor", (tx) => tx`update sektor set code = 'ohne_sektor' where code = ${erster!.code as string}`],
    ["UPDATE Bezeichnung der Systemzeile", (tx) => tx`update sektor set label = 'Probe' where code = 'ohne_sektor'`],
    ["UPDATE aktiv = false der Systemzeile", (tx) => tx`update sektor set aktiv = false where code = 'ohne_sektor'`],
    ["UPDATE Code der Systemzeile", (tx) => tx`update sektor set code = 'ohne_sektor_alt' where code = 'ohne_sektor'`],
    ["DELETE der Systemzeile", (tx) => tx`delete from sektor where code = 'ohne_sektor'`],
  ];
  for (const [name, fn] of systemProben) {
    const grund = await probe(async (tx) => {
      await fn(tx);
    });
    console.log(`SYSTEMZEILE_PROBE ${JSON.stringify(name)} abgewiesen=${grund !== null}${grund ? ` (${grund.slice(0, 70)})` : ""}`);
    if (grund === null) fehler.push(`${name} kam durch — Systemzeile nicht geschuetzt`);
  }
  // E61: reservierte Bezeichnungen — beim Umbenennen (UPDATE) und beim Anlegen (INSERT).
  for (const l of ["Abnehmer", "ohne Sektor", "  ABNEHMER\t", "Ohne  Sektor".replace("  ", " ")]) {
    const update = await probe(async (tx) => {
      await tx`update sektor set label = ${l} where code = ${erster!.code as string}`;
    });
    const insert = await probe(async (tx) => {
      await tx`insert into sektor (code, label) values ('probe_reserviert', ${l})`;
    });
    console.log(`LABEL_RESERVIERT ${JSON.stringify(l)} update_abgewiesen=${update !== null} insert_abgewiesen=${insert !== null}`);
    if (update === null) fehler.push(`Umbenennen auf reservierte Bezeichnung ${JSON.stringify(l)} kam durch`);
    if (insert === null) fehler.push(`Anlegen mit reservierter Bezeichnung ${JSON.stringify(l)} kam durch`);
  }
  // Code- und Label-CHECK beim Anlegen
  for (const [code, label] of [
    ["abnehmer", "Abnehmer"],
    ["ohne_sektor", "Ohne Sektor"],
    ["Falsch-Code", "Probe"],
    ["probe_leer", "   "],
  ] as const) {
    const grund = await probe(async (tx) => {
      await tx`insert into sektor (code, label) values (${code}, ${label})`;
    });
    console.log(`CHECK_GREIFT ${code} abgewiesen=${grund !== null}`);
    if (grund === null) fehler.push(`Sektor (${code}, "${label}") liess sich anlegen — CHECK greift nicht`);
  }

  // (4) Akteure und Fremdschluessel
  const [z] = await sql`
    select count(*)::int as akteure,
           count(*) filter (where sektor is null)::int as ohne_sektor,
           count(*) filter (where sektor is not null
             and not exists (select 1 from sektor s where s.code = akteur.sektor))::int as unbekannt
      from akteur`;
  const [akt] = await sql`select count(*) filter (where aktiv)::int as aktiv, count(*)::int as gesamt from sektor`;
  console.log("AKTEURE " + JSON.stringify(z) + " SEKTOREN " + JSON.stringify(akt));
  if ((z!.unbekannt as number) > 0) fehler.push(`${z!.unbekannt} Akteure mit unbekanntem Sektor`);
  if ((akt!.aktiv as number) < 1) fehler.push("Kein aktiver Sektor — die Auswahlliste waere leer");
  const fk = await probe(async (tx) => {
    await tx`insert into akteur (name, sektor, status) values ('Sektor-Testzeile', 'gibt-es-nicht', 'entwurf')`;
  });
  console.log(`FREMDSCHLUESSEL_GREIFT ${fk !== null}`);
  if (fk === null) fehler.push("Ein unbekannter Sektor liess sich einfuegen");

  // (5) Schreibfaelle der Akteur-Anlage
  const [aktiver] = await sql`select code from sektor where aktiv order by sortierung, label limit 1`;
  for (const [fall, wert] of [
    ["MIT_SEKTOR", aktiver!.code as string],
    ["OHNE_SEKTOR", null],
  ] as const) {
    let angelegt = false;
    const grund = await probe(async (tx) => {
      const [row] = await tx`insert into akteur (name, sektor, status) values ('Sektor-Testzeile', ${wert}, 'entwurf') returning sektor`;
      angelegt = !!row && row.sektor === wert;
    });
    console.log(`ANLAGE_${fall} ${angelegt}${grund ? ` grund="${grund}"` : ""}`);
    if (!angelegt) fehler.push(`Akteur-Anlage ${fall} scheitert am Schema`);
  }
  let bleibt = false;
  const deakt = await probe(async (tx) => {
    await tx`insert into sektor (code, label, aktiv) values ('probe_deaktiviert', 'Probe deaktiviert', false)`;
    const [row] = await tx`insert into akteur (name, sektor, status) values ('Sektor-Testzeile', 'probe_deaktiviert', 'entwurf') returning sektor`;
    bleibt = row?.sektor === "probe_deaktiviert";
  });
  console.log(`AKTEUR_AN_DEAKTIVIERTEM_SEKTOR ${bleibt}${deakt ? ` grund="${deakt}"` : ""}`);
  if (!bleibt) fehler.push("Ein Akteur an einem deaktivierten Sektor ist nicht mehr gueltig — deaktivieren darf nichts loeschen");

  await sql.end();
  if (fehler.length) {
    console.error("::error::SEKTOR-CHECK VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("Sektor-Check OK.");
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
