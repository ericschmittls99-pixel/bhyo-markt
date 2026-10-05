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
 * 5. PR c: Zugriffsanfrage — der Index (Empfaenger, Strom, Anfragender) greift:
 *    zweite offene Anfrage derselben Person abgewiesen, zweite Anfragende
 *    zugelassen; Enum inbox_typ traegt die drei neuen Typen.
 * 8. AP2.4 PR c (E63, D5): Typ aufgabe, Spalte aufgabe, CHECK
 *    inbox_eintrag_aufgabe_check — Text nur beim Typ aufgabe, nicht leer,
 *    hoechstens 500 Zeichen (Probe: leer, 501 Zeichen, fremder Typ mit Text).
 * 7. AP2.4 PR b (E63): Typen verifikation_laeuft_ab und verifikation_abgelaufen,
 *    die beiden Hinweis-Indizes (NULLS NOT DISTINCT), Spalte bezugsdatum,
 *    ausloeser_id und ereignis_id NULL-faehig, CHECK inbox_eintrag_urheber_check.
 * 6. AP2.4 PR a (E62): Typen pruefauftrag und pruefung_erledigt, die beiden
 *    Pruefauftrag-Indizes (Migration 0032) — und der Index greift: ein
 *    zweiter offener pruefauftrag fuer denselben Pruefer und Strom wird
 *    abgewiesen; nach „erledigt" entsteht ein neuer.
 *
 * Schreibt nichts Bleibendes: jede Probe laeuft in einer Transaktion, die
 * zurueckgerollt wird. Ohne Benutzer, Strom oder Protokollzeile in der DB
 * werden die Proben uebersprungen und als solche gemeldet.
 */
import postgres from "postgres";

