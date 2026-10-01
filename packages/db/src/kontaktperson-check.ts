/**
 * AP2.5 PR b (E66/E57/E47): dauerhafter DB-Check der Kontaktpersonen — laeuft im
 * Deploy-CI gegen die echte Preview-DB. Zusicherungen (jede Probe in einer
 * zurueckgerollten Transaktion):
 *
 * 1. Struktur (Migration 0036): Tabelle kontaktperson mit fuenf CHECKs, Trigger
 *    kontaktperson_kein_umhaengen, Inbox-Typ kontaktperson_loeschpruefung,
 *    Spalte inbox_eintrag.kontaktperson_id, Parameter kontaktperson.loeschpruefung_monate.
 * 2. Regeln: kein Umhaengen (UPDATE akteur_id abgewiesen), Laengengrenzen
 *    (Name leer / 201, Notiz 1001 abgewiesen), Hinweis zweimal (NULLS NOT
 *    DISTINCT) abgewiesen.
 * 3. DSGVO-Probe: eine Person mit Sentinel-Namen anlegen, Ereignis (nur IDs)
 *    und Loeschpruefungs-Hinweis dazu schreiben, die Person loeschen — danach
 *    ist der Name in KEINER Text-/JSON-Spalte des Schemas mehr zu finden und
 *    der Hinweis ist mit geloescht (CASCADE). Rot-Nachweis: ein Ereignistext
 *    mit dem Namen wird gefunden.
 */
import postgres from "postgres";

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

/** Sucht einen Text in allen text/varchar/jsonb-Spalten des Schemas public (DSGVO-Probe). */
async function sucheText(tx: postgres.TransactionSql, needle: string): Promise<string[]> {
  const spalten = (await tx`select table_name, column_name, data_type from information_schema.columns
    where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY')`) as unknown as { table_name: string; column_name: string; data_type: string }[];
  const treffer: string[] = [];
  for (const s of spalten) {
    const [r] = await tx.unsafe(`select count(*)::int as n from "${s.table_name}" where "${s.column_name}"::text ilike $1`, ["%" + needle + "%"]);
    if (Number(r!.n) > 0) treffer.push(`${s.table_name}.${s.column_name}=${r!.n}`);
  }
  return treffer;
}

