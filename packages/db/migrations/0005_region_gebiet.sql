-- AP1e: Region-Flaeche als Polygon statt Punkt+Radius (ersetzt 0003).
-- Von Hand geschrieben (drizzle-kit braucht hier eine interaktive Rename-
-- Entscheidung): Spalte nullable anlegen, bestehende Zeilen aus standort_geom +
-- einzugsradius_km auf ein Bounding-Box-Polygon backfillen, dann NOT NULL,
-- danach die alten Spalten entfernen. SRID/Polygon-Typ von Hand (drizzle-kit
-- gibt SRID nicht aus, siehe fruehere Migrationen).
ALTER TABLE "region" ADD COLUMN "gebiet" geometry(Polygon,4326);--> statement-breakpoint
-- Kreis (Mittelpunkt + Radius km) naeherungsweise in eine Bounding-Box umsetzen
-- (Grad: lat km/111, lng km/(111*cos(lat))). Reicht fuer die Test-Regionen;
-- Production traegt aktuell keine echten Regionen.
UPDATE "region" SET "gebiet" = ST_SetSRID(ST_MakeEnvelope(
    ST_X("standort_geom") - COALESCE("einzugsradius_km", 10) / (111.0 * COS(RADIANS(ST_Y("standort_geom")))),
    ST_Y("standort_geom") - COALESCE("einzugsradius_km", 10) / 111.0,
    ST_X("standort_geom") + COALESCE("einzugsradius_km", 10) / (111.0 * COS(RADIANS(ST_Y("standort_geom")))),
    ST_Y("standort_geom") + COALESCE("einzugsradius_km", 10) / 111.0
), 4326) WHERE "standort_geom" IS NOT NULL;--> statement-breakpoint
-- Sicherheitsnetz, falls eine Zeile ohne standort_geom existiert.
UPDATE "region" SET "gebiet" = ST_SetSRID(ST_MakeEnvelope(9.0, 48.3, 9.4, 48.7), 4326) WHERE "gebiet" IS NULL;--> statement-breakpoint
ALTER TABLE "region" ALTER COLUMN "gebiet" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "region" DROP COLUMN "standort_geom";--> statement-breakpoint
ALTER TABLE "region" DROP COLUMN "einzugsradius_km";
