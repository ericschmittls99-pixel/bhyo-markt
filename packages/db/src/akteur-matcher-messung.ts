/**
 * AP2.7 PR b (Eric 06.10.2026): Messung des mengenbasierten Matchers gegen
 * die Preview-DB (Seed) — nur lesend. 200 Eingaben aus den Seed-Akteuren
 * (Originalname, Tippfehler-Variante, Zusatzwort, fremder Name), einmal als
 * EINE Abfrage (Kopie der Abfrage aus apps/web/lib/dubletten.ts
 * sucheAehnlicheMenge) und zum Vergleich als Schleife mit einer Abfrage je
 * Eingabe (sucheAehnliche). Ausgabe: Dauer in ms, Treffer je Grad.
 * Temporaerer Workflow, wird vor dem Merge entfernt (siehe PR).
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });
const STARK = 0.6;
const N = Number(process.env.STAPEL ?? 200);

async function main() {
  const ziel = new URL(url!);
  console.log(`MATCHER_MESSUNG host=${ziel.hostname} db=${ziel.pathname.slice(1)} stapel=${N}`);
  const [{ n: akteure }] = (await sql`select count(*)::int as n from akteur`) as unknown as { n: number }[];
  const seed = (await sql`select name, sitz_plz from akteur order by name limit ${Math.ceil(N / 4)}`) as unknown as { name: string; sitz_plz: string | null }[];
  const eingaben: { schluessel: string; name: string; plz: string | null }[] = [];
  let i = 0;
  for (const a of seed) {
    const varianten = [a.name, a.name.replace(/e/, "ee"), `${a.name} Nord`, `Fremder Betrieb ${i}`];
    for (const v of varianten) {
      if (eingaben.length >= N) break;
      eingaben.push({ schluessel: `k${i++}`, name: v, plz: a.sitz_plz });
    }
  }
  console.log(`AKTEURE ${akteure}, EINGABEN ${eingaben.length}`);

  const t0 = performance.now();
  const werte = eingaben.map((e) => sql`(${e.schluessel}, ${e.name}, ${e.plz}::text)`);
  const rows = (await sql`
      with eingabe(schluessel, name, plz) as (values ${werte.reduce((acc, w, idx) => (idx === 0 ? w : sql`${acc}, ${w}`))}),
      e as (select schluessel, akteur_name_norm(name) as norm, plz from eingabe),
      k as (
        select e.schluessel, a.id, similarity(akteur_name_norm(a.name), e.norm)::float8 as sim,
               akteur_name_wortteilmenge(akteur_name_norm(a.name), e.norm) as teilmenge,
               (akteur_name_norm(a.name) = e.norm and e.plz is not null and a.sitz_plz = e.plz) as identisch,
               (e.plz is not null and a.sitz_plz = e.plz) as gleicher_ort,
               row_number() over (partition by e.schluessel order by (akteur_name_norm(a.name) = e.norm and e.plz is not null and a.sitz_plz = e.plz) desc, similarity(akteur_name_norm(a.name), e.norm) desc, a.name) as rang
          from e join akteur a on similarity(akteur_name_norm(a.name), e.norm) >= ${STARK}
                               or (e.plz is not null and a.sitz_plz = e.plz and (akteur_name_wortteilmenge(akteur_name_norm(a.name), e.norm) or akteur_name_norm(a.name) = e.norm))
      )
      select * from k where rang <= 8`) as unknown as { schluessel: string; sim: number; teilmenge: boolean; identisch: boolean; gleicher_ort: boolean }[];
  const menge = performance.now() - t0;
  const grade = { identisch: 0, stark: 0, schwach: 0 };
  const top = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!top.has(r.schluessel)) top.set(r.schluessel, r);
  for (const r of top.values()) {
    if (r.identisch) grade.identisch += 1;
    else if (r.gleicher_ort && (Number(r.sim) >= STARK || r.teilmenge)) grade.stark += 1;
    else if (Number(r.sim) >= 0.75) grade.schwach += 1;
  }
  console.log(`MENGE eine Abfrage: ${menge.toFixed(0)} ms, ${rows.length} Trefferzeilen, oberste je Eingabe: ${JSON.stringify(grade)}, ohne Treffer ${eingaben.length - top.size}`);

  const t1 = performance.now();
  for (const e of eingaben) {
    await sql`select a.id from akteur a, (select akteur_name_norm(${e.name}) as norm, ${e.plz}::text as plz) e
      where similarity(akteur_name_norm(a.name), e.norm) >= ${STARK} or (e.plz is not null and a.sitz_plz = e.plz and akteur_name_wortteilmenge(akteur_name_norm(a.name), e.norm)) limit 8`;
  }
  const schleife = performance.now() - t1;
  console.log(`SCHLEIFE ${eingaben.length} Abfragen: ${schleife.toFixed(0)} ms (${(schleife / eingaben.length).toFixed(1)} ms je Eingabe)`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(`::error::MATCHER_MESSUNG: ${e instanceof Error ? e.message : String(e)}`);
  await sql.end().catch(() => {});
  process.exit(1);
});
