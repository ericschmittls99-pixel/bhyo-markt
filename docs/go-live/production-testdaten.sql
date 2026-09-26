-- Go-live: Testdaten auf Production entfernen (Eric fuehrt es im Neon
-- SQL-Editor aus — Loeschungen auf Production bleiben Menschenhand).
--
-- Gegenstand, gemessen am 26.09.2026 ueber den Leseweg: genau ein Feedstock
-- "Guelle" mit Beleg B-000001 (Absichtserklaerung, Quelle "Wege"), null
-- Outputs, ein Akteur dazu. Alles andere (Materialarten, Produkte, Sektoren,
-- Verwaltungsgebiete, Regionen, Benutzer) bleibt.
--
-- Ablauf in drei Bloecken, jeder einzeln ausfuehren und lesen:
--   A  Vorpruefung und Zielnachweis — nur SELECT. Stimmt eine Zahl nicht,
--      NICHT weitermachen.
--   B  Archiv + Entfernen in EINER Transaktion; die Transaktion bricht selbst
--      ab, wenn die Vorpruefung nicht exakt eintrifft.
--   C  Belegnummern-Sequenz zuruecksetzen — nur, wenn beleg nachweislich
--      leer ist, damit der erste echte Beleg B-000001 heisst.

-- =====================================================================
-- A. Vorpruefung und Zielnachweis (nur lesen)
-- =====================================================================

-- A1 Zielnachweis: Production hat 46 Materialarten, 15 Produkte, 8 Sektoren;
--    Migrationsstand 23 (letzte 0022). Andere Zahlen = falsches Ziel.
select (select count(*) from materialart)    as materialarten,
       (select count(*) from output_produkt) as produkte,
       (select count(*) from sektor)         as sektoren,
       (select count(*) from drizzle.__drizzle_migrations) as migrationen,
       (select count(*) from biomassestrom)  as feedstock,
       (select count(*) from output_bedarf)  as outputs,
       (select count(*) from beleg)          as belege,
       (select count(*) from akteur)         as akteure;
-- Erwartet: feedstock 1, outputs 0, belege 1.

-- A2 Die Testzeilen im Klartext: Strom, Beleg, Akteur, Vergaben, Protokoll.
select s.id as strom_id, s.bezeichnung, s.status, s.beleg_id,
       b.beleg_nr, b.typ, b.metadata->>'quellenangabe' as quelle,
       a.id as akteur_id, a.name as akteur, a.sektor,
       (select count(*) from vergabe_zeitraum v where v.biomassestrom_id = s.id) as vergaben,
       (select count(*) from biomassestrom x where x.akteur_id = a.id) +
       (select count(*) from output_bedarf o where o.akteur_id = a.id) as stroeme_des_akteurs,
       (select count(*) from aenderung ae where ae.entitaet_id in (s.id, b.id, a.id)) as protokoll
  from biomassestrom s
  join beleg b on b.id = s.beleg_id
  join akteur a on a.id = s.akteur_id
 where b.beleg_nr = 'B-000001';
-- Erwartet: genau EINE Zeile, bezeichnung "Guelle", stroeme_des_akteurs 1.
-- Ist stroeme_des_akteurs > 1, haengt der Akteur an weiteren Stroemen und
-- wird NICHT entfernt (Block B laesst ihn dann stehen).

-- A3 Referenzen, die einer Entfernung im Weg stuenden:
select (select count(*) from region r where r.bereitschaft_beleg_id in (select id from beleg)) as region_beleg,
       (select count(*) from akteur_interesse) as akteur_interesse,
       (select count(*) from analyse_lauf) as analyse_laeufe,
       (select count(*) from entfernung) as entfernungen;
-- Erwartet: alles 0.

-- =====================================================================
-- B. Archiv und Entfernen (eine Transaktion, bricht bei Abweichung ab)
-- =====================================================================
begin;

-- B1 Archivtabelle: die Zeilen als JSON, mit Zeitstempel und Grund. Bleibt
--    in der Datenbank; ein Dump der Nacht hat sie ausserdem gesichert.
create table if not exists archiv_testdaten (
  archiviert_am timestamptz not null default now(),
  grund text not null,
  tabelle text not null,
  zeile jsonb not null
);

-- B2 Vorpruefung IN der Transaktion: exakt ein Strom, ein Beleg, keine
--    Outputs; sonst Abbruch ohne Wirkung.
do $$
declare
  n_strom int; n_beleg int; n_out int; n_region int;
