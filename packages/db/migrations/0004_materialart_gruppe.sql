CREATE TYPE "public"."materialart_gruppe" AS ENUM('gruenschnitt_landschaftspflege', 'holz_rebschnitt', 'bioabfall_kompost', 'klaerschlamm', 'agrar_lebensmittelreststoffe');--> statement-breakpoint
-- Spalte zunaechst nullable anlegen, damit vorhandene Zeilen backfillt werden
-- koennen, bevor NOT NULL gesetzt wird (drizzle-kit erzeugt sonst ein direktes
-- NOT NULL, das an bestehenden materialart-Zeilen scheitern wuerde).
ALTER TABLE "materialart" ADD COLUMN "gruppe" "materialart_gruppe";--> statement-breakpoint
-- Bestehende Seed-Materialarten einmalig mappen (Doku AP1c).
UPDATE "materialart" SET "gruppe" = 'agrar_lebensmittelreststoffe' WHERE "code" IN ('guelle', 'mist', 'stroh');--> statement-breakpoint
UPDATE "materialart" SET "gruppe" = 'bioabfall_kompost' WHERE "code" = 'bioabfall';--> statement-breakpoint
UPDATE "materialart" SET "gruppe" = 'gruenschnitt_landschaftspflege' WHERE "code" = 'gruenschnitt';--> statement-breakpoint
-- Sicherheitsnetz fuer eventuell per Inline-Neuanlage entstandene Materialarten
-- (z. B. auf Preview): breiteste Gruppe als Fallback, bevor NOT NULL greift.
UPDATE "materialart" SET "gruppe" = 'agrar_lebensmittelreststoffe' WHERE "gruppe" IS NULL;--> statement-breakpoint
ALTER TABLE "materialart" ALTER COLUMN "gruppe" SET NOT NULL;
