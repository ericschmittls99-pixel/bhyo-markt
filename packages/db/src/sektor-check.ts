/**
 * Sektor-Check — dauerhafter DB-Check im Deploy-CI gegen die echte
 * Preview-DB. Seit AP2.3 PR b (E59) pflegt der Admin die Sektorliste in
 * einstellungen.; der Check prueft deshalb die STRUKTUR und die Regeln,
 * nicht mehr eine feste Werteliste (F5 PR B hatte die acht Werte von 0020
 * abgefragt — eine Liste, die der Admin aendern darf, kann kein Check
 * festschreiben). Zusicherungen:
 *
 * 1. Struktur (Migration 0030): Spalten id (uuid, unique) und aktiv, der
 *    eindeutige Index auf lower(btrim(label)), die CHECKs fuer Code und
 *    Bezeichnung.
 * 2. Keine Dubletten der Bezeichnung (Schreibweise/Randleerraum egal) — und
 *    der Index greift, beim Anlegen wie beim Umbenennen: ' ENERGIE ',
 *    'eNeRgIe' und '  Energie' neben 'Energie' werden abgewiesen (INSERT),
 *    ebenso das Umbenennen eines anderen Sektors auf ' energie ' (UPDATE).
 * 3. Geschuetzte Werte per DB-CHECK: 'abnehmer' (eine Rolle, 0020) und
 *    'ohne_sektor' (der Filterwert fuer NULL) existieren nicht als Zeile
 *    (nichts zu deaktivieren), lassen sich nicht anlegen (INSERT) und kein
 *    Sektor laesst sich auf sie umbenennen (UPDATE code — der CHECK gilt
 *    fuer beide). Ein Code ausserhalb snake_case und eine leere Bezeichnung
 *    werden ebenso abgewiesen. Gemessen und genannt, nicht erzwungen: ob
 *    die DB eine Bezeichnung 'Abnehmer' / 'ohne Sektor' zulaesst (heute
 *    nur die App-Regel in apps/web/lib/sektor.ts, kein CHECK auf label).
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
  const [idx] = await sql`select count(*)::int as n from pg_indexes where tablename = 'sektor' and indexname = 'sektor_label_lower_idx' and indexdef like '%UNIQUE%' and indexdef like '%lower(btrim(label))%'`;
  const checks = (await sql`select conname from pg_constraint where conrelid = 'sektor'::regclass and contype = 'c' order by conname`).map((r) => r.conname as string);
  console.log(`STRUKTUR spalten=${JSON.stringify(spalten)} label_index=${idx!.n} checks=${JSON.stringify(checks)}`);
  const strukturFehler: string[] = [];
  if (!spalten.includes("id:uuid")) strukturFehler.push("Spalte id (uuid) fehlt");
  if (!spalten.includes("aktiv:boolean")) strukturFehler.push("Spalte aktiv (boolean) fehlt");
  if (idx!.n !== 1) strukturFehler.push("eindeutiger Index sektor_label_lower_idx auf lower(btrim(label)) fehlt");
  for (const c of ["sektor_code_check", "sektor_label_check"]) if (!checks.includes(c)) strukturFehler.push(`CHECK ${c} fehlt`);
  if (strukturFehler.length) {
    console.error("::error::SEKTOR-CHECK VERLETZT (Migration 0030 fehlt): " + strukturFehler.join(" · "));
    await sql.end();
    process.exit(1);
  }

  // (2) Dubletten und Index
  const [dub] = await sql`select count(*)::int as n from (select lower(btrim(label)) from sektor group by 1 having count(*) > 1) d`;
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
  ];
  for (const v of varianten) {
    const grund = await probe(async (tx) => {
      await tx`insert into sektor (code, label) values ('probe_variante', ${v})`;
    });
    console.log(`DUBLETTE_INSERT ${JSON.stringify(v)} abgewiesen=${grund !== null}`);
    if (grund === null) fehler.push(`Bezeichnung ${JSON.stringify(v)} liess sich neben "${label}" anlegen`);
  }
  // Befund 30.09.2026 (erster Lauf dieser Probe): btrim() ohne Zeichenliste
  // entfernt nur Leerzeichen — ein Tabulator am Rand geht am Index vorbei.
  // Ueber die App kommt er nicht an (trim() in lib/sektor.ts), direkt in der
  // DB schon. Gemessen und genannt, nicht erzwungen; Entscheidung bei Eric
  // (0031 mit btrim(label, E' \t\r\n') oder regexp-Normalisierung).
  const tab = await probe(async (tx) => {
    await tx`insert into sektor (code, label) values ('probe_variante', ${label.toLowerCase() + "\t"})`;
  });
  console.log(`DUBLETTE_INSERT_TAB ${JSON.stringify(label.toLowerCase() + "\t")} abgewiesen=${tab !== null} (nur Messung)`);
  const [zweiter] = await sql`select code from sektor where code <> ${erster!.code as string} order by sortierung, label limit 1`;
  if (zweiter) {
    const grund = await probe(async (tx) => {
      await tx`update sektor set label = ${" " + label.toUpperCase() + " "} where code = ${zweiter.code as string}`;
    });
    console.log(`DUBLETTE_UPDATE ${zweiter.code} -> ${JSON.stringify(" " + label.toUpperCase() + " ")} abgewiesen=${grund !== null}`);
    if (grund === null) fehler.push(`Umbenennen von ${zweiter.code} auf die Bezeichnung von ${erster!.code} kam durch`);
  }

  // (3) Geschuetzte Werte: keine Zeile, kein INSERT, kein Umbenennen (UPDATE code) darauf
  const GESCHUETZT = ["abnehmer", "ohne_sektor"];
  const vorhanden = (await sql`select code from sektor where code = any(${GESCHUETZT})`).map((r) => r.code as string);
  console.log(`GESCHUETZT_ALS_ZEILE ${JSON.stringify(vorhanden)}`);
  if (vorhanden.length) fehler.push(`Geschuetzte Codes existieren als Sektor: ${vorhanden.join(", ")}`);
  for (const g of GESCHUETZT) {
    const grund = await probe(async (tx) => {
      await tx`update sektor set code = ${g} where code = ${erster!.code as string}`;
    });
    console.log(`GESCHUETZT_UPDATE_CODE ${erster!.code} -> ${g} abgewiesen=${grund !== null}`);
    if (grund === null) fehler.push(`Umbenennen des Codes auf ${g} kam durch — CHECK gilt nicht fuer UPDATE`);
  }
  for (const l of ["Abnehmer", "ohne Sektor"]) {
    const grund = await probe(async (tx) => {
      await tx`update sektor set label = ${l} where code = ${erster!.code as string}`;
    });
    // Nur Messung: die Bezeichnung schuetzt heute die App (lib/sektor.ts), nicht die DB.
    console.log(`LABEL_GESCHUETZT_DB ${JSON.stringify(l)} abgewiesen=${grund !== null}`);
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
