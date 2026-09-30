/**
 * TEMPORAER (AP2.4 PR a, E62): Vorher/Nachher der Preview-Eintraege — alte
 * E33-Gesamtfaelligkeit (min aus Belegfrist ab Erhebung, Verfuegbarkeits-
 * ende, befristeten Vergabe-Enden, Reservierungsende) und alter Status
 * (aktiv/ausgelaufen/keine_frist) gegen den neuen Zustand aus
 * strom_verifikation(heute) mit verifiziert_bis. Nur SELECT. Vor dem Merge
 * entfernen.
 */
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { max: 1, fetch_types: false });
const zeilen = await sql.unsafe(`
  with heute as (select (now() at time zone 'Europe/Berlin')::date as t),
  s as (
    select 'biomasse' as art, b.id, b.status::text as status, b.beleg_id, b.zeitraum_bis, b.reserviert_seit,
           (select min(v.vergeben_bis) from vergabe_zeitraum v where v.biomassestrom_id = b.id and v.vergeben_bis is not null) as vergabe_bis
      from biomassestrom b
    union all
    select 'output', o.id, o.status::text, o.beleg_id, o.zeitraum_bis, o.reserviert_seit,
           (select min(v.vergeben_bis) from vergabe_zeitraum v where v.output_bedarf_id = o.id and v.vergeben_bis is not null)
      from output_bedarf o
  ),
  alt as (
    select s.*, bl.beleg_nr, bl.typ::text as typ,
      case when bl.typ::text in ('betriebsdaten','vertrag','absichtserklaerung','angebot') then bl.gueltig_bis
           when bl.typ is not null then ((bl.erstellt_am at time zone 'Europe/Berlin')::date
                + make_interval(months => parameter_wert('verifikationsfrist.' || bl.typ::text, (bl.erstellt_am at time zone 'Europe/Berlin')::date)))::date
      end as beleg_frist,
      case when s.reserviert_seit is not null then (s.reserviert_seit + make_interval(months => parameter_wert('verifikationsfrist.reservierung', s.reserviert_seit)))::date end as res_ende
      from s left join beleg bl on bl.id = s.beleg_id
  )
  select a.art, a.beleg_nr, a.typ, a.status,
         least(a.beleg_frist, a.zeitraum_bis, a.vergabe_bis, a.res_ende)::text as alt_faelligkeit,
         case when least(a.beleg_frist, a.zeitraum_bis, a.vergabe_bis, a.res_ende) is null then 'keine_frist'
              when least(a.beleg_frist, a.zeitraum_bis, a.vergabe_bis, a.res_ende) >= (select t from heute) then 'aktiv' else 'ausgelaufen' end as alt_status,
         v.zustand as neu_zustand, v.verifiziert_bis::text as neu_bis
    from alt a
    join strom_verifikation((select t from heute)) v on v.art = a.art and v.strom_id = a.id
   order by a.art, a.beleg_nr nulls last, a.id`);
const zaehler: Record<string, number> = {};
console.log("| Art | Beleg | Typ | Status | alt Fälligkeit | alt Status | neu Zustand | neu verifiziert bis |");
console.log("|---|---|---|---|---|---|---|---|");
for (const z of zeilen) {
  const k = `${z.alt_status} → ${z.neu_zustand}`;
  zaehler[k] = (zaehler[k] ?? 0) + 1;
  console.log(`| ${z.art} | ${z.beleg_nr ?? "—"} | ${z.typ ?? "—"} | ${z.status} | ${z.alt_faelligkeit ?? "—"} | ${z.alt_status} | ${z.neu_zustand} | ${z.neu_bis ?? "—"} |`);
}
console.log("");
console.log("SUMME " + JSON.stringify({ stroeme: zeilen.length, uebergaenge: zaehler }));
await sql.end();
