-- Ausgefuehrt am 28.09.2026 von Eric im Neon SQL Editor, Branch production, Datenbank neondb.
-- Ergebnis Kontrollabfrage: feedstock 0 | belege 0 | benutzer 1 | archiv: aenderung 2, akteur 1, beleg 1, biomassestrom 1, vergabe_zeitraum 1.
-- Vorheriger Versuch (Code-Fassung, per Chat kopiert) brach an Kopierfehlern ab; ROLLBACK, nichts geaendert.

-- Block B: Testdaten auf Production entfernen (28.09.2026)
-- Nur manuell im Neon SQL Editor, erst auf dem Probe-Branch, dann auf Production.
-- Stimmt eine Vor- oder Nachpruefung nicht, bricht der Block ab und nichts wird geloescht (ROLLBACK klicken).

begin;

create temp table _vorher on commit drop as
select (select count(*) from benutzer)::int as n_benutzer;

create table if not exists archiv_testdaten (
  archiviert_am timestamptz not null default now(),
  grund text not null,
  tabelle text not null,
  zeile jsonb not null
);

-- Vorpruefung
do $$
declare n_strom int; n_beleg int; n_out int; n_region int;
begin
  select count(*) into n_strom from biomassestrom;
  select count(*) into n_beleg from beleg;
  select count(*) into n_out from output_bedarf;
  select count(*) into n_region from region where bereitschaft_beleg_id is not null;
  if n_strom <> 1 or n_beleg <> 1 or n_out <> 0 or n_region <> 0 then
    raise exception 'Vorpruefung: feedstock=% belege=% outputs=% region_beleg=% - erwartet 1/1/0/0. Abbruch.',
      n_strom, n_beleg, n_out, n_region;
  end if;
  if not exists (select 1 from beleg where beleg_nr = 'B-000001') then
    raise exception 'B-000001 fehlt. Abbruch.';
  end if;
end $$;

-- Archivieren
insert into archiv_testdaten (grund, tabelle, zeile)
select 'go-live Testdaten 28.09.2026', 'vergabe_zeitraum', to_jsonb(v)
from vergabe_zeitraum v
where v.biomassestrom_id in (select id from biomassestrom);

insert into archiv_testdaten (grund, tabelle, zeile)
select 'go-live Testdaten 28.09.2026', 'biomassestrom', to_jsonb(s)
from biomassestrom s;

insert into archiv_testdaten (grund, tabelle, zeile)
select 'go-live Testdaten 28.09.2026', 'beleg', to_jsonb(b)
from beleg b;

insert into archiv_testdaten (grund, tabelle, zeile)
select 'go-live Testdaten 28.09.2026', 'akteur', to_jsonb(a)
from akteur a
where a.id in (select akteur_id from biomassestrom)
  and (select count(*) from biomassestrom x where x.akteur_id = a.id)
    + (select count(*) from output_bedarf o where o.akteur_id = a.id) = 1;

insert into archiv_testdaten (grund, tabelle, zeile)
select 'go-live Testdaten 28.09.2026', 'aenderung', to_jsonb(ae)
from aenderung ae
where ae.entitaet_id in (select id from biomassestrom)
   or ae.entitaet_id in (select id from beleg)
   or ae.entitaet_id in (select akteur_id from biomassestrom);

-- Loeschen
delete from vergabe_zeitraum
where biomassestrom_id in (select id from biomassestrom);

delete from biomassestrom;

delete from beleg where beleg_nr = 'B-000001';

delete from akteur a
where not exists (select 1 from biomassestrom s where s.akteur_id = a.id)
  and not exists (select 1 from output_bedarf o where o.akteur_id = a.id)
  and a.id in (select (zeile->>'id')::uuid from archiv_testdaten where tabelle = 'akteur');

-- Nachpruefung: bricht ab, wenn das Ergebnis nicht stimmt
do $$
declare f int; b int; ta int; a_strom int; a_beleg int; a_akteur int; nb int; nb_vorher int;
begin
  select count(*) into f from biomassestrom;
  select count(*) into b from beleg;
  select count(*) into ta from akteur
    where id in (select (zeile->>'id')::uuid from archiv_testdaten where tabelle = 'akteur');
  select count(*) into a_strom  from archiv_testdaten where tabelle = 'biomassestrom';
  select count(*) into a_beleg  from archiv_testdaten where tabelle = 'beleg';
  select count(*) into a_akteur from archiv_testdaten where tabelle = 'akteur';
  select count(*) into nb from benutzer;
  select n_benutzer into nb_vorher from _vorher;
  if f <> 0 or b <> 0 or ta <> 0 or a_strom <> 1 or a_beleg <> 1 or a_akteur <> 1 or nb <> nb_vorher then
    raise exception 'Nachpruefung: feedstock=% belege=% test_akteur=% archiv strom/beleg/akteur=%/%/% benutzer=% (vorher %) - erwartet 0/0/0, 1/1/1, gleich. Abbruch.',
      f, b, ta, a_strom, a_beleg, a_akteur, nb, nb_vorher;
  end if;
end $$;

-- Anzeige
select (select count(*) from biomassestrom) as feedstock,
       (select count(*) from beleg) as belege,
       (select count(*) from archiv_testdaten) as archiv,
       (select count(*) from benutzer) as benutzer;

commit;
