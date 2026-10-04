/**
 * AP2.3 PR a (E60): dauerhafter DB-Check der Parameter mit Verlauf — laeuft
 * im Deploy-CI gegen die echte Preview-DB. Zusicherungen:
 *
 * 1. Tabellen, Funktion parameter_wert() und beide Trigger stehen (0029);
 *    sechs Startwerte mit gueltig_ab = '-infinity' (vier Fristen aus 0029,
 *    verifikation.vorlauf_tage aus 0033, akteur.verwaist_hinweis_monate aus
 *    0035, AP2.5 PR a1); jeder Schluessel ist heute
 *    aufloesbar.
 * 2. Nie rueckwirkend: eine Zeile mit gueltig_ab = gestern wird vom CHECK
 *    abgewiesen.
 * 3. UPDATE wird immer abgewiesen (Trigger).
 * 4. DELETE eines geltenden Werts wird abgewiesen; DELETE eines kuenftigen
 *    Werts geht durch (Trigger).
 * 5. Wertebereich: ein Wert ausserhalb min/max wird abgewiesen.
 * 6. Wirksamkeit ab Datum: ein kuenftiger Wert ab X aendert parameter_wert()
 *    fuer Stichtage < X nicht, ab X schon; kein Treffer = Fehler.
 * 7. Basisdatum = Kalendertag Europe/Berlin (PR b): ein Beleg um 00:30 Berlin
 *    am Tag einer Friständerung bekommt die NEUE Frist. In UTC liegt derselbe
 *    Zeitpunkt noch am Vortag (22:30Z/23:30Z) — die alte Ableitung ueber
 *    ::date in Sitzungszeit haette die alte Frist geliefert. Geprueft wird
 *    der Ausdruck aus apps/web/lib/stroeme.ts (at time zone) gegen die
 *    UTC-Variante an einem echten Beleg (zurueckgerollt).
 *
 * Schreibt nichts Bleibendes: jede Probe laeuft in einer Transaktion, die
 * zurueckgerollt wird.
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
  console.log(`PARAMETERCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];
  const S = "verifikationsfrist.gespraech";

  // (1) Strukturen
  const [t] = await sql`select count(*)::int as n from information_schema.tables where table_name in ('parameter_definition', 'parameter_wert')`;
  const [f] = await sql`select count(*)::int as n from pg_proc where proname = 'parameter_wert'`;
  const [tr] = await sql`select count(*)::int as n from pg_trigger where tgrelid = to_regclass('parameter_wert') and not tgisinternal`;
  console.log(`STRUKTUR tabellen=${t!.n}/2 funktion=${f!.n} trigger=${tr!.n}/2`);
  if (t!.n !== 2 || f!.n !== 1 || tr!.n !== 2) {
    console.error("PARAMETERCHECK FEHLER: Migration 0029 fehlt (Tabellen / Funktion / Trigger)");
    await sql.end();
    process.exit(1);
  }
  const start = await sql`select schluessel, wert from parameter_wert where gueltig_ab = '-infinity' order by schluessel`;
  const heute = await sql`select schluessel, parameter_wert(schluessel, current_date) as heute from parameter_definition order by schluessel`;
  console.log("STARTWERTE " + JSON.stringify(start.map((z) => `${z.schluessel}=${z.wert}`)));
  console.log("HEUTE " + JSON.stringify(heute.map((z) => `${z.schluessel}=${z.heute}`)));
  const ERWARTET = ["verifikationsfrist.gespraech", "verifikationsfrist.dokument", "verifikationsfrist.webrecherche", "verifikationsfrist.reservierung", "verifikation.vorlauf_tage", "akteur.verwaist_hinweis_monate"];
  const fehlendeStart = ERWARTET.filter((k) => !start.some((z) => z.schluessel === k));
  // Journal-Vergleich (Eric 01.10.2026): Startwerte exakt bei gleichem Journal, mindestens wenn die DB voraus ist.
  const journal = await journalModus(sql, url!);
  console.log(modusText(journal));
  if (journal.modus === "rot") fehler.push(journal.grund);
  const modus = journal.modus === "mindest" ? "mindest" : "exakt";
  const z1 = zaehlerPasst("Startwerte", start.length, ERWARTET.length, modus);
  if (z1 || fehlendeStart.length) fehler.push(`${z1 ?? `${start.length} Startwerte`} (fehlend: ${fehlendeStart.join(", ") || "–"})`);
  const z2 = zaehlerPasst("aufloesbare Schluessel", heute.length, ERWARTET.length, modus);
  if (z2) fehler.push("nicht jeder Schluessel ist heute aufloesbar: " + z2);
  const vorlauf = heute.find((z) => z.schluessel === "verifikation.vorlauf_tage");
  if (!vorlauf || Number(vorlauf.heute) !== 7) fehler.push(`verifikation.vorlauf_tage heute ${vorlauf?.heute} statt 7 (Startwert E63)`);
  // AP2.5 PR a1 (E66): Verwaist-Hinweis nach 6 Monaten (Startwert seit Einfuehrung).
  const verwaist = heute.find((z) => z.schluessel === "akteur.verwaist_hinweis_monate");
  if (!verwaist || Number(verwaist.heute) !== 6) fehler.push(`akteur.verwaist_hinweis_monate heute ${verwaist?.heute} statt 6 (Startwert E66)`);

  const [wer] = await sql`select id from benutzer order by email limit 1`;
  if (!wer) {
    console.log("PROBEN uebersprungen: kein Benutzer");
    await sql.end();
    console.log("PARAMETERCHECK OK (nur Struktur)");
    return;
  }

  // (2) CHECK nie rueckwirkend
  const rueck = await probe((tx) => tx`insert into parameter_wert (schluessel, wert, gueltig_ab, begruendung, erstellt_von)
    values (${S}, 4, current_date - 1, 'probe', ${wer.id})`);
  console.log(`RUECKWIRKEND_ABGEWIESEN ${!!rueck.fehler}`);
  if (!rueck.fehler) fehler.push("rueckwirkender Wert kam durch — CHECK greift nicht");

  // (3) UPDATE
  const upd = await probe((tx) => tx`update parameter_wert set wert = wert + 1 where schluessel = ${S} and gueltig_ab = '-infinity'`);
  console.log(`UPDATE_ABGEWIESEN ${!!upd.fehler}`);
  if (!upd.fehler) fehler.push("UPDATE kam durch — Trigger greift nicht");

  // (4) DELETE geltend vs. kuenftig
  const delGeltend = await probe((tx) => tx`delete from parameter_wert where schluessel = ${S} and gueltig_ab = '-infinity'`);
  console.log(`DELETE_GELTEND_ABGEWIESEN ${!!delGeltend.fehler}`);
  if (!delGeltend.fehler) fehler.push("DELETE eines geltenden Werts kam durch — Trigger greift nicht");
  const delKuenftig = await probe(async (tx) => {
    const [z] = await tx`insert into parameter_wert (schluessel, wert, gueltig_ab, begruendung, erstellt_von)
      values (${S}, 4, current_date + 30, 'probe kuenftig', ${wer.id}) returning id`;
    await tx`delete from parameter_wert where id = ${z!.id}`;
    const [n] = await tx`select count(*)::int as n from parameter_wert where id = ${z!.id}`;
    return n!.n;
  });
  console.log(`DELETE_KUENFTIG_ERLAUBT ${delKuenftig.ergebnis === 0} ${delKuenftig.fehler ?? ""}`);
  if (delKuenftig.ergebnis !== 0) fehler.push(`DELETE eines kuenftigen Werts scheitert: ${delKuenftig.fehler}`);

  // (5) Wertebereich
  const bereich = await probe((tx) => tx`insert into parameter_wert (schluessel, wert, gueltig_ab, begruendung, erstellt_von)
    values (${S}, 999, current_date + 30, 'probe bereich', ${wer.id})`);
  console.log(`BEREICH_ABGEWIESEN ${!!bereich.fehler}`);
  if (!bereich.fehler) fehler.push("Wert ausserhalb min/max kam durch — Bereichs-Trigger greift nicht");

  // (6) Wirksamkeit ab Datum
  const wirk = await probe(async (tx) => {
    await tx`insert into parameter_wert (schluessel, wert, gueltig_ab, begruendung, erstellt_von)
      values (${S}, 4, current_date + 30, 'probe wirksamkeit', ${wer.id})`;
    const [r] = await tx`select parameter_wert(${S}, current_date + 29) as vorher, parameter_wert(${S}, current_date + 30) as ab, parameter_wert(${S}, current_date + 400) as spaeter`;
    let ohne = "kein Fehler";
    try {
      await tx.savepoint(async (sp) => { await sp`select parameter_wert('gibt.es.nicht', current_date)`; });
    } catch (e) {
      ohne = e instanceof Error ? e.message.slice(0, 60) : String(e);
    }
    return { vorher: Number(r!.vorher), ab: Number(r!.ab), spaeter: Number(r!.spaeter), ohne };
  });
  console.log("WIRKSAMKEIT " + JSON.stringify(wirk.ergebnis ?? { fehler: wirk.fehler }));
  if (!wirk.ergebnis || wirk.ergebnis.vorher !== 3 || wirk.ergebnis.ab !== 4 || wirk.ergebnis.spaeter !== 4 || wirk.ergebnis.ohne === "kein Fehler") {
    fehler.push("Wirksamkeit ab Datum stimmt nicht (vorher 3, ab 4, spaeter 4, unbekannter Schluessel = Fehler)");
  }

  // (7) Beleg um 00:30 Berlin am Tag der Friständerung
  const tag = await probe(async (tx) => {
    // Aenderung ab morgen (Berlin) — nie rueckwirkend, also nicht heute.
    const [m] = await tx`select ((now() at time zone 'Europe/Berlin')::date + 1)::text as morgen`;
    const morgen = m!.morgen as string;
    await tx`insert into parameter_wert (schluessel, wert, gueltig_ab, begruendung, erstellt_von)
      values (${S}, 9, ${morgen}::date, 'probe kalendertag', ${wer.id})`;
    const [b] = await tx`insert into beleg (typ, metadata, erstellt_am)
      values ('gespraech', ${tx.json({ quellenangabe: "Parameter-Check PR b" })},
              (${morgen} || ' 00:30')::timestamp at time zone 'Europe/Berlin')
      returning id`;
    const [r] = await tx`select
        (erstellt_am at time zone 'Europe/Berlin')::date::text as tag_berlin,
        (erstellt_am at time zone 'UTC')::date::text as tag_utc,
        parameter_wert('verifikationsfrist.' || typ::text, (erstellt_am at time zone 'Europe/Berlin')::date) as frist_berlin,
        parameter_wert('verifikationsfrist.' || typ::text, (erstellt_am at time zone 'UTC')::date) as frist_utc
      from beleg where id = ${b!.id}`;
    return { morgen, tagBerlin: r!.tag_berlin as string, tagUtc: r!.tag_utc as string, fristBerlin: Number(r!.frist_berlin), fristUtc: Number(r!.frist_utc) };
  });
  console.log("KALENDERTAG_BERLIN " + JSON.stringify(tag.ergebnis ?? { fehler: tag.fehler }));
  if (!tag.ergebnis || tag.ergebnis.tagBerlin !== tag.ergebnis.morgen || tag.ergebnis.fristBerlin !== 9 || tag.ergebnis.tagUtc === tag.ergebnis.morgen || tag.ergebnis.fristUtc !== 3) {
    fehler.push("Basisdatum: Beleg um 00:30 Berlin am Tag der Aenderung muss die neue Frist (9) tragen, in UTC laege er am Vortag (3)");
  }

  await sql.end();
  if (fehler.length) {
    console.error("PARAMETERCHECK FEHLER: " + fehler.join("; "));
    process.exit(1);
  }
  console.log("PARAMETERCHECK OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
