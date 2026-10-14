ALTER TABLE "benutzer" ADD COLUMN "bild_key" text;--> statement-breakpoint
ALTER TABLE "benutzer" ADD COLUMN "bild_geaendert_am" timestamp with time zone;--> statement-breakpoint
-- E77 R7 (handgeschrieben ab hier, Snapshot unangetastet): Zaehlbeweis — beide
-- Profilbild-Spalten stehen, kein Bestandsnutzer traegt ein Bild (additiv, NULL).
DO $$
DECLARE n_sp integer; n_nutzer integer; n_bild integer;
BEGIN
  SELECT count(*) INTO n_sp FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'benutzer' AND column_name IN ('bild_key', 'bild_geaendert_am');
  SELECT count(*), count(*) FILTER (WHERE bild_key IS NOT NULL) INTO n_nutzer, n_bild FROM benutzer;
  IF n_sp <> 2 THEN RAISE EXCEPTION 'E77 R7: Profilbild-Spalten unvollstaendig (spalten=%)', n_sp; END IF;
  IF n_bild <> 0 THEN RAISE EXCEPTION 'E77 R7: Bestandsnutzer mit Bild vor der Einfuehrung (bild=%)', n_bild; END IF;
  RAISE NOTICE 'E77 R7 profil: spalten=% nutzer=% mit_bild=%', n_sp, n_nutzer, n_bild;
END $$;
