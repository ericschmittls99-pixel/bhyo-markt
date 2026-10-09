ALTER TYPE "public"."ereignis_art" ADD VALUE 'mail_gesendet';--> statement-breakpoint
-- AP2.9 (E74, handgeschrieben ab hier, Snapshot unangetastet): Zaehlbeweis —
-- der Wert steht im Enum (pg_enum ist in derselben Transaktion sichtbar, der
-- Wert selbst erst danach verwendbar, E53); Bestand an Mail-Ereignissen ist 0.
DO $$
DECLARE n_art integer; n_mail integer;
BEGIN
  SELECT count(*) INTO n_art FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ereignis_art' AND e.enumlabel = 'mail_gesendet';
  SELECT count(*) INTO n_mail FROM aenderung WHERE art::text = 'mail_gesendet';
  IF n_art <> 1 THEN RAISE EXCEPTION 'AP29: Ereignisart mail_gesendet fehlt'; END IF;
  RAISE NOTICE 'AP29 mail: art=% ereignisse=%', n_art, n_mail;
END $$;
