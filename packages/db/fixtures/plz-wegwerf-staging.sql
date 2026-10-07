-- E68 PR 1: Staging-Fixture fuer die Wegwerf-Postgres der CI — dieselben
-- Tabellen, die ogr2ogr im Workflow import-plz.yml anlegt (plz_import_gebiet,
-- plz_import_gem), mit synthetischen Rechtecken. Zwei PLZ, drei Gemeinden:
--   11111  Quadrat 8,00–8,10 / 49,00–49,10   -> Gemeinde „Altstadt“ (ganz drin) und
--                                              „Groß Köris“ (halb drin, 50 %)
--   22222  Quadrat 8,10–8,20 / 49,00–49,10   -> „Groß Köris“ (andere Haelfte) und
--                                              „Neudorf“ (ganz drin)
--   Gemeinde „Splitter“ ragt nur 1 % in 22222 -> faellt unter der 10-%-Schwelle heraus.
-- 75378 ist doppelt (wie in der Quelle) und muss zu EINER PLZ vereinigt werden.
DROP TABLE IF EXISTS plz_import_gebiet, plz_import_gem;
CREATE TABLE plz_import_gebiet (plz text, geom geometry(MultiPolygon, 4326));
CREATE TABLE plz_import_gem (ars text, gen text, geom geometry(MultiPolygon, 4326));
INSERT INTO plz_import_gebiet VALUES
  ('11111', ST_Multi(ST_MakeEnvelope(8.00, 49.00, 8.10, 49.10, 4326))),
  ('22222', ST_Multi(ST_MakeEnvelope(8.10, 49.00, 8.20, 49.10, 4326))),
  ('75378', ST_Multi(ST_MakeEnvelope(8.30, 49.00, 8.35, 49.05, 4326))),
  ('75378', ST_Multi(ST_MakeEnvelope(8.35, 49.00, 8.40, 49.05, 4326)));
INSERT INTO plz_import_gem VALUES
  ('070000000001', 'Altstadt',   ST_Multi(ST_MakeEnvelope(8.00, 49.00, 8.05, 49.10, 4326))),
  ('070000000002', 'Groß Köris', ST_Multi(ST_MakeEnvelope(8.05, 49.00, 8.15, 49.10, 4326))),
  ('070000000003', 'Neudorf',    ST_Multi(ST_MakeEnvelope(8.15, 49.00, 8.20, 49.10, 4326))),
  ('070000000004', 'Splitter',   ST_Multi(ST_MakeEnvelope(8.199, 49.00, 8.30, 49.10, 4326))),
  ('070000000005', 'Pforzheim',  ST_Multi(ST_MakeEnvelope(8.30, 49.00, 8.40, 49.05, 4326)));
