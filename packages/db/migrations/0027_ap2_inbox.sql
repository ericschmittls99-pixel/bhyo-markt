-- AP2.2 PR b (Expand nach E21): Inbox-Kern. Enums inbox_typ / inbox_zustand,
-- Tabelle inbox_eintrag je Empfaenger mit Buendelung per DB (partielle
-- Unique-Indizes je Strom-Typ, WHERE offen AND aenderung_eintrag) und dem
-- Zaehler-Index (offen AND ungelesen). Einzige Schreibstelle: apps/web/lib/inbox.
CREATE TYPE "public"."inbox_typ" AS ENUM('aenderung_eintrag');--> statement-breakpoint
CREATE TYPE "public"."inbox_zustand" AS ENUM('offen', 'erledigt', 'verworfen');--> statement-breakpoint
CREATE TABLE "inbox_eintrag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empfaenger_id" uuid NOT NULL,
	"ausloeser_id" uuid NOT NULL,
	"typ" "inbox_typ" NOT NULL,
	"biomassestrom_id" uuid,
	"output_bedarf_id" uuid,
	"ereignis_id" uuid NOT NULL,
	"anzahl" integer DEFAULT 1 NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"aktualisiert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"gelesen_am" timestamp with time zone,
	"zustand" "inbox_zustand" DEFAULT 'offen' NOT NULL,
	"zustand_seit" timestamp with time zone DEFAULT now() NOT NULL,
	"notiz" text,
	CONSTRAINT "inbox_eintrag_genau_ein_strom_check" CHECK (num_nonnulls("inbox_eintrag"."biomassestrom_id", "inbox_eintrag"."output_bedarf_id") = 1),
	CONSTRAINT "inbox_eintrag_anzahl_check" CHECK ("inbox_eintrag"."anzahl" >= 1)
);
--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_empfaenger_id_benutzer_id_fk" FOREIGN KEY ("empfaenger_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_ausloeser_id_benutzer_id_fk" FOREIGN KEY ("ausloeser_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_biomassestrom_id_biomassestrom_id_fk" FOREIGN KEY ("biomassestrom_id") REFERENCES "public"."biomassestrom"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_output_bedarf_id_output_bedarf_id_fk" FOREIGN KEY ("output_bedarf_id") REFERENCES "public"."output_bedarf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_ereignis_id_aenderung_id_fk" FOREIGN KEY ("ereignis_id") REFERENCES "public"."aenderung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_biomasse_offen_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","biomassestrom_id") WHERE "inbox_eintrag"."zustand" = 'offen' and "inbox_eintrag"."typ" = 'aenderung_eintrag' and "inbox_eintrag"."biomassestrom_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_output_offen_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","output_bedarf_id") WHERE "inbox_eintrag"."zustand" = 'offen' and "inbox_eintrag"."typ" = 'aenderung_eintrag' and "inbox_eintrag"."output_bedarf_id" is not null;--> statement-breakpoint
CREATE INDEX "inbox_eintrag_zaehler_idx" ON "inbox_eintrag" USING btree ("empfaenger_id") WHERE "inbox_eintrag"."zustand" = 'offen' and "inbox_eintrag"."gelesen_am" is null;--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: die Tabelle ist neu und leer, beide partiellen
-- Unique-Indizes und der Zaehler-Index stehen — sonst gilt die Migration
-- nicht als gelungen.
DO $$
DECLARE
  n_zeilen integer;
  n_indizes integer;
BEGIN
  SELECT count(*) INTO n_zeilen FROM inbox_eintrag;
  SELECT count(*) INTO n_indizes FROM pg_indexes
   WHERE tablename = 'inbox_eintrag'
     AND indexname IN ('inbox_eintrag_biomasse_offen_uidx', 'inbox_eintrag_output_offen_uidx', 'inbox_eintrag_zaehler_idx');
  RAISE NOTICE 'INBOX zeilen=% indizes=%', n_zeilen, n_indizes;
  IF n_zeilen <> 0 OR n_indizes <> 3 THEN
    RAISE EXCEPTION 'Inbox nach Expand widerspruechlich (zeilen=%, indizes=%)', n_zeilen, n_indizes;
  END IF;
END $$;
