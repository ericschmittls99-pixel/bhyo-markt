ALTER TABLE "biomassestrom" ALTER COLUMN "zeitraum_bis" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "output_bedarf" ALTER COLUMN "zeitraum_bis" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD CONSTRAINT "biomassestrom_zeitraum_check" CHECK ("biomassestrom"."zeitraum_bis" is null or "biomassestrom"."zeitraum_bis" >= "biomassestrom"."zeitraum_von");--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD CONSTRAINT "output_bedarf_zeitraum_check" CHECK ("output_bedarf"."zeitraum_bis" is null or "output_bedarf"."zeitraum_bis" >= "output_bedarf"."zeitraum_von");--> statement-breakpoint
-- E75 (handgeschrieben ab hier, Snapshot unangetastet): Zaehlbeweis im
-- Migrationslauf — beide Spalten nullable, beide CHECKs stehen, Bestand:
-- Zeilen ohne Ende (vor E75 unmoeglich, muss 0 sein) und Zeilen mit Ende vor
-- Beginn (haette der ADD CONSTRAINT oben abgebrochen, steht hier als 0).
DO $$
DECLARE n_null integer; n_chk integer; n_offen_b integer; n_offen_o integer; n_verkehrt integer;
BEGIN
  SELECT count(*) INTO n_null FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'zeitraum_bis' AND is_nullable = 'YES'
      AND table_name IN ('biomassestrom', 'output_bedarf');
  SELECT count(*) INTO n_chk FROM pg_constraint
    WHERE conname IN ('biomassestrom_zeitraum_check', 'output_bedarf_zeitraum_check') AND contype = 'c';
  SELECT count(*) INTO n_offen_b FROM biomassestrom WHERE zeitraum_bis IS NULL;
  SELECT count(*) INTO n_offen_o FROM output_bedarf WHERE zeitraum_bis IS NULL;
  SELECT (SELECT count(*) FROM biomassestrom WHERE zeitraum_bis < zeitraum_von)
       + (SELECT count(*) FROM output_bedarf WHERE zeitraum_bis < zeitraum_von) INTO n_verkehrt;
  IF n_null <> 2 OR n_chk <> 2 THEN RAISE EXCEPTION 'E75: Modell unvollstaendig (nullable=%, checks=%)', n_null, n_chk; END IF;
  RAISE NOTICE 'E75 zeitraum_bis: nullable=% checks=% unbefristet_biomasse=% unbefristet_output=% ende_vor_beginn=%', n_null, n_chk, n_offen_b, n_offen_o, n_verkehrt;
END $$;
