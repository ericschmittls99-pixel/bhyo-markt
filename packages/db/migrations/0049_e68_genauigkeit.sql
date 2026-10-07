CREATE TYPE "public"."standort_genauigkeit" AS ENUM('hausnummer', 'strasse', 'plz_gebiet', 'manuell', 'unbekannt');--> statement-breakpoint
ALTER TABLE "akteur" ADD COLUMN "sitz_genauigkeit" "standort_genauigkeit" DEFAULT 'unbekannt' NOT NULL;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD COLUMN "standort_genauigkeit" "standort_genauigkeit" DEFAULT 'unbekannt' NOT NULL;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD COLUMN "standort_genauigkeit" "standort_genauigkeit" DEFAULT 'unbekannt' NOT NULL;