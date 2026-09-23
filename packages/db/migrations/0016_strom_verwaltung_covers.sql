-- F0b-Review (Eric, 23.09.2026): strom_verwaltung mit ST_Covers statt
-- ST_Contains — ein Punkt exakt AUF einer Grenze wird zugeordnet statt
-- "ausserhalb" zu fallen. Gegen Doppelzeilen bei ueberlappenden Polygonen
-- (gemeinsame Grenzpunkte treffen zwei Gebiete) sichert DISTINCT ON
-- (strom_id) ORDER BY ars: je Strom hoechstens eine Zeile, deterministisch
-- der kleinste Kreis-ARS. Das Land kommt aus dem PRAEFIX des Kreis-ARS
-- (left(kreis_ars, 2)), nur der Name per Join auf ebene='land' — keine
-- zweite raeumliche Abfrage. Eigene Migration statt Edit an 0015: die ist
-- auf der Preview bereits angewendet (Leitplanke "nie nachtraeglich
-- editieren"). Handgeschrieben, Snapshot unangetastet.
CREATE OR REPLACE VIEW strom_verwaltung AS
WITH strom AS (
  SELECT id AS strom_id, 'biomasse' AS art, standort_geom FROM biomassestrom
  UNION ALL
  SELECT id, 'output', standort_geom FROM output_bedarf
), kreis AS (
  SELECT DISTINCT ON (s.strom_id)
         s.strom_id, s.art, k.ars, k.name, k.bez
  FROM strom s
  LEFT JOIN verwaltungsgebiet k
    ON k.ebene = 'kreis' AND s.standort_geom IS NOT NULL
   AND ST_Covers(k.geom, s.standort_geom)
  ORDER BY s.strom_id, k.ars
)
SELECT kreis.strom_id,
       kreis.art,
       kreis.ars  AS kreis_ars,
       kreis.name AS kreis_name,
       kreis.bez  AS kreis_bez,
       l.ars      AS land_ars,
       l.name     AS land_name
FROM kreis
LEFT JOIN verwaltungsgebiet l
  ON l.ebene = 'land' AND l.ars = left(kreis.ars, 2);
