/**
 * E75 (09.10.2026): `zeitraum_bis NULL` = unbefristet — Probe gegen die
 * Wegwerf-DB (Migration 0056), alles in einer zurueckgerollten
 * Transaktion. Faelle: NULL wird angenommen (Biomasse und Output), Ende vor
 * Beginn wird vom CHECK abgewiesen (Rot-Fall), der Jahresfilter des
 * Registers findet den unbefristeten Strom in jedem Jahr ab Beginn und nicht
 * davor — dieselbe SQL wie lib/register.ts (jahrFilter), hier gegen echte
 * Zeilen.
 */
import { createSql } from "@bhyo/db";
import * as schema from "@bhyo/db/schema";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const verbindung = createSql(url, { max: 1 });
const db = drizzle(verbindung, { schema });
const ROLLBACK = "__rollback__";

async function main() {
  const ziel = new URL(url!);
  console.log(`ZEITRAUMPROBE host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];
  const pruefe = (name: string, ok: boolean, ist: unknown) => {
    console.log(`${ok ? "OK " : "ROT"} ${name}: ${JSON.stringify(ist)}`);
    if (!ok) fehler.push(name);
  };
  try {
    await db.transaction(async (tx) => {
      const x = async <T,>(q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
      const A = "00000000-0000-4000-8000-00000000e750";
      await x(sql`insert into akteur (id, name, sektor, status, sitz_plz, sitz_ort) values (${A}, 'Probe Akteur E75', 'ohne_sektor', 'entwurf', '00000', 'Probe')`);
      const [mat] = await x<{ code: string }>(sql`select code from materialart order by code limit 1`);
      const [prod] = await x<{ code: string }>(sql`select code from output_produkt order by code limit 1`);
      const SAISON = "[100,100,100,100,100,100,100,100,100,100,100,100]";
      const B1 = "00000000-0000-4000-8000-00000000e751";
      const O1 = "00000000-0000-4000-8000-00000000e752";

      // 1a/1b: unbefristet wird angenommen.
      await x(sql`insert into biomassestrom (id, akteur_id, materialart_code, menge_roh_fm, zeitraum_von, zeitraum_bis, saisonalitaet, status)
        values (${B1}, ${A}, ${mat!.code}, 100, '2027-01-01', null, ${SAISON}::jsonb, 'entwurf')`);
      const [b1] = await x<{ bis: string | null }>(sql`select zeitraum_bis as bis from biomassestrom where id = ${B1}`);
      pruefe("1a Biomasse mit zeitraum_bis NULL angenommen", b1?.bis === null, b1);
      await x(sql`insert into output_bedarf (id, akteur_id, produkt_code, menge_wert, menge_einheit, zeitraum_von, zeitraum_bis, saisonalitaet, status)
        values (${O1}, ${A}, ${prod!.code}, 100, 't/a', '2027-01-01', null, ${SAISON}::jsonb, 'entwurf')`);
      const [o1] = await x<{ bis: string | null }>(sql`select zeitraum_bis as bis from output_bedarf where id = ${O1}`);
      pruefe("1b Output-Bedarf mit zeitraum_bis NULL angenommen", o1?.bis === null, o1);

      // 2: Ende vor Beginn weist der CHECK ab (Rot-Fall, Savepoint).
      let meldung = "";
      try {
        await x(sql`savepoint s2`);
        await x(sql`update biomassestrom set zeitraum_bis = '2026-12-31' where id = ${B1}`);
        await x(sql`release savepoint s2`);
      } catch (e) {
        meldung = String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message);
        await x(sql`rollback to savepoint s2`);
      }
      pruefe("2 Ende vor Beginn abgewiesen (biomassestrom_zeitraum_check)", /biomassestrom_zeitraum_check/.test(meldung), meldung.slice(0, 120));

      // 3: Jahresfilter wie lib/register.ts — unbefristet zaehlt ab Beginn in jedem Jahr, nicht davor.
      const jahr = async (j: string) =>
        (await x<{ n: number }>(sql`select count(*)::int as n from biomassestrom where id = ${B1}
          and zeitraum_von <= ${`${j}-12-31`} and (zeitraum_bis is null or zeitraum_bis >= ${`${j}-01-01`})`))[0]!.n;
      pruefe("3a Jahresfilter 2026 (vor Beginn): nicht gefunden", (await jahr("2026")) === 0, await jahr("2026"));
      pruefe("3b Jahresfilter 2027 (Beginn): gefunden", (await jahr("2027")) === 1, await jahr("2027"));
      pruefe("3c Jahresfilter 2090: gefunden (unbefristet)", (await jahr("2090")) === 1, await jahr("2090"));

      // 4: befristet wie bisher — Ende = Beginn erlaubt (CHECK >=).
      await x(sql`update biomassestrom set zeitraum_bis = '2027-01-01' where id = ${B1}`);
      pruefe("4 Ende = Beginn erlaubt", (await jahr("2028")) === 0, await jahr("2028"));

      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
  } finally {
    await verbindung.end();
  }
  if (fehler.length) {
    console.error(`ZEITRAUMPROBE ROT — ${fehler.length} Fall/Faelle: ${fehler.join("; ")}`);
    process.exit(1);
  }
  console.log("ZEITRAUMPROBE OK — alle Faelle zurueckgerollt.");
}

main().catch((e) => {
  console.error("ZEITRAUMPROBE FEHLER:", e instanceof Error ? e.message : e);
  process.exit(1);
});