async function main() {
  const ziel = new URL(url!);
  console.log(`KONTAKTPERSONCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  // (1) Struktur
  const [t] = await sql`select count(*)::int as n from information_schema.tables where table_name = 'kontaktperson'`;
  const [c] = await sql`select count(*)::int as n from pg_constraint where conrelid = 'kontaktperson'::regclass and contype = 'c'`;
  const [tr] = await sql`select count(*)::int as n from pg_trigger where tgname = 'kontaktperson_kein_umhaengen' and not tgisinternal`;
  const [ty] = await sql`select count(*)::int as n from pg_enum where enumtypid = 'inbox_typ'::regtype and enumlabel = 'kontaktperson_loeschpruefung'`;
  const [sp] = await sql`select count(*)::int as n from information_schema.columns where table_name = 'inbox_eintrag' and column_name = 'kontaktperson_id'`;
  const [pa] = await sql`select count(*)::int as n from parameter_definition where schluessel = 'kontaktperson.loeschpruefung_monate'`;
  console.log(`STRUKTUR tabelle=${t!.n} checks=${c!.n}/5 trigger=${tr!.n} typ=${ty!.n} spalte=${sp!.n} parameter=${pa!.n}`);
  if (t!.n !== 1 || c!.n !== 5 || tr!.n !== 1 || ty!.n !== 1 || sp!.n !== 1 || pa!.n !== 1) {
    console.error("::error::KONTAKTPERSON-CHECK VERLETZT (Migration 0036 fehlt): Tabelle / CHECKs / Trigger / Typ / Spalte / Parameter");
    await sql.end();
    process.exit(1);
  }

  const akteure = (await sql`select id from akteur order by created_at limit 2`) as unknown as { id: string }[];
  const [nutzer] = await sql`select id from benutzer order by email limit 1`;
  if (akteure.length < 1 || !nutzer) {
    console.log(`PROBEN uebersprungen: akteure=${akteure.length} benutzer=${!!nutzer}`);
    await sql.end();
    console.log("KONTAKTPERSONCHECK OK (nur Struktur)");
    return;
  }
  const a1 = akteure[0]!.id;
  const a2 = akteure[1]?.id ?? null;
  const SENTINEL = "Zyx Probenname Qwv";
  const anlegen = (tx: postgres.TransactionSql, name = SENTINEL, notiz: string | null = null) =>
    tx`insert into kontaktperson (akteur_id, name, notiz) values (${a1}, ${name}, ${notiz}) returning id`;

  // (2) Regeln
  const regel = async (name: string, fn: (tx: postgres.TransactionSql) => Promise<unknown>, erwartet: RegExp | null) => {
    const r = await probe(fn);
    const ok = erwartet ? !!r.fehler && erwartet.test(r.fehler) : !r.fehler;
    console.log(`REGEL ${name}: ${ok ? "OK" : "VERLETZT"}${r.fehler ? ` (${r.fehler.slice(0, 80)})` : ""}`);
    if (!ok) fehler.push(`Regel ${name}`);
  };
  await regel("Anlegen erlaubt", (tx) => anlegen(tx), null);
  await regel("Name leer abgewiesen", (tx) => anlegen(tx, "   "), /kontaktperson_name_check/);
  await regel("Name 201 abgewiesen", (tx) => anlegen(tx, "x".repeat(201)), /kontaktperson_name_check/);
  await regel("Notiz 1001 abgewiesen", (tx) => anlegen(tx, SENTINEL, "n".repeat(1001)), /kontaktperson_notiz_check/);
  if (a2) {
    await regel("Umhaengen abgewiesen (Trigger)", async (tx) => {
      const [p] = await anlegen(tx);
      await tx`update kontaktperson set akteur_id = ${a2} where id = ${p!.id}`;
    }, /nicht umgehaengt/);
  } else console.log("REGEL Umhaengen uebersprungen: nur ein Akteur");
  await regel("Hinweis zweimal (NULLS NOT DISTINCT) abgewiesen", async (tx) => {
    const [p] = await anlegen(tx);
    for (let i = 0; i < 2; i++)
      await tx`insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, kontaktperson_id, ereignis_id, bezugsdatum)
               values (${nutzer.id}, null, 'kontaktperson_loeschpruefung', ${p!.id}, null, null)`;
  }, /inbox_eintrag_kontaktperson_hinweis_uidx/);

  // (3) DSGVO-Probe: nach dem Loeschen ist der Name nirgends mehr zu finden, der Hinweis ist mit weg.
  const dsgvo = await probe(async (tx) => {
    const [p] = await anlegen(tx);
    await tx`insert into aenderung (entitaet_typ, entitaet_id, text, art, benutzer_id)
             values ('kontaktperson', ${p!.id}, ${"probe@bhyo.de: Felder: funktion"}, 'kontaktperson_geaendert', ${nutzer.id})`;
    await tx`insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, kontaktperson_id, ereignis_id, bezugsdatum)
             values (${nutzer.id}, null, 'kontaktperson_loeschpruefung', ${p!.id}, null, '2026-01-01')`;
    const vorher = await sucheText(tx, SENTINEL);
    await tx`delete from kontaktperson where id = ${p!.id}`;
    const nachher = await sucheText(tx, SENTINEL);
    const [h] = await tx`select count(*)::int as n from inbox_eintrag where kontaktperson_id = ${p!.id}`;
    return { vorher, nachher, hinweiseDanach: Number(h!.n) };
  });
  console.log("DSGVO " + JSON.stringify(dsgvo.ergebnis ?? { fehler: dsgvo.fehler }));
  if (!dsgvo.ergebnis) fehler.push(`DSGVO-Probe: ${dsgvo.fehler}`);
  else {
    if (!dsgvo.ergebnis.vorher.some((t) => t.startsWith("kontaktperson.name"))) fehler.push("DSGVO-Probe findet den Namen vor dem Loeschen nicht (Suche defekt)");
    if (dsgvo.ergebnis.nachher.length) fehler.push(`Name nach dem Loeschen noch auffindbar: ${dsgvo.ergebnis.nachher.join(", ")}`);
    if (dsgvo.ergebnis.hinweiseDanach !== 0) fehler.push("Loeschpruefungs-Hinweis ueberlebt das Loeschen (kein CASCADE)");
  }

  await sql.end();
  if (fehler.length) {
    console.error("::error::KONTAKTPERSON-CHECK VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("KONTAKTPERSONCHECK OK");
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
