-- AP2.5 PR a2 (E66, Contract nach E21): Pflichtfelder am Akteur.
--
-- Sektor, PLZ und Ort des Sitzes werden NOT NULL. Fachlich gilt das seit a1
-- (0035): NULL im Sektor wurde dort zur Systemzeile 'ohne_sektor', PLZ und
-- Ort verlangt die Anlage (api/akteure) seit a1 — hier zieht das Schema nach.
-- Nichts wird erfunden: Steht noch eine Zeile mit NULL in einer der drei
-- Spalten, bricht der Lauf VOR dem ALTER ab und nennt die Zaehlung (Messung
-- auf Production vor dem Lauf: 0 Akteure, Leseweg 05.10.2026; die Preview
-- traegt den Seed, der PLZ und Ort immer setzt).
DO $$
DECLARE
  n_sektor integer; n_plz integer; n_ort integer;
BEGIN
  SELECT count(*) FILTER (WHERE sektor IS NULL),
         count(*) FILTER (WHERE sitz_plz IS NULL),
         count(*) FILTER (WHERE sitz_ort IS NULL)
    INTO n_sektor, n_plz, n_ort
    FROM akteur;
  RAISE NOTICE 'PR_A2 vorher sektor_null=% plz_null=% ort_null=%', n_sektor, n_plz, n_ort;
  IF n_sektor > 0 OR n_plz > 0 OR n_ort > 0 THEN
    RAISE EXCEPTION 'PR a2 abgebrochen, nichts geaendert: Akteure mit NULL (sektor=%, sitz_plz=%, sitz_ort=%) — erst in der Anwendung nachtragen', n_sektor, n_plz, n_ort;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "akteur" ALTER COLUMN "sektor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "akteur" ALTER COLUMN "sitz_plz" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "akteur" ALTER COLUMN "sitz_ort" SET NOT NULL;--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: genau drei Spalten des Akteurs sind jetzt NOT NULL
-- (zusaetzlich zu den schon bestehenden), und keine Zeile verletzt es.
DO $$
DECLARE
  n_nn integer; n_zeilen integer;
BEGIN
  SELECT count(*) INTO n_nn FROM information_schema.columns
   WHERE table_name = 'akteur' AND column_name IN ('sektor', 'sitz_plz', 'sitz_ort') AND is_nullable = 'NO';
  SELECT count(*) INTO n_zeilen FROM akteur;
  RAISE NOTICE 'PR_A2 not_null=% akteure=%', n_nn, n_zeilen;
  IF n_nn <> 3 THEN
    RAISE EXCEPTION 'PR a2 nach Contract widerspruechlich (not_null=%)', n_nn;
  END IF;
END $$;
