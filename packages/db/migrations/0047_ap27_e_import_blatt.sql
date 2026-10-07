ALTER TABLE "biomassestrom" ALTER COLUMN "ts_anteil_pct" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "biomassestrom" ALTER COLUMN "aschegehalt_pct" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "import_lauf" ADD COLUMN "blatt" text;--> statement-breakpoint
ALTER TABLE "import_lauf" ADD COLUMN "kopfzeile" integer;--> statement-breakpoint
ALTER TABLE "import_lauf" ADD COLUMN "zeitraum_von" date;--> statement-breakpoint
ALTER TABLE "import_lauf" ADD COLUMN "zeitraum_bis" date;--> statement-breakpoint
-- AP2.7 PR e (handgeschrieben ab hier): E21-Zaehlbeweis — vor dem Lockern gab es
-- keine NULL-Werte (Spalten waren NOT NULL); der CHECK haelt fest, dass ein
-- Strom ohne TS-Anteil oder Aschegehalt nie „geprueft" sein kann. Dieselbe
-- Regel prueft stromPruefen() vor dem Schreiben (eine Regel, zwei Stellen,
-- der CHECK ist das Sicherheitsnetz).
DO $$
DECLARE n_geprueft_unvollstaendig int;
BEGIN
  SELECT count(*) INTO n_geprueft_unvollstaendig FROM biomassestrom
   WHERE status::text = 'geprueft' AND (ts_anteil_pct IS NULL OR aschegehalt_pct IS NULL);
  RAISE NOTICE 'PR_E geprueft_unvollstaendig=%', n_geprueft_unvollstaendig;
  IF n_geprueft_unvollstaendig > 0 THEN
    RAISE EXCEPTION 'Abbruch: % geprueft(e) Strom/Stroeme ohne TS-Anteil oder Aschegehalt', n_geprueft_unvollstaendig;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD CONSTRAINT "biomassestrom_geprueft_vollstaendig_check"
  CHECK (status::text <> 'geprueft' OR (ts_anteil_pct IS NOT NULL AND aschegehalt_pct IS NOT NULL));
