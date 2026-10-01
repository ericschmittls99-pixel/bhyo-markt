/**
 * AP2.4 PR a (E62): dauerhafter DB-Check des Verifikationsmodells — laeuft im
 * Deploy-CI gegen die echte Preview-DB. Zusicherungen:
 *
 * 1. Struktur (Migration 0032): Funktion strom_verifikation(date), Spalte
 *    beleg.abgelaufen_am, die sieben neuen Ereignisarten, qualitaetsstufe()
 *    mit vier Parametern.
 * 2. Ableitung je Zustand an einem echten Strom (zurueckgerollt):
 *    entwurf → ungeprueft · in_pruefung → in_pruefung · geprueft ohne
 *    Pruefereignis → pruefdatum_unbekannt · geprueft ohne Beleg →
 *    pruefdatum_unbekannt · geprueft + Ereignis geprueft + Gespraech →
 *    gueltig mit verifiziert_bis = Kalendertag Berlin des Pruefens + Typ-
 *    Frist aus parameter_wert() an diesem Tag, am Folgetag von
 *    verifiziert_bis abgelaufen · Vertrag mit gueltig_bis → verifiziert_bis =
 *    gueltig_bis · abgelaufen_am gesetzt → als_abgelaufen_markiert.
 * 3. D3: die Markierung wertet die Qualitaet um eine Stufe ab (A→B, D bleibt
 *    D) — GENERATED-Spalte, nicht die App.
 * 4. PR b (Migration 0033): Ereignisart reverifiziert, Inbox-Typen der
 *    Hinweise, Parameter verifikation.vorlauf_tage, Tabelle job_lauf.
 *    Ableitung: geprueft ohne Beleg → ohne_beleg · reverifiziert zaehlt als
 *    neuer Prueftag · gueltig_bis innerhalb des Vorlaufs → laeuft_bald_ab,
 *    ausserhalb → gueltig, am Tag selbst noch laeuft_bald_ab, am Folgetag
 *    abgelaufen. DB-Regeln: Hinweis zweimal mit demselben Bezugsdatum (auch
 *    NULL) → Unique-Verletzung; Hinweis ohne Urheber erlaubt, jeder andere
 *    Typ ohne Urheber → CHECK; job_lauf zweimal am Stichtag → Unique.
 *
 * Nichts bleibt liegen: jede Probe in einer zurueckgerollten Transaktion.
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

interface Zeile {
  zustand: string;
  verifiziert_bis: string | null;
  verifiziert_am: string | null;
}

async function main() {
  const ziel = new URL(url!);
  console.log(`VERIFIKATIONCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  // (1) Struktur
  const [fn] = await sql`select count(*)::int as n from pg_proc where proname = 'strom_verifikation'`;
  const [sp] = await sql`select count(*)::int as n from information_schema.columns where table_name = 'beleg' and column_name = 'abgelaufen_am'`;
  const [q] = await sql`select count(*)::int as n from pg_proc where proname = 'qualitaetsstufe' and pronargs = 4`;
  const arten = (await sql`select enumlabel from pg_enum where enumtypid = 'ereignis_art'::regtype`).map((r) => r.enumlabel as string);
  const NEU = ["in_pruefung_gegeben", "geprueft", "zurueckgegeben", "reaktiviert", "zurueckgesetzt", "als_abgelaufen_markiert", "abgelaufen_aufgehoben", "reverifiziert"];
  const fehlend = NEU.filter((a) => !arten.includes(a));
  // PR b (0033)
  const typen = (await sql`select enumlabel from pg_enum where enumtypid = 'inbox_typ'::regtype`).map((r) => r.enumlabel as string);
  const typenFehlend = ["verifikation_laeuft_ab", "verifikation_abgelaufen"].filter((t) => !typen.includes(t));
  const [jl] = await sql`select count(*)::int as n from information_schema.tables where table_name = 'job_lauf'`;
  const [hx] = await sql`select count(*)::int as n from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname in ('inbox_eintrag_biomasse_hinweis_uidx', 'inbox_eintrag_output_hinweis_uidx') and i.indisunique and i.indnullsnotdistinct`;
  const [vl] = await sql`select count(*)::int as n from parameter_definition where schluessel = 'verifikation.vorlauf_tage'`;
  console.log(
    `STRUKTUR funktion=${fn!.n} abgelaufen_am=${sp!.n} qualitaetsstufe4=${q!.n} arten_fehlend=${JSON.stringify(fehlend)} typen_fehlend=${JSON.stringify(typenFehlend)} job_lauf=${jl!.n} hinweis_indizes=${hx!.n} vorlauf_parameter=${vl!.n}`,
  );
  if (fn!.n !== 1 || sp!.n !== 1 || q!.n !== 1 || fehlend.length || typenFehlend.length || jl!.n !== 1 || hx!.n !== 2 || vl!.n !== 1) {
    console.error("::error::VERIFIKATION-CHECK VERLETZT (Migration 0032/0033 fehlt): Funktion / Spalte / qualitaetsstufe / Ereignisarten / Inbox-Typen / job_lauf / Hinweis-Indizes / Parameter");
    await sql.end();
    process.exit(1);
  }

  const [nutzer] = await sql`select id from benutzer order by email limit 1`;
  const [strom] = await sql`select id from biomassestrom order by created_at limit 1`;
  if (!nutzer || !strom) {
    console.log(`PROBEN uebersprungen: benutzer=${!!nutzer} strom=${!!strom}`);
    await sql.end();
    console.log("VERIFIKATIONCHECK OK (nur Struktur)");
    return;
  }

  const lies = async (tx: postgres.TransactionSql, stichtag: string): Promise<Zeile> => {
    const [z] = await tx`select zustand, verifiziert_bis::text as verifiziert_bis, verifiziert_am::text as verifiziert_am
      from strom_verifikation(${stichtag}::date) where art = 'biomasse' and strom_id = ${strom.id}`;
    return z as unknown as Zeile;
  };
  const setze = (tx: postgres.TransactionSql, status: string, belegId: string | null) =>
    tx`update biomassestrom set status = ${status}::datensatz_status, beleg_id = ${belegId} where id = ${strom.id}`;
  const beleg = async (tx: postgres.TransactionSql, typ: string, gueltigBis: string | null, dateiKey: string | null) => {
    const [b] = await tx`insert into beleg (typ, metadata, gueltig_bis, datei_key, link_url, erstellt_am)
      values (${typ}::beleg_typ, ${tx.json({ quellenangabe: "Verifikation-Check" })}, ${gueltigBis}, ${dateiKey}, null, now())
      returning id`;
    return b!.id as string;
  };
  const pruefEreignis = (tx: postgres.TransactionSql, art: "geprueft" | "reverifiziert" = "geprueft", zeitpunkt: string | null = null) =>
    zeitpunkt
      ? tx`insert into aenderung (entitaet_typ, entitaet_id, text, art, benutzer_id, zeitpunkt)
           values ('biomassestrom', ${strom.id}, 'Verifikation-Check', ${art}::ereignis_art, ${nutzer.id}, ${zeitpunkt}::timestamptz)`
      : tx`insert into aenderung (entitaet_typ, entitaet_id, text, art, benutzer_id)
           values ('biomassestrom', ${strom.id}, 'Verifikation-Check', ${art}::ereignis_art, ${nutzer.id})`;
  const erwarte = (name: string, ist: Zeile | undefined, zustand: string, bis?: string | null) => {
    console.log(`ZUSTAND ${name}: ${JSON.stringify(ist)}`);
    if (!ist || ist.zustand !== zustand) fehler.push(`${name}: Zustand ${ist?.zustand} statt ${zustand}`);
    if (bis !== undefined && ist && ist.verifiziert_bis !== bis) fehler.push(`${name}: verifiziert_bis ${ist.verifiziert_bis} statt ${bis}`);
  };

  // (2) Ableitung je Zustand
  const [heuteZ] = await sql`select (now() at time zone 'Europe/Berlin')::date::text as heute`;
  const heute = heuteZ!.heute as string;

  const a = await probe(async (tx) => {
    const b = await beleg(tx, "gespraech", null, null);
    await setze(tx, "entwurf", b);
    const entwurf = await lies(tx, heute);
    await setze(tx, "in_pruefung", b);
    const inPruefung = await lies(tx, heute);
    await setze(tx, "geprueft", b);
    const ohneEreignis = await lies(tx, heute);
    await setze(tx, "geprueft", null);
    const ohneBeleg = await lies(tx, heute);
    return { entwurf, inPruefung, ohneEreignis, ohneBeleg };
  });
  if (!a.ergebnis) fehler.push(`Probe Zustaende: ${a.fehler}`);
  erwarte("entwurf", a.ergebnis?.entwurf, "ungeprueft", null);
  erwarte("in_pruefung", a.ergebnis?.inPruefung, "in_pruefung", null);
  erwarte("geprueft ohne Pruefereignis", a.ergebnis?.ohneEreignis, "pruefdatum_unbekannt", null);
  // PR b: geprueft ohne Beleg ist ein eigener Zustand (Entscheidung Eric 01.10.2026).
  erwarte("geprueft ohne Beleg", a.ergebnis?.ohneBeleg, "ohne_beleg", null);

  const b = await probe(async (tx) => {
    const bl = await beleg(tx, "gespraech", null, null);
    await setze(tx, "geprueft", bl);
    await pruefEreignis(tx);
    const [erw] = await tx`select ((now() at time zone 'Europe/Berlin')::date
      + make_interval(months => parameter_wert('verifikationsfrist.gespraech', (now() at time zone 'Europe/Berlin')::date)))::date::text as bis`;
    const gueltig = await lies(tx, heute);
    const [folgetag] = await tx`select (${erw!.bis}::date + 1)::text as t`;
    const abgelaufen = await lies(tx, folgetag!.t as string);
    // PR b: ein aelteres geprueft-Ereignis (vor 13 Monaten) und ein reverifiziert von heute:
    // verifiziert_am ist das reverifiziert, die Frist zaehlt ab heute.
    await tx`delete from aenderung where entitaet_id = ${strom.id} and text = 'Verifikation-Check'`;
    await pruefEreignis(tx, "geprueft", "2025-09-01T10:00:00Z");
    const alt = await lies(tx, heute);
    await pruefEreignis(tx, "reverifiziert");
    const reverifiziert = await lies(tx, heute);
    return { erwartetBis: erw!.bis as string, gueltig, abgelaufen, alt, reverifiziert };
  });
  if (!b.ergebnis) fehler.push(`Probe Typ-Frist: ${b.fehler}`);
  erwarte("geprueft + Gespraech (Frist ab Prueftag)", b.ergebnis?.gueltig, "gueltig", b.ergebnis?.erwartetBis);
  erwarte("Folgetag von verifiziert_bis", b.ergebnis?.abgelaufen, "abgelaufen", b.ergebnis?.erwartetBis);
  erwarte("altes geprueft (13 Monate)", b.ergebnis?.alt, "abgelaufen");
  erwarte("reverifiziert heute = neuer Prueftag", b.ergebnis?.reverifiziert, "gueltig", b.ergebnis?.erwartetBis);

  const c = await probe(async (tx) => {
    const [gb] = await tx`select (current_date + 10)::text as t, (current_date + 11)::text as t1`;
    const bl = await beleg(tx, "vertrag", gb!.t as string, "belege/preview/check.pdf");
    await setze(tx, "geprueft", bl);
    await pruefEreignis(tx);
    const gueltig = await lies(tx, heute);
    const abgelaufen = await lies(tx, gb!.t1 as string);
    const [vorher] = await tx`select qualitaet::text as q from beleg where id = ${bl}`;
    await tx`update beleg set abgelaufen_am = current_date where id = ${bl}`;
    const markiert = await lies(tx, heute);
    const [nachher] = await tx`select qualitaet::text as q from beleg where id = ${bl}`;
    const bw = await beleg(tx, "webrecherche", null, null);
    const [dVorher] = await tx`select qualitaet::text as q from beleg where id = ${bw}`;
    await tx`update beleg set abgelaufen_am = current_date where id = ${bw}`;
    const [dNachher] = await tx`select qualitaet::text as q from beleg where id = ${bw}`;
    return { gueltigBis: gb!.t as string, gueltig, abgelaufen, markiert, vorher: vorher!.q, nachher: nachher!.q, dVorher: dVorher!.q, dNachher: dNachher!.q };
  });
  if (!c.ergebnis) fehler.push(`Probe gueltig_bis/Markierung: ${c.fehler}`);
  erwarte("geprueft + Vertrag (gueltig_bis)", c.ergebnis?.gueltig, "gueltig", c.ergebnis?.gueltigBis);
  erwarte("Vertrag nach gueltig_bis", c.ergebnis?.abgelaufen, "abgelaufen", c.ergebnis?.gueltigBis);
  erwarte("abgelaufen_am gesetzt", c.ergebnis?.markiert, "als_abgelaufen_markiert");
  // (3) D3: Abwertung
  console.log(`QUALITAET_ABWERTUNG vertrag ${c.ergebnis?.vorher}->${c.ergebnis?.nachher} webrecherche ${c.ergebnis?.dVorher}->${c.ergebnis?.dNachher}`);
  if (c.ergebnis && !(c.ergebnis.vorher === "A" && c.ergebnis.nachher === "B")) fehler.push("Markierung wertet Vertrag A nicht auf B ab");
  if (c.ergebnis && !(c.ergebnis.dVorher === "D" && c.ergebnis.dNachher === "D")) fehler.push("D bleibt nicht D");

  // (4) PR b: Vorlauf — gueltig_bis innerhalb von vorlauf_tage → laeuft_bald_ab; am Tag selbst noch; Folgetag abgelaufen.
  const d = await probe(async (tx) => {
    const [v] = await tx`select parameter_wert('verifikation.vorlauf_tage', ${heute}::date) as vorlauf`;
    const vorlauf = Number(v!.vorlauf);
    const [t] = await tx`select (${heute}::date + ${vorlauf})::text as innen, (${heute}::date + ${vorlauf} + 1)::text as aussen`;
    const bl = await beleg(tx, "vertrag", t!.innen as string, "belege/preview/check.pdf");
    await setze(tx, "geprueft", bl);
    await pruefEreignis(tx);
    const innen = await lies(tx, heute);
    await tx`update beleg set gueltig_bis = ${t!.aussen as string} where id = ${bl}`;
    const aussen = await lies(tx, heute);
    await tx`update beleg set gueltig_bis = ${heute} where id = ${bl}`;
    const amTag = await lies(tx, heute);
    const [morgen] = await tx`select (${heute}::date + 1)::text as t`;
    const folgetag = await lies(tx, morgen!.t as string);
    return { vorlauf, innen, aussen, amTag, folgetag, bisInnen: t!.innen as string };
  });
  if (!d.ergebnis) fehler.push(`Probe Vorlauf: ${d.fehler}`);
  console.log(`VORLAUF_TAGE ${d.ergebnis?.vorlauf}`);
  erwarte("gueltig_bis = heute + Vorlauf", d.ergebnis?.innen, "laeuft_bald_ab", d.ergebnis?.bisInnen);
  erwarte("gueltig_bis = heute + Vorlauf + 1", d.ergebnis?.aussen, "gueltig");
  erwarte("gueltig_bis = heute", d.ergebnis?.amTag, "laeuft_bald_ab", heute);
  erwarte("gueltig_bis = heute, Folgetag", d.ergebnis?.folgetag, "abgelaufen", heute);

  // (5) PR b: DB-Regeln der Hinweise und des Job-Protokolls (jede Probe zurueckgerollt).
  const hinweis = (tx: postgres.TransactionSql, typ: string, bezugsdatum: string | null) =>
    tx`insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, biomassestrom_id, ereignis_id, bezugsdatum)
       values (${nutzer.id}, null, ${typ}::inbox_typ, ${strom.id}, null, ${bezugsdatum})`;
  const regel = async (name: string, fn: (tx: postgres.TransactionSql) => Promise<unknown>, erwartetFehler: RegExp | null) => {
    const r = await probe(fn);
    const ok = erwartetFehler ? !!r.fehler && erwartetFehler.test(r.fehler) : !r.fehler;
    console.log(`REGEL ${name}: ${ok ? "OK" : "VERLETZT"} ${r.fehler ? `(${r.fehler.slice(0, 90)})` : ""}`);
    if (!ok) fehler.push(`Regel ${name}`);
  };
  await regel("Hinweis ohne Urheber erlaubt", (tx) => hinweis(tx, "verifikation_abgelaufen", null), null);
  await regel("Hinweis zweimal ohne Bezugsdatum (NULLS NOT DISTINCT)", async (tx) => {
    await hinweis(tx, "verifikation_abgelaufen", null);
    await hinweis(tx, "verifikation_abgelaufen", null);
  }, /inbox_eintrag_biomasse_hinweis_uidx/);
  await regel("Hinweis zweimal mit Bezugsdatum", async (tx) => {
    await hinweis(tx, "verifikation_laeuft_ab", heute);
    await hinweis(tx, "verifikation_laeuft_ab", heute);
  }, /inbox_eintrag_biomasse_hinweis_uidx/);
  await regel("zwei Bezugsdaten = zwei Hinweise", async (tx) => {
    await hinweis(tx, "verifikation_laeuft_ab", heute);
    await hinweis(tx, "verifikation_laeuft_ab", "2030-01-01");
  }, null);
  await regel("aenderung_eintrag ohne Urheber abgewiesen", (tx) => hinweis(tx, "aenderung_eintrag", null), /inbox_eintrag_urheber_check/);
  await regel("job_lauf zweimal am Stichtag", async (tx) => {
    await tx`insert into job_lauf (job, stichtag) values ('verifikation-check', ${heute})`;
    await tx`insert into job_lauf (job, stichtag) values ('verifikation-check', ${heute})`;
  }, /job_lauf_job_stichtag_unique/);
  await regel("job_lauf: ergebnis nur laeuft/ok/fehler", (tx) => tx`insert into job_lauf (job, stichtag, ergebnis) values ('verifikation-check', ${heute}, 'halb')`, /job_lauf_ergebnis_check/);

  await sql.end();
  if (fehler.length) {
    console.error("::error::VERIFIKATION-CHECK VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("VERIFIKATIONCHECK OK");
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
