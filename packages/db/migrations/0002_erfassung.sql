ALTER TYPE "public"."beleg_typ" ADD VALUE 'betriebsdaten';--> statement-breakpoint
CREATE TABLE "aenderung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entitaet_typ" text NOT NULL,
	"entitaet_id" uuid NOT NULL,
	"zeitpunkt" timestamp with time zone DEFAULT now() NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beleg" ADD COLUMN "extern_nachvollziehbar" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "beleg" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD COLUMN "bezeichnung" text;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD COLUMN "ort" text;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD COLUMN "landkreis" text;--> statement-breakpoint
-- SRID 4326 von Hand ergaenzt: drizzle-kit 0.31 gibt sie trotz { srid: 4326 }
-- im Schema nicht aus (siehe Migration 0001 / region.standort_geom).
ALTER TABLE "biomassestrom" ADD COLUMN "standort_geom" geometry(Point,4326);--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD COLUMN "kontaktperson" text;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD COLUMN "bezeichnung" text;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD COLUMN "ort" text;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD COLUMN "landkreis" text;--> statement-breakpoint
-- SRID 4326 von Hand ergaenzt (wie oben).
ALTER TABLE "output_bedarf" ADD COLUMN "standort_geom" geometry(Point,4326);--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD COLUMN "kontaktperson" text;