ALTER TYPE "public"."ereignis_art" ADD VALUE 'mail_gesendet';--> statement-breakpoint
ALTER TABLE "benutzer" ADD COLUMN "roundup" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "benutzer" ADD COLUMN "roundup_zuletzt_am" timestamp with time zone;--> statement-breakpoint
-- AP2.9 (E74/E76, handgeschrieben ab hier, Snapshot unangetastet): Zaehlbeweis —
-- die Ereignisart steht im Enum (in derselben Transaktion sichtbar, erst danach
-- verwendbar, E53), beide Roundup-Spalten stehen, jeder Bestandsnutzer hat
-- roundup = true (Default) und noch keinen Versand; Mail-Ereignisse: 0.
DO $$
DECLARE n_art integer; n_sp integer; n_nutzer integer; n_an integer; n_versand integer; n_mail integer;
BEGIN
  SELECT count(*) INTO n_art FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ereignis_art' AND e.enumlabel = 'mail_gesendet';
  SELECT count(*) INTO n_sp FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'benutzer' AND column_name IN ('roundup', 'roundup_zuletzt_am');
  SELECT count(*), count(*) FILTER (WHERE roundup), count(*) FILTER (WHERE roundup_zuletzt_am IS NOT NULL)
    INTO n_nutzer, n_an, n_versand FROM benutzer;
  SELECT count(*) INTO n_mail FROM aenderung WHERE art::text = 'mail_gesendet';
  IF n_art <> 1 OR n_sp <> 2 THEN RAISE EXCEPTION 'AP29: Modell unvollstaendig (art=%, spalten=%)', n_art, n_sp; END IF;
  RAISE NOTICE 'AP29 mail_roundup: art=% spalten=% nutzer=% roundup_an=% versendet=% ereignisse=%', n_art, n_sp, n_nutzer, n_an, n_versand, n_mail;
END $$;
