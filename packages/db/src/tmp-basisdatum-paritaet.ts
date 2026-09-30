/**
 * TEMPORAER (AP2.3 PR b, Beweis): Faelligkeit VOR (Basisdatum = erstellt_am
 * ::date in Sitzungszeit UTC) und NACH (Kalendertag Europe/Berlin) der
 * Umstellung — alle Preview-Eintraege, dieselbe Datumsarithmetik (plusMonate
 * wie apps/web/lib/verifizierung.ts), Frist je Basisdatum aus parameter_wert.
 * Nur SELECT.
 */
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { max: 1, fetch_types: false });
function plusMonate(iso: string, monate: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + monate);
  return d.toISOString().slice(0, 10);
}
let gesamt = 0, typfrist = 0, tagVerschoben = 0, abweichungen = 0;
for (const tabelle of ["biomassestrom", "output_bedarf"] as const) {
  const zeilen = await sql.unsafe(`
    select s.id, b.typ::text as beleg_typ,
           (b.erstellt_am at time zone 'UTC')::date::text as tag_utc,
           (b.erstellt_am at time zone 'Europe/Berlin')::date::text as tag_berlin,
           case when b.typ in ('gespraech','dokument','webrecherche') then parameter_wert('verifikationsfrist.' || b.typ::text, (b.erstellt_am at time zone 'UTC')::date) end as frist_utc,
           case when b.typ in ('gespraech','dokument','webrecherche') then parameter_wert('verifikationsfrist.' || b.typ::text, (b.erstellt_am at time zone 'Europe/Berlin')::date) end as frist_berlin
      from ${tabelle} s left join beleg b on b.id = s.beleg_id`);
  for (const z of zeilen) {
    gesamt += 1;
    if (!z.beleg_typ || z.frist_utc == null) continue;
    typfrist += 1;
    if (z.tag_utc !== z.tag_berlin) tagVerschoben += 1;
    const alt = plusMonate(z.tag_utc, Number(z.frist_utc));
    const neu = plusMonate(z.tag_berlin, Number(z.frist_berlin));
    if (alt !== neu) { abweichungen += 1; console.log(`ABWEICHUNG ${tabelle} ${z.id} ${alt} -> ${neu}`); }
  }
}
console.log(`PARITAET stroeme=${gesamt} mit_typfrist=${typfrist} tag_utc_ungleich_berlin=${tagVerschoben} abweichungen=${abweichungen}`);
await sql.end();
if (abweichungen > 0) process.exit(1);
