CREATE TABLE "plz_gebiet" (
	"plz" text PRIMARY KEY NOT NULL,
	"geom" geometry(MultiPolygon,4326) NOT NULL,
	"stichtag" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plz_ort" (
	"plz" text NOT NULL,
	"ort" text NOT NULL,
	"ort_norm" text NOT NULL,
	"ars" text NOT NULL,
	CONSTRAINT "plz_ort_plz_ars_pk" PRIMARY KEY("plz","ars")
);
--> statement-breakpoint
ALTER TABLE "plz_ort" ADD CONSTRAINT "plz_ort_plz_plz_gebiet_plz_fk" FOREIGN KEY ("plz") REFERENCES "public"."plz_gebiet"("plz") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- E68 PR 1 (handgeschrieben ab hier, Snapshot unangetastet): Index, Regel,
-- Funktionen der lokalen Adresspruefung. Die TS-Spiegel stehen in
-- packages/db/src/plz.ts; plz-check.ts prueft beide gegeneinander.
ALTER TABLE "plz_gebiet" ADD CONSTRAINT "plz_gebiet_plz_check" CHECK ("plz" ~ '^[0-9]{5}$');--> statement-breakpoint
CREATE INDEX "plz_gebiet_geom_gist" ON "plz_gebiet" USING GIST ("geom");--> statement-breakpoint
CREATE INDEX "plz_ort_norm_idx" ON "plz_ort" ("ort_norm");--> statement-breakpoint
-- Uebliche Normalisierung eines Ortsnamens fuer den Vergleich: Kleinbuchstaben,
-- Umlaute und ß ausgeschrieben, alles ausser Buchstaben/Ziffern wird EIN
-- Leerzeichen („Frankfurt (Oder)" -> „frankfurt oder"). IMMUTABLE, damit
-- sie in Indizes und Vergleichen stabil ist; Spiegel: normalisiereOrt().
CREATE FUNCTION plz_ort_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    replace(replace(replace(replace(lower(t), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'),
    '[^a-z0-9]+', ' ', 'g'))
$$;--> statement-breakpoint
-- Passt die Eingabe zu einem Ort der PLZ? Gleichheit der Normalform oder
-- Kurzform (Eingabe ist ein Wortpraefix: „ludwigshafen" passt zu
-- „ludwigshafen am rhein", „halle" zu „halle saale"). Spiegel: ortPasst().
CREATE FUNCTION plz_ort_passt(p_eingabe text, p_ort_norm text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT plz_ort_norm(p_eingabe) <> ''
     AND (p_ort_norm = plz_ort_norm(p_eingabe)
          OR p_ort_norm LIKE replace(replace(plz_ort_norm(p_eingabe), '\', '\\'), '%', '\%') || ' %')
$$;--> statement-breakpoint
-- Pruefung PLZ + Ort: existiert die PLZ, passt der Ort, welche Orte gibt es
-- (Vorschlaege fuer „Meinten Sie …?"). Genau eine Zeile, auch bei unbekannter PLZ.
CREATE FUNCTION plz_pruefung(p_plz text, p_ort text)
RETURNS TABLE (plz_bekannt boolean, ort_passt boolean, orte text[])
LANGUAGE sql STABLE AS $$
  SELECT exists(SELECT 1 FROM plz_gebiet g WHERE g.plz = p_plz),
         coalesce(bool_or(plz_ort_passt(coalesce(p_ort, ''), o.ort_norm)), false),
         coalesce(array_agg(o.ort ORDER BY o.ort) FILTER (WHERE o.ort IS NOT NULL), '{}')
  FROM plz_ort o WHERE o.plz = p_plz
$$;--> statement-breakpoint
-- PLZ zu einem Punkt (ST_Covers auf plz_gebiet; ein Punkt genau auf einer
-- Grenze trifft beide Seiten, deshalb die kleinere Flaeche zuerst) samt den
-- Orten der PLZ. Welcher Ort genau, weiss die Tabelle ohne Geometrie nicht:
-- bei genau einem Ort ist er eindeutig, sonst entscheidet der Mensch.
CREATE FUNCTION plz_fuer_punkt(p geometry)
RETURNS TABLE (plz text, orte text[])
LANGUAGE sql STABLE AS $$
  SELECT g.plz,
         coalesce((SELECT array_agg(o.ort ORDER BY o.ort) FROM plz_ort o WHERE o.plz = g.plz), '{}')
  FROM plz_gebiet g
  WHERE ST_Covers(g.geom, p)
  ORDER BY ST_Area(g.geom) ASC, g.plz
$$;--> statement-breakpoint
-- Liegt der Punkt im Gebiet der PLZ? NULL, wenn die PLZ unbekannt ist
-- (der Aufrufer unterscheidet „ausserhalb" von „keine Flaeche vorhanden").
CREATE FUNCTION punkt_in_plz(p_plz text, p geometry) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT ST_Covers(g.geom, p) FROM plz_gebiet g WHERE g.plz = p_plz
$$;
