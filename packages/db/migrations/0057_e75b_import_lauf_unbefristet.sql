ALTER TABLE "import_lauf" ADD COLUMN "zeitraum_unbefristet" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- E75b (handgeschrieben ab hier, Snapshot unangetastet): Zaehlbeweis im
-- Migrationslauf — die Spalte steht mit Default false, kein Bestandslauf ist
-- unbefristet (der Default greift fuer alle vorhandenen Zeilen).
DO $$
DECLARE n_sp integer; n_laeufe integer; n_unbefristet integer;
BEGIN
  SELECT count(*) INTO n_sp FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'import_lauf' AND column_name = 'zeitraum_unbefristet' AND is_nullable = 'NO';
  SELECT count(*) INTO n_laeufe FROM import_lauf;
  SELECT count(*) INTO n_unbefristet FROM import_lauf WHERE zeitraum_unbefristet;
  IF n_sp <> 1 THEN RAISE EXCEPTION 'E75b: Spalte zeitraum_unbefristet fehlt'; END IF;
  RAISE NOTICE 'E75b import_lauf: spalte=% laeufe=% unbefristet=%', n_sp, n_laeufe, n_unbefristet;
END $$;