begin
  select count(*) into n_strom from biomassestrom;
  select count(*) into n_beleg from beleg;
  select count(*) into n_out from output_bedarf;
  select count(*) into n_region from region where bereitschaft_beleg_id is not null;
  if n_strom <> 1 or n_beleg <> 1 or n_out <> 0 or n_region <> 0 then
    raise exception 'Vorpruefung: feedstock=% belege=% outputs=% region_beleg=% — erwartet 1/1/0/0. Abbruch, nichts veraendert.', n_strom, n_beleg, n_out, n_region;
  end if;
  if not exists (select 1 from beleg where beleg_nr = 'B-000001') then
    raise exception 'B-000001 nicht gefunden. Abbruch.';
  end if;
end $$;

-- B3 Archivieren: Vergaben, Strom, Beleg, Akteur (falls er nur an diesem
--    Strom haengt) und die Protokollzeilen dazu.
insert into archiv_testdaten (grund, tabelle, zeile)
select 'go-live Testdaten 26.09.2026', 'vergabe_zeitraum', to_jsonb(v)
  from vergabe_zeitraum v where v.biomassestrom_id in (select id from biomassestrom);
insert into archiv_testdaten (grund, tabelle, zeile)
select 'go-live Testdaten 26.09.2026', 'biomassestrom', to_jsonb(s) from biomassestrom s;
insert into archiv_testdaten (grund, tabelle, zeile)
select 'go-live Testdaten 26.09.2026', 'beleg', to_jsonb(b) from beleg b;
insert into archiv_testdaten (grund, tabelle, zeile)
select 'go-live Testdaten 26.09.2026', 'akteur', to_jsonb(a)
  from akteur a
 where a.id in (select akteur_id from biomassestrom)
   and (select count(*) from biomassestrom x where x.akteur_id = a.id)
     + (select count(*) from output_bedarf o where o.akteur_id = a.id) = 1;
insert into archiv_testdaten (grund, tabelle, zeile)
select 'go-live Testdaten 26.09.2026', 'aenderung', to_jsonb(ae)
  from aenderung ae
 where ae.entitaet_id in (select id from biomassestrom)
    or ae.entitaet_id in (select id from beleg)
    or ae.entitaet_id in (select id from akteur a where a.id in (select akteur_id from biomassestrom));

-- B4 Entfernen, in Fremdschluessel-Reihenfolge. Der Akteur nur, wenn er
--    nach dem Strom an nichts mehr haengt. Protokollzeilen bleiben — sie
--    dokumentieren, dass es die Zeilen gab (das Archiv haelt sie zusaetzlich).
delete from vergabe_zeitraum where biomassestrom_id in (select id from biomassestrom);
delete from biomassestrom;
delete from beleg where beleg_nr = 'B-000001';
delete from akteur a
 where not exists (select 1 from biomassestrom s where s.akteur_id = a.id)
   and not exists (select 1 from output_bedarf o where o.akteur_id = a.id)
   and a.id in (select (zeile->>'id')::uuid from archiv_testdaten where tabelle = 'akteur');

-- B5 Kontrolle vor dem Commit — muss 0/0/0 und Archiv >= 3 zeigen.
select (select count(*) from biomassestrom) as feedstock,
       (select count(*) from beleg) as belege,
       (select count(*) from akteur a where a.id in (select (zeile->>'id')::uuid from archiv_testdaten where tabelle = 'akteur')) as test_akteur_noch_da,
       (select count(*) from archiv_testdaten) as archiv;

commit;   -- bei falschen Zahlen stattdessen: rollback;

-- =====================================================================
-- C. Belegnummern-Sequenz zuruecksetzen — nur bei leerer Tabelle
-- =====================================================================
do $$
declare n int;
begin
  select count(*) into n from beleg;
  if n <> 0 then
    raise exception 'beleg ist nicht leer (% Zeilen) — Sequenz bleibt.', n;
  end if;
  perform setval('beleg_nr_seq', 1, false);   -- naechster Wert: 1 -> B-000001
  raise notice 'beleg_nr_seq zurueckgesetzt: naechster Beleg heisst B-000001';
end $$;

-- Nachweis: liefert 1, ohne die Sequenz zu verbrauchen.
select last_value, is_called from beleg_nr_seq;
