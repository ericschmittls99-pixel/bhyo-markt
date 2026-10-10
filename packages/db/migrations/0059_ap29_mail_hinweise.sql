ALTER TYPE "public"."inbox_typ" ADD VALUE 'mail_stoerung';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'mail_secret_laeuft_ab';--> statement-breakpoint
ALTER TABLE "inbox_eintrag" DROP CONSTRAINT "inbox_eintrag_genau_ein_strom_check";--> statement-breakpoint
ALTER TABLE "inbox_eintrag" DROP CONSTRAINT "inbox_eintrag_urheber_check";--> statement-breakpoint
ALTER TABLE "inbox_eintrag" DROP CONSTRAINT "inbox_eintrag_stufe_check";--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD COLUMN "ursache" text;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_mail_stoerung_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","ursache") WHERE "inbox_eintrag"."zustand" = 'offen' and inbox_typ_text("inbox_eintrag"."typ") = 'mail_stoerung';--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_mail_secret_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","bezugsdatum","stufe") WHERE inbox_typ_text("inbox_eintrag"."typ") = 'mail_secret_laeuft_ab';--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_ursache_check" CHECK ((inbox_typ_text("inbox_eintrag"."typ") = 'mail_stoerung') = ("inbox_eintrag"."ursache" is not null));--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_genau_ein_strom_check" CHECK ((num_nonnulls("inbox_eintrag"."biomassestrom_id", "inbox_eintrag"."output_bedarf_id", "inbox_eintrag"."akteur_id", "inbox_eintrag"."kontaktperson_id", "inbox_eintrag"."import_lauf_id", "inbox_eintrag"."kommentar_id") = 1 and inbox_typ_text("inbox_eintrag"."typ") not in ('mail_stoerung', 'mail_secret_laeuft_ab')) or (num_nonnulls("inbox_eintrag"."biomassestrom_id", "inbox_eintrag"."output_bedarf_id", "inbox_eintrag"."akteur_id", "inbox_eintrag"."kontaktperson_id", "inbox_eintrag"."import_lauf_id", "inbox_eintrag"."kommentar_id") = 0 and inbox_typ_text("inbox_eintrag"."typ") in ('mail_stoerung', 'mail_secret_laeuft_ab')));--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_urheber_check" CHECK (inbox_typ_text("inbox_eintrag"."typ") in ('verifikation_laeuft_ab', 'verifikation_abgelaufen', 'akteur_verwaist', 'kontaktperson_loeschpruefung', 'biomasse_wird_frei', 'mail_stoerung', 'mail_secret_laeuft_ab') or ("inbox_eintrag"."ausloeser_id" is not null and "inbox_eintrag"."ereignis_id" is not null));--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_stufe_check" CHECK ((inbox_typ_text("inbox_eintrag"."typ") in ('biomasse_wird_frei', 'mail_secret_laeuft_ab')) = ("inbox_eintrag"."stufe" is not null));--> statement-breakpoint
-- AP2.9 Umschalten vorbereiten (E76 Nr. 6/8, handgeschrieben ab hier, Snapshot
-- unangetastet): Zaehlbeweis — beide Typen stehen im Enum (in derselben
-- Transaktion sichtbar, erst danach als Literal verwendbar, E53), Spalte
-- ursache, die drei umgebauten CHECKs plus der neue, beide Indizes; Bestand:
-- noch kein Mail-Hinweis (Praedikat ueber inbox_typ_text, nie als Literal).
DO $$
DECLARE n_typ integer; n_sp integer; n_chk integer; n_idx integer; n_hinweise integer;
BEGIN
  SELECT count(*) INTO n_typ FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'inbox_typ' AND e.enumlabel IN ('mail_stoerung', 'mail_secret_laeuft_ab');
  SELECT count(*) INTO n_sp FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inbox_eintrag' AND column_name = 'ursache';
  SELECT count(*) INTO n_chk FROM pg_constraint
    WHERE conrelid = 'inbox_eintrag'::regclass AND contype = 'c'
      AND conname IN ('inbox_eintrag_genau_ein_strom_check', 'inbox_eintrag_urheber_check', 'inbox_eintrag_stufe_check', 'inbox_eintrag_ursache_check');
  SELECT count(*) INTO n_idx FROM pg_indexes
    WHERE tablename = 'inbox_eintrag' AND indexname IN ('inbox_eintrag_mail_stoerung_uidx', 'inbox_eintrag_mail_secret_uidx');
  SELECT count(*) INTO n_hinweise FROM inbox_eintrag WHERE inbox_typ_text(typ) IN ('mail_stoerung', 'mail_secret_laeuft_ab');
  IF n_typ <> 2 OR n_sp <> 1 OR n_chk <> 4 OR n_idx <> 2 THEN
    RAISE EXCEPTION 'AP29 mail_hinweise: Modell unvollstaendig (typen=%, spalte=%, checks=%, indizes=%)', n_typ, n_sp, n_chk, n_idx;
  END IF;
  RAISE NOTICE 'AP29 mail_hinweise: typen=% spalte=% checks=% indizes=% hinweise=%', n_typ, n_sp, n_chk, n_idx, n_hinweise;
END $$;
