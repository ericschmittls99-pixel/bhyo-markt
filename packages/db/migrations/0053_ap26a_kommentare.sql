ALTER TYPE "public"."ereignis_art" ADD VALUE 'kommentar_erstellt';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'kommentar_bearbeitet';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'kommentar_geloescht';--> statement-breakpoint
CREATE TABLE "kommentar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"biomassestrom_id" uuid,
	"output_bedarf_id" uuid,
	"akteur_id" uuid,
	"autor_id" uuid NOT NULL,
	"text" text,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"bearbeitet_am" timestamp with time zone,
	"geloescht_am" timestamp with time zone,
	CONSTRAINT "kommentar_genau_ein_bezug_check" CHECK (num_nonnulls("kommentar"."biomassestrom_id", "kommentar"."output_bedarf_id", "kommentar"."akteur_id") = 1),
	CONSTRAINT "kommentar_text_check" CHECK (("kommentar"."geloescht_am" is null and "kommentar"."text" is not null and length(btrim("kommentar"."text")) between 1 and 2000) or ("kommentar"."geloescht_am" is not null and "kommentar"."text" is null))
);
--> statement-breakpoint
CREATE TABLE "kommentar_erwaehnung" (
	"kommentar_id" uuid NOT NULL,
	"nutzer_id" uuid NOT NULL,
	CONSTRAINT "kommentar_erwaehnung_kommentar_id_nutzer_id_pk" PRIMARY KEY("kommentar_id","nutzer_id")
);
--> statement-breakpoint
ALTER TABLE "kommentar" ADD CONSTRAINT "kommentar_biomassestrom_id_biomassestrom_id_fk" FOREIGN KEY ("biomassestrom_id") REFERENCES "public"."biomassestrom"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kommentar" ADD CONSTRAINT "kommentar_output_bedarf_id_output_bedarf_id_fk" FOREIGN KEY ("output_bedarf_id") REFERENCES "public"."output_bedarf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kommentar" ADD CONSTRAINT "kommentar_akteur_id_akteur_id_fk" FOREIGN KEY ("akteur_id") REFERENCES "public"."akteur"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kommentar" ADD CONSTRAINT "kommentar_autor_id_benutzer_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kommentar_erwaehnung" ADD CONSTRAINT "kommentar_erwaehnung_kommentar_id_kommentar_id_fk" FOREIGN KEY ("kommentar_id") REFERENCES "public"."kommentar"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kommentar_erwaehnung" ADD CONSTRAINT "kommentar_erwaehnung_nutzer_id_benutzer_id_fk" FOREIGN KEY ("nutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kommentar_biomassestrom_id_idx" ON "kommentar" USING btree ("biomassestrom_id");--> statement-breakpoint
CREATE INDEX "kommentar_output_bedarf_id_idx" ON "kommentar" USING btree ("output_bedarf_id");--> statement-breakpoint
CREATE INDEX "kommentar_akteur_id_idx" ON "kommentar" USING btree ("akteur_id");--> statement-breakpoint
CREATE INDEX "kommentar_erwaehnung_nutzer_id_idx" ON "kommentar_erwaehnung" USING btree ("nutzer_id");--> statement-breakpoint
-- AP2.6 PR a (E71, handgeschrieben ab hier, Snapshot unangetastet): Zaehlbeweis
-- im Migrationslauf — beide Tabellen stehen, die drei Ereignisarten sind im
-- Enum (pg_enum ist in derselben Transaktion sichtbar, der Wert selbst erst danach
-- verwendbar, E53), der Bestand ist leer (neue Tabelle).
DO $$
DECLARE n_tab integer; n_art integer; n_kom integer;
BEGIN
  SELECT count(*) INTO n_tab FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('kommentar', 'kommentar_erwaehnung');
  SELECT count(*) INTO n_art FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ereignis_art' AND e.enumlabel IN ('kommentar_erstellt', 'kommentar_bearbeitet', 'kommentar_geloescht');
  SELECT count(*) INTO n_kom FROM kommentar;
  IF n_tab <> 2 OR n_art <> 3 THEN RAISE EXCEPTION 'AP26a: Kommentar-Modell unvollstaendig (tabellen=%, arten=%)', n_tab, n_art; END IF;
  RAISE NOTICE 'AP26a kommentar: tabellen=% arten=% kommentare=%', n_tab, n_art, n_kom;
END $$;
