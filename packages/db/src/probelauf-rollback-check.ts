/**
 * AP2.7 PR b (E67, Eric 06.10.2026): Rot-Nachweis gegen die echte Preview-DB
 * fuer zwei Zusicherungen des Probelaufs (Deploy-CI, nur in zurueckgerollten
 * Transaktionen):
 *  1. Der Probelauf veraendert die Datenbank nicht: Zaehlung von akteur,
 *     beleg, biomassestrom, import_zeile und aenderung vorher/nachher — in
 *     einer Transaktion werden Akteur, Beleg, Strom und Zeile angelegt (das
 *     Muster von importProbelauf), dann rollt alles absichtlich zurueck.
 *  2. Eine fehlerhafte Zeile verhindert nicht die uebrigen: innerhalb der
 *     Transaktion scheitert ein Savepoint (CHECK-Verletzung), der naechste
 *     Savepoint legt trotzdem an — die Transaktion bleibt benutzbar.
 * Rot gezeigt im Check selbst: ohne ROLLBACK waeren die Zaehler verschieden;
 * ohne Savepoint waere die Transaktion nach dem Fehler abgebrochen.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });
const ROLLBACK = "PROBELAUFCHECK_ROLLBACK";
const TABELLEN = ["akteur", "beleg", "biomassestrom", "import_lauf", "import_zeile", "aenderung"] as const;

async function zaehlen(q: postgres.Sql | postgres.TransactionSql): Promise<Record<string, number>> {
  const erg: Record<string, number> = {};
  for (const t of TABELLEN) {
    const [r] = await q.unsafe(`select count(*)::int as n from ${t}`);
    erg[t] = (r as unknown as { n: number }).n;
  }
  return erg;
}

async function main() {
  const ziel = new URL(url!);
  console.log(`PROBELAUFCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const vorher = await zaehlen(sql);
  console.log("VORHER " + JSON.stringify(vorher));
  let innen: Record<string, number> | null = null;
  let savepoint = "nicht geprueft";
  try {
    await sql.begin(async (tx) => {
      const [b] = await tx`select id from benutzer limit 1`;
      const [m] = await tx`select code from materialart limit 1`;
      if (!b || !m) throw new Error("probe_fehler: kein benutzer oder keine materialart");
      // 1. Das Muster des Probelaufs: Lauf, Beleg, Akteur, Strom, Ereignis.
      const [lauf] = await tx`insert into import_lauf (art, dateiname, datei_hash, beleg_typ, standard_sektor, ersteller_id)
        values ('biomasse', 'probelauf-check.csv', repeat('1', 64), 'gespraech', 'ohne_sektor', ${b.id}) returning id`;
      const [beleg] = await tx`insert into beleg (typ, metadata, erstellt_am) values ('gespraech', ${sql.json({ quellenangabe: "probelauf-check" })}, now()) returning id`;
      const [akteur] = await tx`insert into akteur (name, sektor, sitz_plz, sitz_ort, sitz_geom, status)
        values ('Probelauf-Check Hof', 'ohne_sektor', '67346', 'Speyer', ST_SetSRID(ST_MakePoint(8.43, 49.32), 4326), 'entwurf') returning id`;
      await tx`insert into biomassestrom (akteur_id, materialart_code, menge_roh_fm, ts_anteil_pct, aschegehalt_pct, zeitraum_von, zeitraum_bis, saisonalitaet, beleg_id, status)
        values (${akteur!.id}, ${m.code}, 100, 8, 1, '2026-01-01', '2026-12-31', ${sql.json(Array.from({ length: 12 }, () => 1))}, ${beleg!.id}, 'entwurf')`;
      await tx`insert into import_zeile (lauf_id, zeilennummer, felder) values (${lauf!.id}, 2, ${sql.json({ akteur_name: "Probelauf-Check Hof" })})`;
      // 2. Savepoint: eine Zeile scheitert (CHECK Personen-Schluessel), die naechste geht durch.
      try {
        await tx.savepoint(async (sp) => {
          await sp`insert into import_zeile (lauf_id, zeilennummer, felder) values (${lauf!.id}, 3, ${sql.json({ email: "x" })})`;
        });
        savepoint = "fehler_nicht_ausgeloest";
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        if (!text.includes("import_zeile_felder_check")) throw new Error(`probe_fehler savepoint: ${text}`);
        await tx.savepoint(async (sp) => {
          await sp`insert into import_zeile (lauf_id, zeilennummer, felder) values (${lauf!.id}, 4, ${sql.json({ akteur_name: "Zeile danach" })})`;
        });
        const [n] = await tx`select count(*)::int as n from import_zeile where lauf_id = ${lauf!.id}`;
        savepoint = (n as { n: number }).n === 2 ? "ok" : `zeilen=${(n as { n: number }).n}`;
      }
      innen = await zaehlen(tx);
      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) {
      console.error(`::error::PROBELAUFCHECK: Probe selbst fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
      await sql.end();
      process.exit(1);
    }
  }
  const nachher = await zaehlen(sql);
  console.log("INNEN  " + JSON.stringify(innen));
  console.log("NACHHER " + JSON.stringify(nachher));
  console.log(`SAVEPOINT ${savepoint}`);
  const fehler: string[] = [];
  for (const t of TABELLEN) {
    if (vorher[t] !== nachher[t]) fehler.push(`${t}: vorher ${vorher[t]}, nachher ${nachher[t]}`);
    if (innen && t !== "aenderung" && (innen[t] ?? 0) <= (vorher[t] ?? 0)) fehler.push(`${t}: innerhalb der Transaktion nicht angelegt (${innen[t]} <= ${vorher[t]})`);
  }
  if (savepoint !== "ok") fehler.push(`Savepoint: ${savepoint}`);
  await sql.end();
  if (fehler.length > 0) {
    for (const f of fehler) console.error(`::error::PROBELAUFCHECK: ${f}`);
    process.exit(1);
  }
  console.log("PROBELAUFCHECK OK — Zaehler vorher = nachher, innerhalb der Transaktion angelegt, Savepoint nach Fehler benutzbar.");
}

main().catch(async (e) => {
  console.error(`::error::PROBELAUFCHECK: ${e instanceof Error ? e.message : String(e)}`);
  await sql.end().catch(() => {});
  process.exit(1);
});
