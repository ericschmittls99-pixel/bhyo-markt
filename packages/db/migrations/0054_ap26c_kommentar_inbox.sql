ALTER TYPE "public"."inbox_typ" ADD VALUE 'kommentar';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'erwaehnung';--> statement-breakpoint
ALTER TABLE "inbox_eintrag" DROP CONSTRAINT "inbox_eintrag_genau_ein_strom_check";--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD COLUMN "kommentar_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_kommentar_id_kommentar_id_fk" FOREIGN KEY ("kommentar_id") REFERENCES "public"."kommentar"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_eintrag_kommentar_id_idx" ON "inbox_eintrag" USING btree ("kommentar_id");--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_genau_ein_strom_check" CHECK (num_nonnulls("inbox_eintrag"."biomassestrom_id", "inbox_eintrag"."output_bedarf_id", "inbox_eintrag"."akteur_id", "inbox_eintrag"."kontaktperson_id", "inbox_eintrag"."import_lauf_id", "inbox_eintrag"."kommentar_id") = 1);--> statement-breakpoint
-- AP2.6 PR c (E71, handgeschrieben ab hier, Snapshot unangetastet): Zaehlbeweis —
-- beide Typen im Enum (pg_enum sichtbar, Werte erst nach der Transaktion
-- verwendbar, E53), Spalte und CHECK stehen, kein Eintrag traegt bisher einen Kommentar.
DO $$
DECLARE n_typ integer; n_sp integer; n_chk integer; n_ein integer;
BEGIN
  SELECT count(*) INTO n_typ FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'inbox_typ' AND e.enumlabel IN ('kommentar', 'erwaehnung');
  SELECT count(*) INTO n_sp FROM information_schema.columns WHERE table_name = 'inbox_eintrag' AND column_name = 'kommentar_id';
  SELECT count(*) INTO n_chk FROM pg_constraint WHERE conname = 'inbox_eintrag_genau_ein_strom_check' AND pg_get_constraintdef(oid) LIKE '%kommentar_id%';
  SELECT count(*) INTO n_ein FROM inbox_eintrag WHERE kommentar_id IS NOT NULL;
  IF n_typ <> 2 OR n_sp <> 1 OR n_chk <> 1 THEN RAISE EXCEPTION 'AP26c: Inbox-Erweiterung unvollstaendig (typen=%, spalte=%, check=%)', n_typ, n_sp, n_chk; END IF;
  RAISE NOTICE 'AP26c kommentar_inbox: typen=% spalte=% check=% eintraege_mit_kommentar=%', n_typ, n_sp, n_chk, n_ein;
END $$;
