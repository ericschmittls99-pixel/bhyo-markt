-- Betrieb 05.10.2026 (Eric): Hinweise zustandsbasiert abraeumen. Der taegliche
-- Job raeumt jeden offenen verifikation_laeuft_ab-/verifikation_abgelaufen-
-- Hinweis ab, dessen Bedingung zum Stichtag nicht mehr gilt (abgeleitet aus
-- strom_verifikation, keine Ereignisliste; lib/inbox/hinweise.ts). Das
-- Ergebnis wird je Lauf gezaehlt: job_lauf.abgeraeumt (NULL fuer Laeufe vor
-- dieser Migration und solange ein Lauf laeuft oder scheiterte).
-- Erste Migration, die der eigene Runner (src/migrieren.ts) anwendet.
ALTER TABLE "job_lauf" ADD COLUMN "abgeraeumt" integer;--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: Spalte vorhanden, Laeufe bisher ohne Zaehlung.
DO $$
DECLARE
  n_spalte integer; n_laeufe integer; n_ohne integer;
BEGIN
  SELECT count(*) INTO n_spalte FROM information_schema.columns
   WHERE table_name = 'job_lauf' AND column_name = 'abgeraeumt' AND data_type = 'integer';
  SELECT count(*), count(*) FILTER (WHERE abgeraeumt IS NULL) INTO n_laeufe, n_ohne FROM job_lauf;
  RAISE NOTICE 'PR_ABRAEUMEN spalte=% laeufe=% ohne_zaehlung=%', n_spalte, n_laeufe, n_ohne;
  IF n_spalte <> 1 OR n_ohne <> n_laeufe THEN
    RAISE EXCEPTION 'Abraeumen-Spalte widerspruechlich (spalte=%, laeufe=%, ohne=%)', n_spalte, n_laeufe, n_ohne;
  END IF;
END $$;
