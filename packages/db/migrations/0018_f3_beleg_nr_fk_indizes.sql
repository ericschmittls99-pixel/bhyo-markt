-- E28/E29 (Eric, 23.09.2026): interne Belegnummer B-000123 aus EINER
-- Sequenz — vergeben, nicht abgeleitet, aber mit genau einem Ursprung.
-- Expand nach E21: Spalte zuerst OHNE Default und nullable, damit der
-- Nachtrag DETERMINISTISCH nach erstellt_am (bei Gleichstand id) laufen
-- kann. Ein volatiler Default bei ADD COLUMN wuerde die Nummern in
-- physischer Zeilenreihenfolge vergeben — ein zweiter Lauf ergaebe andere
-- Nummern. NOT NULL und UNIQUE folgen erst NACH dem Zaehlungsnachweis im
-- DO-Block; schlaegt er fehl, rollt die ganze Migration zurueck.
-- Handgeschrieben (drizzle-kit kennt weder Sequenzen noch Trigger);
-- Snapshot unangetastet, die 12 FK-Indizes unten sind generiert.
CREATE SEQUENCE IF NOT EXISTS beleg_nr_seq;--> statement-breakpoint
ALTER TABLE "beleg" ADD COLUMN "beleg_nr" text;--> statement-breakpoint

-- Nachtrag Bestand: deterministisch, damit ein erneuter Lauf auf einer
-- gleichen Datenbasis dieselben Nummern ergibt.
UPDATE "beleg" b
   SET beleg_nr = 'B-' || lpad(s.nr::text, 6, '0')
  FROM (
    SELECT id, row_number() OVER (ORDER BY erstellt_am, id) AS nr FROM "beleg"
  ) s
 WHERE b.id = s.id;--> statement-breakpoint

-- Sequenz hinter den Bestand setzen; danach vergibt sie fuer neue Zeilen.
SELECT setval('beleg_nr_seq', GREATEST((SELECT count(*) FROM "beleg"), 1), (SELECT count(*) FROM "beleg") > 0);--> statement-breakpoint
ALTER SEQUENCE beleg_nr_seq OWNED BY "beleg".beleg_nr;--> statement-breakpoint
ALTER TABLE "beleg" ALTER COLUMN "beleg_nr" SET DEFAULT 'B-' || lpad(nextval('beleg_nr_seq')::text, 6, '0');--> statement-breakpoint

-- Zaehlungsnachweis IM SELBEN JOB (Eric): Belege = befuellte Nummern =
-- verschiedene Nummern. Weicht etwas ab, bricht die Migration ab.
DO $$
DECLARE n_belege int; n_gefuellt int; n_verschieden int;
BEGIN
  SELECT count(*), count(beleg_nr), count(DISTINCT beleg_nr)
    INTO n_belege, n_gefuellt, n_verschieden FROM "beleg";
  RAISE NOTICE 'BELEG_NR_ZAEHLUNG belege=% gefuellt=% verschieden=%',
    n_belege, n_gefuellt, n_verschieden;
  IF n_belege <> n_gefuellt OR n_belege <> n_verschieden THEN
    RAISE EXCEPTION 'Nachtrag unvollstaendig: % Belege, % befuellt, % verschieden — kein NOT NULL',
      n_belege, n_gefuellt, n_verschieden;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "beleg" ALTER COLUMN "beleg_nr" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "beleg" ADD CONSTRAINT "beleg_beleg_nr_unique" UNIQUE("beleg_nr");--> statement-breakpoint

-- Unveraenderlich in der DATENBANK, nicht nur per Test: ein Aenderungs-
-- versuch scheitert. Das ist ein Schutz, keine Ableitung — die E23-Absage
-- an Trigger betraf abgeleitete Werte.
CREATE FUNCTION beleg_nr_unveraenderlich() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.beleg_nr IS DISTINCT FROM OLD.beleg_nr THEN
    RAISE EXCEPTION 'beleg_nr ist unveraenderlich (% -> %)', OLD.beleg_nr, NEW.beleg_nr;
  END IF;
  RETURN NEW;
END $fn$;--> statement-breakpoint
CREATE TRIGGER beleg_nr_unveraenderlich_trg
  BEFORE UPDATE ON "beleg"
  FOR EACH ROW EXECUTE FUNCTION beleg_nr_unveraenderlich();--> statement-breakpoint

CREATE INDEX "akteur_interesse_region_id_idx" ON "akteur_interesse" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "analyse_lauf_region_id_idx" ON "analyse_lauf" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "biomassestrom_akteur_id_idx" ON "biomassestrom" USING btree ("akteur_id");--> statement-breakpoint
CREATE INDEX "biomassestrom_beleg_id_idx" ON "biomassestrom" USING btree ("beleg_id");--> statement-breakpoint
CREATE INDEX "biomassestrom_materialart_code_idx" ON "biomassestrom" USING btree ("materialart_code");--> statement-breakpoint
CREATE INDEX "entfernung_lauf_id_idx" ON "entfernung" USING btree ("lauf_id");--> statement-breakpoint
CREATE INDEX "output_bedarf_akteur_id_idx" ON "output_bedarf" USING btree ("akteur_id");--> statement-breakpoint
CREATE INDEX "output_bedarf_beleg_id_idx" ON "output_bedarf" USING btree ("beleg_id");--> statement-breakpoint
CREATE INDEX "output_bedarf_produkt_code_idx" ON "output_bedarf" USING btree ("produkt_code");--> statement-breakpoint
CREATE INDEX "region_bereitschaft_beleg_id_idx" ON "region" USING btree ("bereitschaft_beleg_id");--> statement-breakpoint
CREATE INDEX "vergabe_zeitraum_biomassestrom_id_idx" ON "vergabe_zeitraum" USING btree ("biomassestrom_id");--> statement-breakpoint
CREATE INDEX "vergabe_zeitraum_output_bedarf_id_idx" ON "vergabe_zeitraum" USING btree ("output_bedarf_id");