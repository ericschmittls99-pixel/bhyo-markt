CREATE TABLE "vergabe_zeitraum" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"biomassestrom_id" uuid,
	"output_bedarf_id" uuid,
	"vergeben_von" date,
	"vergeben_bis" date,
	"vergeben_an" text,
	"an_bhyo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vergabe_ein_elternteil_check" CHECK (("vergabe_zeitraum"."biomassestrom_id" IS NULL) <> ("vergabe_zeitraum"."output_bedarf_id" IS NULL)),
	CONSTRAINT "vergabe_mindestens_ein_datum_check" CHECK ("vergabe_zeitraum"."vergeben_von" IS NOT NULL OR "vergabe_zeitraum"."vergeben_bis" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD COLUMN "reserviert_bhyo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD COLUMN "reserviert_bhyo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vergabe_zeitraum" ADD CONSTRAINT "vergabe_zeitraum_biomassestrom_id_biomassestrom_id_fk" FOREIGN KEY ("biomassestrom_id") REFERENCES "public"."biomassestrom"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vergabe_zeitraum" ADD CONSTRAINT "vergabe_zeitraum_output_bedarf_id_output_bedarf_id_fk" FOREIGN KEY ("output_bedarf_id") REFERENCES "public"."output_bedarf"("id") ON DELETE no action ON UPDATE no action;