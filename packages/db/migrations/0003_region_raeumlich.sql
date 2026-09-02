ALTER TABLE "biomassestrom" DROP CONSTRAINT "biomassestrom_region_id_region_id_fk";
--> statement-breakpoint
ALTER TABLE "output_bedarf" DROP CONSTRAINT "output_bedarf_region_id_region_id_fk";
--> statement-breakpoint
ALTER TABLE "region" ADD COLUMN "einzugsradius_km" numeric;--> statement-breakpoint
ALTER TABLE "biomassestrom" DROP COLUMN "region_id";--> statement-breakpoint
ALTER TABLE "output_bedarf" DROP COLUMN "region_id";