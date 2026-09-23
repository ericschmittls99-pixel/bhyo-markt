-- F0b: PostGIS ist auf Preview und Production bereits aktiv (3.6.4,
-- Nachweis Schritt 0.1) — defensiv trotzdem, damit die Migration auf
-- jeder frischen Datenbank laeuft.
CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TYPE "public"."verwaltungs_ebene" AS ENUM('land', 'kreis');--> statement-breakpoint
CREATE TABLE "verwaltungsgebiet" (
	"ars" text PRIMARY KEY NOT NULL,
	"ebene" "verwaltungs_ebene" NOT NULL,
	"name" text NOT NULL,
	"bez" text NOT NULL,
	"geom" geometry(MultiPolygon,4326) NOT NULL,
	"geom_anzeige" geometry(MultiPolygon,4326) NOT NULL,
	"stichtag" date NOT NULL
);
--> statement-breakpoint
-- Raeumlicher Join laeuft ueber diesen Index (Point-in-Polygon).
CREATE INDEX "verwaltungsgebiet_geom_gist" ON "verwaltungsgebiet" USING GIST ("geom");--> statement-breakpoint
-- E23/E25: Landkreis und Bundesland eines Stroms werden NIE gespeichert —
-- diese View leitet sie zur Lesezeit per Point-in-Polygon ab. ST_Contains
-- (nicht ST_Covers): ein Punkt exakt AUF einer gemeinsamen Grenze faellt
-- in KEIN Gebiet ("ausserhalb") statt in beide (doppelte Zeile je Strom
-- waere das schlimmere Verhalten; reale Koordinaten treffen die Grenze
-- praktisch nie exakt). Handgeschrieben (drizzle-kit kennt keine Views),
-- Snapshot unangetastet.
CREATE VIEW strom_verwaltung AS
SELECT s.strom_id,
       s.art,
       k.ars  AS kreis_ars,
       k.name AS kreis_name,
       k.bez  AS kreis_bez,
       l.ars  AS land_ars,
       l.name AS land_name
FROM (
  SELECT id AS strom_id, 'biomasse' AS art, standort_geom FROM biomassestrom
  UNION ALL
  SELECT id, 'output', standort_geom FROM output_bedarf
) s
LEFT JOIN verwaltungsgebiet k
  ON k.ebene = 'kreis' AND s.standort_geom IS NOT NULL
 AND ST_Contains(k.geom, s.standort_geom)
LEFT JOIN verwaltungsgebiet l
  ON l.ebene = 'land' AND s.standort_geom IS NOT NULL
 AND ST_Contains(l.geom, s.standort_geom);