import { journalModus, modusText, zaehlerPasst } from "./journal-vergleich";

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
    and indexname in ('inbox_eintrag_biomasse_offen_uidx', 'inbox_eintrag_output_offen_uidx', 'inbox_eintrag_zaehler_idx',
                      'inbox_eintrag_biomasse_anfrage_uidx', 'inbox_eintrag_output_anfrage_uidx',
                      'inbox_eintrag_biomasse_pruefauftrag_uidx', 'inbox_eintrag_output_pruefauftrag_uidx',
                      'inbox_eintrag_biomasse_hinweis_uidx', 'inbox_eintrag_output_hinweis_uidx',
                      'inbox_eintrag_akteur_hinweis_uidx', 'inbox_eintrag_kontaktperson_hinweis_uidx')`;
  const typen = await sql`select enumlabel from pg_enum where enumtypid = 'inbox_typ'::regtype`;
  // PR b (0033): Hinweise ohne Urheber/Ereignis, Bezugsdatum, Urheber-CHECK.
  const [nullbar] = await sql`select count(*)::int as n from information_schema.columns
    where table_name = 'inbox_eintrag' and column_name in ('ausloeser_id', 'ereignis_id') and is_nullable = 'YES'`;
  const [bz] = await sql`select count(*)::int as n from information_schema.columns where table_name = 'inbox_eintrag' and column_name = 'bezugsdatum'`;
  const [uc] = await sql`select count(*)::int as n from pg_constraint where conname = 'inbox_eintrag_urheber_check'`;
  // PR c (0034): Typ aufgabe, Spalte aufgabe, Aufgaben-CHECK.
  const [as] = await sql`select count(*)::int as n from information_schema.columns where table_name = 'inbox_eintrag' and column_name = 'aufgabe'`;
  const [ac] = await sql`select count(*)::int as n from pg_constraint where conname = 'inbox_eintrag_aufgabe_check'`;
  // AP2.5 PR a1 (0035): Objektbezug Akteur (akteur_id, ON DELETE CASCADE), Typ akteur_verwaist, Idempotenz-Index.
  const [ak] = await sql`select count(*)::int as n from information_schema.columns where table_name = 'inbox_eintrag' and column_name = 'akteur_id'`;
  // AP2.5 PR b (0036): Objektbezug Kontaktperson (CASCADE), Typ kontaktperson_loeschpruefung, Index.
  const [kp] = await sql`select count(*)::int as n from information_schema.columns where table_name = 'inbox_eintrag' and column_name = 'kontaktperson_id'`;
  // Journal-Vergleich (Eric 01.10.2026): exakt bei gleichem Journal, Mindestvergleich nur
  // wenn die DB nachweislich voraus ist (geteilte Preview, gestapelte PRs); sonst rot.
  const journal = await journalModus(sql, url!);
  console.log(modusText(journal));
  if (journal.modus === "rot") {
    console.error(`INBOXCHECK FEHLER: ${journal.grund}`);
    await sql.end();
    process.exit(1);
  }
  const modus = journal.modus;
  console.log(
    `STRUKTUR tabelle=${t!.n} enums=${e!.n}/2 indizes=${idx.length}/11 typen=${typen.length}/11 nullbar=${nullbar!.n}/2 bezugsdatum=${bz!.n} urheber_check=${uc!.n} aufgabe_spalte=${as!.n} aufgabe_check=${ac!.n} akteur_id=${ak!.n} kontaktperson_id=${kp!.n} (${modus})`,
  );
  const zaehler = [zaehlerPasst("indizes", idx.length, 11, modus), zaehlerPasst("typen", typen.length, 11, modus)].filter(Boolean);
  if (t!.n !== 1 || e!.n !== 2 || zaehler.length || nullbar!.n !== 2 || bz!.n !== 1 || uc!.n !== 1 || as!.n !== 1 || ac!.n !== 1 || ak!.n !== 1 || kp!.n !== 1) {
    console.error(`INBOXCHECK FEHLER: Migration 0027/0028/0032/0033/0034/0035/0036 fehlt (inbox_eintrag / Enums / Indizes / Typen / Hinweis-Spalten / Aufgabe / Akteur / Kontaktperson) ${zaehler.join(" · ")}`);
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

  // (4b) AP2.4 PR c: Aufgaben-CHECK — leer, 501 Zeichen und Text an fremdem Typ abgewiesen; 500 Zeichen erlaubt.
  const aufgabe = (tx: postgres.TransactionSql, typ: string, text: string | null) => tx`
    insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, biomassestrom_id, ereignis_id, aufgabe)
    values (${nutzer.id}, ${nutzer.id}, ${typ}::inbox_typ, ${strom.id}, ${ereignis.id}, ${text})`;
  const aufgabenProben: [string, string, string | null, boolean][] = [
    ["AUFGABE_LEER_ABGEWIESEN", "aufgabe", "   ", true],
    ["AUFGABE_NULL_ABGEWIESEN", "aufgabe", null, true],
    ["AUFGABE_501_ABGEWIESEN", "aufgabe", "x".repeat(501), true],
    ["AUFGABE_500_ERLAUBT", "aufgabe", "x".repeat(500), false],
    ["AUFGABE_AN_FREMDEM_TYP_ABGEWIESEN", "aenderung_eintrag", "Bitte aktualisieren", true],
  ];
  for (const [name, typ, text, sollFehler] of aufgabenProben) {
    const r = await probe((tx) => aufgabe(tx, typ, text));
    const ok = sollFehler ? !!r.fehler && /inbox_eintrag_aufgabe_check/.test(r.fehler) : !r.fehler;
    console.log(`${name} ${ok}${r.fehler ? ` (${r.fehler.slice(0, 80)})` : ""}`);
    if (!ok) fehler.push(`${name}: ${sollFehler ? "kam durch" : r.fehler}`);
  }

  // (4c) AP2.5 PR a1: Hinweis mit Objektbezug Akteur — ohne Urheber erlaubt, zweimal (NULLS NOT DISTINCT) abgewiesen,
  //      Akteur UND Strom zugleich abgewiesen (genau ein Objekt).
  const [einAkteur] = await sql`select id from akteur order by created_at limit 1`;
  if (einAkteur) {
    const verwaistHinweis = (tx: postgres.TransactionSql, bezugsdatum: string | null) => tx`
      insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, akteur_id, ereignis_id, bezugsdatum)
      values (${nutzer.id}, null, 'akteur_verwaist', ${einAkteur.id}, null, ${bezugsdatum})`;
    const akteurProben: [string, (tx: postgres.TransactionSql) => Promise<unknown>, RegExp | null][] = [
      ["AKTEUR_HINWEIS_ERLAUBT", (tx) => verwaistHinweis(tx, "2026-01-01"), null],
      ["AKTEUR_HINWEIS_ZWEIMAL_ABGEWIESEN", async (tx) => { await verwaistHinweis(tx, "2026-01-01"); await verwaistHinweis(tx, "2026-01-01"); }, /inbox_eintrag_akteur_hinweis_uidx/],
      ["AKTEUR_HINWEIS_ZWEIMAL_OHNE_DATUM_ABGEWIESEN", async (tx) => { await verwaistHinweis(tx, null); await verwaistHinweis(tx, null); }, /inbox_eintrag_akteur_hinweis_uidx/],
      ["AKTEUR_UND_STROM_ABGEWIESEN", (tx) => tx`insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, akteur_id, biomassestrom_id, ereignis_id, bezugsdatum)
        values (${nutzer.id}, null, 'akteur_verwaist', ${einAkteur.id}, ${strom.id}, null, '2026-01-01')`, /inbox_eintrag_genau_ein_strom_check/],
    ];
    for (const [name, fn, soll] of akteurProben) {
      const r = await probe(fn);
      const ok = soll ? !!r.fehler && soll.test(r.fehler) : !r.fehler;
      console.log(`${name} ${ok}${r.fehler ? ` (${r.fehler.slice(0, 80)})` : ""}`);
      if (!ok) fehler.push(`${name}: ${soll ? "kam durch" : r.fehler}`);
    }
  } else {
    console.log("AKTEUR_HINWEIS uebersprungen: kein Akteur");
  }

  // (5) PR c: Zugriffsanfrage — Index (Empfaenger, Strom, Anfragender) greift.
  const [zweiter] = await sql`select id from benutzer where id <> ${nutzer.id} order by email limit 1`;
  const anfrage = (tx: postgres.TransactionSql, ausloeser: string) => tx`
    insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, biomassestrom_id, ereignis_id)
    values (${nutzer.id}, ${ausloeser}, 'zugriffsanfrage', ${strom.id}, ${ereignis.id})`;
  const doppelteAnfrage = await probe(async (tx) => {
    await anfrage(tx, nutzer.id);
    await anfrage(tx, nutzer.id);
  });
  console.log(`ZWEITE_ANFRAGE_DERSELBEN_PERSON_ABGEWIESEN ${!!doppelteAnfrage.fehler}`);
  if (!doppelteAnfrage.fehler) fehler.push("zweite offene Zugriffsanfrage derselben Person kam durch — Index greift nicht");
  if (zweiter) {
    const zweiAnfragende = await probe(async (tx) => {
      await anfrage(tx, nutzer.id);
      await anfrage(tx, zweiter.id);
      const [n] = await tx`select count(*)::int as n from inbox_eintrag where empfaenger_id = ${nutzer.id} and biomassestrom_id = ${strom.id} and typ = 'zugriffsanfrage'`;
      return n!.n;
    });
    console.log(`ZWEI_ANFRAGENDE ${JSON.stringify(zweiAnfragende)}`);
    if (zweiAnfragende.ergebnis !== 2) fehler.push(`zwei Anfragende ergeben nicht zwei Eintraege: ${JSON.stringify(zweiAnfragende)}`);
  } else {
    console.log("ZWEI_ANFRAGENDE uebersprungen (nur ein Benutzer)");
  }

  // (6) AP2.4: Pruefauftrag — je Pruefer und Strom ein offener Eintrag; nach erledigt ein neuer.
  const auftrag = (tx: postgres.TransactionSql) => tx`
    insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, biomassestrom_id, ereignis_id)
    values (${nutzer.id}, ${nutzer.id}, 'pruefauftrag', ${strom.id}, ${ereignis.id})`;
  const doppelterAuftrag = await probe(async (tx) => {
    await auftrag(tx);
    await auftrag(tx);
  });
  console.log(`ZWEITER_PRUEFAUFTRAG_ABGEWIESEN ${!!doppelterAuftrag.fehler}`);
  if (!doppelterAuftrag.fehler) fehler.push("zweiter offener pruefauftrag fuer denselben Pruefer und Strom kam durch — Index greift nicht");
  const auftragNachErledigt = await probe(async (tx) => {
    await auftrag(tx);
    await tx`update inbox_eintrag set zustand = 'erledigt', zustand_seit = now() where empfaenger_id = ${nutzer.id} and biomassestrom_id = ${strom.id} and typ = 'pruefauftrag'`;
    await auftrag(tx);
    const [n] = await tx`select count(*)::int as n from inbox_eintrag where empfaenger_id = ${nutzer.id} and biomassestrom_id = ${strom.id} and typ = 'pruefauftrag'`;
    return n!.n;
  });
  console.log(`PRUEFAUFTRAG_NACH_ERLEDIGT ${JSON.stringify(auftragNachErledigt)}`);
  if (auftragNachErledigt.ergebnis !== 2) fehler.push(`nach erledigt entsteht kein neuer pruefauftrag: ${JSON.stringify(auftragNachErledigt)}`);

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
