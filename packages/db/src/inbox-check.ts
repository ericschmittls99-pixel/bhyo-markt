/**
 * AP2.2 PR b: dauerhafter DB-Check der Inbox — laeuft im Deploy-CI gegen die
 * echte Preview-DB (wie protokoll-check). Zusicherungen:
 *
 * 1. Enums inbox_typ / inbox_zustand, Tabelle inbox_eintrag, beide partiellen
 *    Unique-Indizes und der Zaehler-Index stehen (Migration 0027).
 * 2. Der Unique-Index GREIFT: ein zweiter OFFENER aenderung_eintrag fuer
 *    denselben Empfaenger und Strom wird von der DB abgewiesen.
 * 3. Buendelung per Upsert: die zweite Zustellung erhoeht anzahl und setzt
 *    gelesen_am zurueck; nach „erledigt" entsteht ein NEUER Eintrag.
 * 4. CHECK „genau ein Strom" greift.
 *
 * Schreibt nichts Bleibendes: jede Probe laeuft in einer Transaktion, die
 * zurueckgerollt wird. Ohne Benutzer, Strom oder Protokollzeile in der DB
 * werden die Proben uebersprungen und als solche gemeldet.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });

const ROLLBACK = "__rollback__";

/** Fuehrt eine Probe in einer Transaktion aus und rollt IMMER zurueck. */
async function probe<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<{ ergebnis?: T; fehler?: string }> {
  let ergebnis: T | undefined;
  try {
    await sql.begin(async (tx) => {
      ergebnis = await fn(tx);
      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error && e.message === ROLLBACK)) return { fehler: e instanceof Error ? e.message : String(e) };
  }
  return { ergebnis };
}

async function main() {
  const ziel = new URL(url!);
  console.log(`INBOXCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  // (1) Strukturen
  const [t] = await sql`select count(*)::int as n from information_schema.tables where table_name = 'inbox_eintrag'`;
  const [e] = await sql`select count(*)::int as n from pg_type where typname in ('inbox_typ', 'inbox_zustand')`;
  const idx = await sql`select indexname from pg_indexes where tablename = 'inbox_eintrag'
    and indexname in ('inbox_eintrag_biomasse_offen_uidx', 'inbox_eintrag_output_offen_uidx', 'inbox_eintrag_zaehler_idx')`;
  console.log(`STRUKTUR tabelle=${t!.n} enums=${e!.n}/2 indizes=${idx.length}/3`);
  if (t!.n !== 1 || e!.n !== 2 || idx.length !== 3) {
    console.error("INBOXCHECK FEHLER: Migration 0027 fehlt (inbox_eintrag / Enums / Indizes)");
    await sql.end();
    process.exit(1);
  }

  // Probedaten aus dem Bestand (nichts wird angelegt): ein Benutzer, ein
  // Strom, eine Protokollzeile als Ereignis.
  const [nutzer] = await sql`select id from benutzer order by email limit 1`;
  const [strom] = await sql`select id from biomassestrom order by created_at limit 1`;
  const [ereignis] = await sql`select id from aenderung order by zeitpunkt limit 1`;
  if (!nutzer || !strom || !ereignis) {
    console.log(`PROBEN uebersprungen: benutzer=${!!nutzer} strom=${!!strom} ereignis=${!!ereignis}`);
    await sql.end();
    console.log("INBOXCHECK OK (nur Struktur)");
    return;
  }
  const zeile = (tx: postgres.TransactionSql) => tx`
    insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, biomassestrom_id, ereignis_id)
    values (${nutzer.id}, ${nutzer.id}, 'aenderung_eintrag', ${strom.id}, ${ereignis.id})`;

  // (2) Unique-Index greift: zweite offene Zeile wird abgewiesen.
  const doppelt = await probe(async (tx) => {
    await zeile(tx);
    await zeile(tx);
  });
  const doppeltAbgewiesen = !!doppelt.fehler;
  console.log(`ZWEITER_OFFENER_ABGEWIESEN ${doppeltAbgewiesen}${doppelt.fehler ? ` (${doppelt.fehler.slice(0, 80)})` : ""}`);
  if (!doppeltAbgewiesen) fehler.push("zweiter offener Eintrag kam durch — Unique-Index greift nicht");

  // (3) Buendelung per Upsert, danach neuer Eintrag nach erledigt.
  const upsert = (tx: postgres.TransactionSql) => tx`
    insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, biomassestrom_id, ereignis_id)
    values (${nutzer.id}, ${nutzer.id}, 'aenderung_eintrag', ${strom.id}, ${ereignis.id})
    on conflict (empfaenger_id, biomassestrom_id)
      where zustand = 'offen' and typ = 'aenderung_eintrag' and biomassestrom_id is not null
    do update set anzahl = inbox_eintrag.anzahl + 1, ereignis_id = excluded.ereignis_id,
                  aktualisiert_am = now(), gelesen_am = null`;
  const buendel = await probe(async (tx) => {
    await upsert(tx);
    await tx`update inbox_eintrag set gelesen_am = now() where empfaenger_id = ${nutzer.id} and biomassestrom_id = ${strom.id}`;
    await upsert(tx);
    const [nach2] = await tx`select anzahl, gelesen_am from inbox_eintrag where empfaenger_id = ${nutzer.id} and biomassestrom_id = ${strom.id} and zustand = 'offen'`;
    await tx`update inbox_eintrag set zustand = 'erledigt', zustand_seit = now() where empfaenger_id = ${nutzer.id} and biomassestrom_id = ${strom.id} and zustand = 'offen'`;
    await upsert(tx);
    const [n] = await tx`select count(*)::int as n, count(*) filter (where zustand = 'offen')::int as offen from inbox_eintrag where empfaenger_id = ${nutzer.id} and biomassestrom_id = ${strom.id}`;
    return { anzahl: Number(nach2!.anzahl), ungelesen: nach2!.gelesen_am === null, zeilen: n!.n, offen: n!.offen };
  });
  console.log("BUENDELUNG " + JSON.stringify(buendel.ergebnis ?? { fehler: buendel.fehler }));
  if (!buendel.ergebnis) fehler.push(`Buendelungs-Probe fehlgeschlagen: ${buendel.fehler}`);
  else {
    if (buendel.ergebnis.anzahl !== 2 || !buendel.ergebnis.ungelesen) fehler.push("zweite Zustellung erhoeht anzahl nicht auf 2 / setzt nicht ungelesen");
    if (buendel.ergebnis.zeilen !== 2 || buendel.ergebnis.offen !== 1) fehler.push("nach erledigt entsteht kein neuer Eintrag");
  }

  // (4) CHECK genau ein Strom.
  const ohneStrom = await probe((tx) => tx`
    insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, ereignis_id)
    values (${nutzer.id}, ${nutzer.id}, 'aenderung_eintrag', ${ereignis.id})`);
  console.log(`OHNE_STROM_ABGEWIESEN ${!!ohneStrom.fehler}`);
  if (!ohneStrom.fehler) fehler.push("Eintrag ohne Strom kam durch — CHECK greift nicht");

  const [rest] = await sql`select count(*)::int as n from inbox_eintrag where ausloeser_id = empfaenger_id and empfaenger_id = ${nutzer.id} and biomassestrom_id = ${strom.id}`;
  console.log(`RUECKSTAND ${rest!.n}`);
  if (rest!.n !== 0) fehler.push("Probe hinterliess Zeilen");

  await sql.end();
  if (fehler.length) {
    console.error("INBOXCHECK FEHLER: " + fehler.join("; "));
    process.exit(1);
  }
  console.log("INBOXCHECK OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
