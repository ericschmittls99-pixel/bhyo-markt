/**
 * TEMPORAER (AP2.3 PR a, Beweis): Faelligkeit VOR (Konstanten BELEG_MONATE)
 * und NACH (parameter_wert am Basisdatum) der Umstellung — alle Preview-
 * Eintraege, zum selben Zeitpunkt, mit derselben Datumsarithmetik
 * (plusMonate wie apps/web/lib/verifizierung.ts). Nur SELECT.
 */
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { max: 1, fetch_types: false });
const ALT: Record<string, number> = { gespraech: 3, dokument: 6, webrecherche: 3, reservierung: 12 };
function plusMonate(iso: string, monate: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + monate);
  return d.toISOString().slice(0, 10);
}
let gesamt = 0, typfrist = 0, reservierungen = 0, abweichungen = 0;
for (const [tabelle, typ] of [["biomassestrom", "biomassestrom"], ["output_bedarf", "output_bedarf"]] as const) {
  const zeilen = await sql.unsafe(`
    select s.id, s.reserviert_seit::text as reserviert_seit, b.typ::text as beleg_typ, (b.erstellt_am)::date::text as erhebungsdatum,
           case when b.typ in ('gespraech','dokument','webrecherche') then parameter_wert('verifikationsfrist.' || b.typ::text, (b.erstellt_am)::date) end as neu_beleg,
           case when s.reserviert_seit is not null then parameter_wert('verifikationsfrist.reservierung', s.reserviert_seit) end as neu_res
      from ${tabelle} s left join beleg b on b.id = s.beleg_id`);
  for (const z of zeilen) {
    gesamt += 1;
    if (z.beleg_typ && ALT[z.beleg_typ] != null && z.erhebungsdatum) {
      typfrist += 1;
      const alt = plusMonate(z.erhebungsdatum, ALT[z.beleg_typ]!);
      const neu = plusMonate(z.erhebungsdatum, Number(z.neu_beleg));
      if (alt !== neu) { abweichungen += 1; console.log(`ABWEICHUNG ${typ} ${z.id} beleg ${alt} -> ${neu}`); }
    }
    if (z.reserviert_seit) {
      reservierungen += 1;
      const alt = plusMonate(z.reserviert_seit, ALT.reservierung!);
      const neu = plusMonate(z.reserviert_seit, Number(z.neu_res));
      if (alt !== neu) { abweichungen += 1; console.log(`ABWEICHUNG ${typ} ${z.id} reservierung ${alt} -> ${neu}`); }
    }
  }
}
console.log(`PARITAET stroeme=${gesamt} mit_typfrist=${typfrist} mit_reservierung=${reservierungen} abweichungen=${abweichungen}`);
await sql.end();
if (abweichungen > 0) process.exit(1);
