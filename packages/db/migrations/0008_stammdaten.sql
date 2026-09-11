-- 0008_stammdaten: Materialarten- und Output-Produkt-Referenzdaten als Migration.
--
-- Diese Listen (AP1f-a: 42 Materialarten, 15 Output-Produkte) lagen bisher nur
-- im Seed-Skript. Das Seed-Skript laeuft aber bewusst nie gegen Production
-- (ALLOW_PREVIEW_SEED-Guard + /prod/i-Check in der DATABASE_URL) — die
-- Referenzdaten haben Production deshalb nie erreicht (Befund 11.09.2026:
-- materialart und output_produkt dort leer). Es sind Referenz-, keine
-- Testdaten, also gehoeren sie in eine Migration. Idempotent per Upsert;
-- das Seed-Skript legt nur noch "Test:"-Daten an.

INSERT INTO "materialart" (code, label, cluster) VALUES
  -- Organische Rest- und Abfallstoffe
  ('guelle', 'Gülle', 'organische_rest_abfallstoffe'),
  ('mist', 'Mist', 'organische_rest_abfallstoffe'),
  ('gruenschnitt', 'Grünschnitt', 'organische_rest_abfallstoffe'),
  ('landschaftspflegeschnitt', 'Landschaftspflegeschnitt', 'organische_rest_abfallstoffe'),
  ('biertreber', 'Biertreber', 'organische_rest_abfallstoffe'),
  ('molkereireste', 'Molkereireste', 'organische_rest_abfallstoffe'),
  ('fruchttrester', 'Fruchttrester', 'organische_rest_abfallstoffe'),
  ('erntereste', 'Erntereste', 'organische_rest_abfallstoffe'),
  ('organischer_hausmuell', 'Organischer Hausmüll', 'organische_rest_abfallstoffe'),
  ('bioabfall', 'Bioabfall', 'organische_rest_abfallstoffe'),
  ('klaerschlamm', 'Klärschlamm', 'organische_rest_abfallstoffe'),
  -- Lignozellulosische Reststoffe
  ('stroh', 'Stroh', 'lignozellulosische_reststoffe'),
  ('maisstroh', 'Maisstroh', 'lignozellulosische_reststoffe'),
  ('getreidespelzen', 'Getreidespelzen', 'lignozellulosische_reststoffe'),
  ('reishuelsen', 'Reishülsen', 'lignozellulosische_reststoffe'),
  ('waldrestholz', 'Waldrestholz', 'lignozellulosische_reststoffe'),
  ('saegemehl', 'Sägemehl', 'lignozellulosische_reststoffe'),
  ('rinde', 'Rinde', 'lignozellulosische_reststoffe'),
  ('landschaftspflegeholz', 'Landschaftspflegeholz', 'lignozellulosische_reststoffe'),
  ('bagasse', 'Bagasse', 'lignozellulosische_reststoffe'),
  ('nussschalen', 'Nussschalen', 'lignozellulosische_reststoffe'),
  -- Nachwachsende Rohstoffe
  ('zwischenfruechte_catch_crops', 'Zwischenfrüchte (Catch Crops)', 'nachwachsende_rohstoffe'),
  ('cover_crops', 'Cover Crops', 'nachwachsende_rohstoffe'),
  ('biomasse_degradierte_flaechen', 'Biomasse von degradierten Flächen', 'nachwachsende_rohstoffe'),
  ('miscanthus', 'Miscanthus', 'nachwachsende_rohstoffe'),
  ('algen', 'Algen', 'nachwachsende_rohstoffe'),
  ('mais', 'Mais', 'nachwachsende_rohstoffe'),
  ('weizen', 'Weizen', 'nachwachsende_rohstoffe'),
  ('zuckerrohr', 'Zuckerrohr', 'nachwachsende_rohstoffe'),
  ('zuckerruebe', 'Zuckerrübe', 'nachwachsende_rohstoffe'),
  ('raps', 'Raps', 'nachwachsende_rohstoffe'),
  ('soja', 'Soja', 'nachwachsende_rohstoffe'),
  ('palmoel', 'Palmöl', 'nachwachsende_rohstoffe'),
  -- Lipide und Spezialfeedstocks
  ('altspeiseoel_uco', 'Altspeiseöl (UCO)', 'lipide_spezialfeedstocks'),
  ('tierfette_kat_1', 'Tierfette Kat. 1', 'lipide_spezialfeedstocks'),
  ('tierfette_kat_2', 'Tierfette Kat. 2', 'lipide_spezialfeedstocks'),
  -- Polymere und synthetische Kohlenstoffquellen
  ('kunststoff_sortierreste', 'Kunststoff-Sortierreste', 'polymere_synthetische_c_quellen'),
  ('ersatzbrennstoff_ebs', 'Ersatzbrennstoff (EBS, inkl. Altholz A IV)', 'polymere_synthetische_c_quellen'),
  ('shredderleichtfraktion', 'Shredderleichtfraktion', 'polymere_synthetische_c_quellen'),
  ('altreifen', 'Altreifen', 'polymere_synthetische_c_quellen'),
  ('textilreste_mischfasern', 'Textilreste (Mischfasern)', 'polymere_synthetische_c_quellen'),
  ('polymere_unsortiert', 'Polymere (unsortiert)', 'polymere_synthetische_c_quellen')
ON CONFLICT (code) DO UPDATE SET label = excluded.label, cluster = excluded.cluster;--> statement-breakpoint

-- AP1i (8): "speisereste" war ein Fehler gegen die AP1f-Taxonomie (richtig:
-- "erntereste", oben im Upsert enthalten). Der Guard ist Absicht: haengt
-- bereits ein Biomassestrom an "speisereste", wird nichts geloescht — der Fall
-- ist zu melden statt zu loeschen. Auf Production greift der Delete ins Leere
-- (der Code war dort nie vorhanden), auf Preview raeumt er die Karteileiche
-- auf. Beides ist gewollt.
DELETE FROM "materialart"
  WHERE code = 'speisereste'
    AND NOT EXISTS (
      SELECT 1 FROM "biomassestrom" WHERE materialart_code = 'speisereste'
    );--> statement-breakpoint

INSERT INTO "output_produkt" (code, label, gruppe, art) VALUES
  ('strom', 'Strom', 'primaerprodukte', 'target'),
  ('methan', 'Methan', 'primaerprodukte', 'target'),
  ('ethanol', 'Ethanol', 'primaerprodukte', 'target'),
  ('synthesegas', 'Synthesegas', 'primaerprodukte', 'target'),
  ('h2_niederdruck', 'H2 (Niederdruck)', 'wasserstoff', 'target'),
  ('h2_hochdruck', 'H2 (Hochdruck)', 'wasserstoff', 'target'),
  ('h2_einspeisung_kernnetz', 'H2-Einspeisung (Kernnetz)', 'wasserstoff', 'target'),
  ('liquid_hydrogen', 'Liquid Hydrogen', 'wasserstoff', 'target'),
  ('methanol', 'Methanol', 'derivate', 'target'),
  ('saf', 'SAF', 'derivate', 'target'),
  ('ammoniak', 'Ammoniak', 'derivate', 'target'),
  ('biofuels', 'BioFuels', 'derivate', 'target'),
  ('waerme', 'Wärme', 'add_ons', 'add_on'),
  ('co2', 'CO2', 'add_ons', 'add_on'),
  ('asche', 'Asche', 'add_ons', 'add_on')
ON CONFLICT (code) DO UPDATE SET label = excluded.label, gruppe = excluded.gruppe, art = excluded.art;
