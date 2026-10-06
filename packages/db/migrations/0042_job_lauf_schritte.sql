-- Betrieb 06.10.2026 (Eric): Laufzeit des Verifikations-Jobs messen, nachdem
-- der Lauf vom 06.10. 57 s brauchte (zuvor 2,5 bis 25 s) bei 0 Stroemen auf
-- Production. Zwei additive Spalten mit ihrem Verbraucher (lib/jobs/verifikation.ts,
-- lib/inbox/hinweise.ts, Laeufe-Wache, Leseweg):
--   ausgeloest_am  Cron-Zeitpunkt aus dem Worker. gestartet_am setzt seither die
--                  DB beim ersten Schreiben (Default now()) — die Differenz ist
--                  der Verbindungsaufbau (Hyperdrive, Neon-Kaltstart).
--   schritte       Millisekunden je Schritt aus Sicht des Workers
--                  ({ verbindung, zustellen, vorab_erledigen, abraeumen, verwaist,
--                     verwaist_erledigen, loeschpruefung, loeschpruefung_erledigen, gesamt }).
-- NULL fuer Laeufe vor dieser Migration.
ALTER TABLE "job_lauf" ADD COLUMN "ausgeloest_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_lauf" ADD COLUMN "schritte" jsonb;--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: beide Spalten vorhanden, Laeufe bisher ohne Messung.
DO $$
DECLARE
  n_spalten integer; n_laeufe integer; n_ohne integer;
BEGIN
  SELECT count(*) INTO n_spalten FROM information_schema.columns
   WHERE table_name = 'job_lauf' AND column_name IN ('ausgeloest_am', 'schritte');
  SELECT count(*), count(*) FILTER (WHERE schritte IS NULL AND ausgeloest_am IS NULL) INTO n_laeufe, n_ohne FROM job_lauf;
  RAISE NOTICE 'PR_SCHRITTE spalten=% laeufe=% ohne_messung=%', n_spalten, n_laeufe, n_ohne;
  IF n_spalten <> 2 OR n_ohne <> n_laeufe THEN
    RAISE EXCEPTION 'Schritte-Spalten widerspruechlich (spalten=%, laeufe=%, ohne=%)', n_spalten, n_laeufe, n_ohne;
  END IF;
END $$;
