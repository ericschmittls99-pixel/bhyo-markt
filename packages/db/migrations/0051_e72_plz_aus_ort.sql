-- E72 (AP2.7h „PLZ aus Ort", Eric 08.10.2026): Ortsteil-Toleranz und
-- PLZ-Kandidaten zu einem Ort ohne PLZ. Eine Regel, ein Ursprung: die
-- Passt-Regel steht einmal auf Normalformen (plz_ort_norm_passt); die
-- bisherige plz_ort_passt wird zur Huelle, die die Eingabe normalisiert.
-- Spiegel in TypeScript: ortNormPasst / ortPasst (@bhyo/db/plz), Paritaet
-- prueft plz-check.ts in der CI.
--
-- 1. Passt-Regel auf Normalformen. Drei Faelle:
--    a) gleich                      „speyer"           = „speyer"
--    b) Kurzform (Wortpraefix)      „ludwigshafen"     -> „ludwigshafen am rhein"
--    c) Ortsteil (E72 e): die Eingabe beginnt mit dem amtlichen Ort, gefolgt
--       von einem Wortende — „Mannheim-Neckarau" und „Stuttgart Vaihingen"
--       werden in der Normalform zu „mannheim neckarau" / „stuttgart vaihingen"
--       und passen zu „mannheim" / „stuttgart". „Mannheimer Str." passt
--       nicht (kein Wortende nach „mannheim"). Der Ort bleibt, wie er
--       eingegeben wurde; es gibt keine Meldung.
CREATE FUNCTION plz_ort_norm_passt(p_norm text, p_ort_norm text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT p_norm <> '' AND p_ort_norm <> ''
     AND (p_ort_norm = p_norm
          OR p_ort_norm LIKE replace(replace(p_norm, '\', '\\'), '%', '\%') || ' %'
          OR p_norm LIKE replace(replace(p_ort_norm, '\', '\\'), '%', '\%') || ' %')
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION plz_ort_passt(p_eingabe text, p_ort_norm text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT plz_ort_norm_passt(plz_ort_norm(p_eingabe), p_ort_norm)
$$;--> statement-breakpoint
-- 2. PLZ-Kandidaten zu einem Ort ohne PLZ (E72 a/b): alle (PLZ, Gemeinde),
--    deren Gemeindename zur Eingabe passt (dieselbe Regel wie oben, die
--    Eingabe wird EINMAL normalisiert). Kreis und Land kommen ueber den ARS
--    (Gemeinde-ARS 12-stellig: Land = 2, Kreis = 5 Stellen) aus
--    verwaltungsgebiet — NULL, wenn die VG250-Ebenen nicht importiert sind.
--    Genau eine Zeile heisst: PLZ eindeutig; mehrere: der Mensch waehlt in
--    der Nacharbeit; keine: Ort unbekannt. Reihenfolge deterministisch.
CREATE FUNCTION plz_fuer_ort(p_ort text)
RETURNS TABLE (plz text, ort text, ars text, kreis text, land text)
LANGUAGE sql STABLE AS $$
  WITH n AS (SELECT plz_ort_norm(p_ort) AS norm)
  SELECT o.plz, o.ort, o.ars,
         (SELECT k.bez || ' ' || k.name FROM verwaltungsgebiet k WHERE k.ebene = 'kreis' AND k.ars = left(o.ars, 5)),
         (SELECT l.name FROM verwaltungsgebiet l WHERE l.ebene = 'land' AND l.ars = left(o.ars, 2))
  FROM plz_ort o, n
  WHERE plz_ort_norm_passt(n.norm, o.ort_norm)
  ORDER BY o.ort, o.ars, o.plz
$$;
