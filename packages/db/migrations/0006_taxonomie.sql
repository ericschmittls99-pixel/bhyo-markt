-- AP1f-a: Feedstock-Cluster ersetzt materialart.gruppe, Output-Produkt-Taxonomie
-- ersetzt output_bedarf.vektor. Von Hand geschrieben (drizzle-kit braucht hier
-- interaktive Rename-Entscheidungen). Additiv anlegen, backfillen, dann alte
-- Spalten/Enums entfernen.
CREATE TYPE "public"."feedstock_cluster" AS ENUM('organische_rest_abfallstoffe', 'lignozellulosische_reststoffe', 'nachwachsende_rohstoffe', 'lipide_spezialfeedstocks', 'polymere_synthetische_c_quellen');--> statement-breakpoint
CREATE TYPE "public"."output_gruppe" AS ENUM('primaerprodukte', 'wasserstoff', 'derivate', 'add_ons');--> statement-breakpoint
CREATE TYPE "public"."output_art" AS ENUM('target', 'add_on');--> statement-breakpoint
CREATE TABLE "output_produkt" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"gruppe" "output_gruppe" NOT NULL,
	"art" "output_art" NOT NULL
);--> statement-breakpoint
-- Die vom output_bedarf-Backfill referenzierten Produkte muessen wegen des FK
-- schon existieren; der Seed (AP1f-a PR 2) upsertet spaeter alle 15.
INSERT INTO "output_produkt" ("code", "label", "gruppe", "art") VALUES
	('waerme', 'Wärme', 'add_ons', 'add_on'),
	('co2', 'CO2', 'add_ons', 'add_on'),
	('h2_niederdruck', 'H2 (Niederdruck)', 'wasserstoff', 'target');--> statement-breakpoint
-- materialart.gruppe -> cluster (chemische statt herkunftsbezogene Systematik).
-- gruenschnitt wechselt bewusst die Systematik (heute eigene Gruppe, kuenftig
-- organische Reststoffe).
ALTER TABLE "materialart" ADD COLUMN "cluster" "feedstock_cluster";--> statement-breakpoint
UPDATE "materialart" SET "cluster" = 'organische_rest_abfallstoffe' WHERE "code" IN ('guelle', 'mist', 'bioabfall', 'gruenschnitt');--> statement-breakpoint
UPDATE "materialart" SET "cluster" = 'lignozellulosische_reststoffe' WHERE "code" = 'stroh';--> statement-breakpoint
-- Sicherheitsnetz fuer evtl. per Inline-Neuanlage entstandene Materialarten.
UPDATE "materialart" SET "cluster" = 'organische_rest_abfallstoffe' WHERE "cluster" IS NULL;--> statement-breakpoint
ALTER TABLE "materialart" ALTER COLUMN "cluster" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "materialart" DROP COLUMN "gruppe";--> statement-breakpoint
DROP TYPE "public"."materialart_gruppe";--> statement-breakpoint
-- output_bedarf.vektor -> produkt_code. h2 -> h2_niederdruck ist eine Setzung,
-- weil das alte Enum die Druckstufe nicht kannte. Production ist derzeit leer,
-- Preview enthaelt nur Test-Daten – Risiko begrenzt.
ALTER TABLE "output_bedarf" ADD COLUMN "produkt_code" text;--> statement-breakpoint
UPDATE "output_bedarf" SET "produkt_code" = CASE "vektor"
	WHEN 'waerme' THEN 'waerme'
	WHEN 'co2' THEN 'co2'
	WHEN 'h2' THEN 'h2_niederdruck'
END;--> statement-breakpoint
UPDATE "output_bedarf" SET "produkt_code" = 'waerme' WHERE "produkt_code" IS NULL;--> statement-breakpoint
ALTER TABLE "output_bedarf" ALTER COLUMN "produkt_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD CONSTRAINT "output_bedarf_produkt_code_output_produkt_code_fk" FOREIGN KEY ("produkt_code") REFERENCES "public"."output_produkt"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_bedarf" DROP COLUMN "vektor";--> statement-breakpoint
DROP TYPE "public"."output_vektor";
