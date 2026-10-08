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
-- Wortpraefixe einer Normalform: „mannheim neckarau" -> {mannheim, mannheim neckarau}.
-- Damit wird die Ortsteil-Bedingung („Eingabe beginnt mit dem amtlichen Ort
-- und einem Wortende") zu `ort_norm = ANY(praefixe)` — indexfaehig ueber
-- plz_ort_norm_idx. Spiegel: ortNormPraefixe().
CREATE FUNCTION plz_ort_norm_praefixe(p_norm text) RETURNS text[]
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(array_to_string(w[1:i], ' ') ORDER BY i), '{}')
  FROM regexp_split_to_array(p_norm, ' ') AS w, generate_series(1, array_length(w, 1)) AS i
  WHERE p_norm <> ''
$$;--> statement-breakpoint
-- Passt-Regel auf Normalformen, in indexfaehiger Form (Messung 08.10.2026:
-- die erste Fassung normalisierte die Eingabe je plz_ort-Zeile neu, Seq Scan,
-- 200 Orte 6,5 s). a) gleich und c) Ortsteil: ort_norm ist eines der
-- Wortpraefixe der Eingabe; b) Kurzform: ort_norm beginnt mit Eingabe + Leer-
-- zeichen — als Bereich [n||' ', n||'!') ueber die text_pattern_ops-Operatoren
-- (ort_norm enthaelt nur a-z, 0-9 und Leerzeichen; '!' ist das Zeichen nach
-- dem Leerzeichen). Beide Teile nutzen Indizes auf plz_ort(ort_norm).
-- NICHT STRICT: Postgres inlined eine STRICT-SQL-Funktion nur, wenn ihr Koerper
-- selbst strikt ist — AND/OR sind es nicht. Ohne Inlining blieb der Aufruf je
-- Zeile stehen (Seq Scan, Lauf 37802875636: 200 Orte 29 s). NULL und Leer
-- verhalten sich wie die STRICT-Fassung aus 0048: ein NULL-Argument ergibt
-- NULL, ein leerer Text false — dafuer die beiden „OR … IS NULL"-Glieder
-- (sonst wuerde NULL AND false zu false). Nachweis: plz-check, Fall
-- „E72 NULL/Leer wie 0048".
CREATE FUNCTION plz_ort_norm_passt(p_norm text, p_ort_norm text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (p_norm <> '' OR p_ort_norm IS NULL) AND (p_ort_norm <> '' OR p_norm IS NULL)
     AND (p_ort_norm = ANY (plz_ort_norm_praefixe(p_norm))
          OR (p_ort_norm ~>=~ (p_norm || ' ') AND p_ort_norm ~<~ (p_norm || '!')))
$$;--> statement-breakpoint
-- CREATE OR REPLACE kann STRICT nicht abstreifen — deshalb DROP + CREATE
-- (0048 legte sie STRICT an; plz_pruefung ruft sie nur per Namen, bleibt gueltig).
DROP FUNCTION plz_ort_passt(text, text);--> statement-breakpoint
CREATE FUNCTION plz_ort_passt(p_eingabe text, p_ort_norm text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT plz_ort_norm_passt(plz_ort_norm(p_eingabe), p_ort_norm)
$$;--> statement-breakpoint
-- Bereichssuche der Kurzform ueber die Muster-Operatoren braucht einen Index
-- mit text_pattern_ops (der vorhandene plz_ort_norm_idx traegt die
-- Gleichheit/ANY). Von Hand wie plz_ort_norm_idx in 0048 (nicht im Drizzle-Schema).
CREATE INDEX "plz_ort_norm_muster_idx" ON "plz_ort" ("ort_norm" text_pattern_ops);--> statement-breakpoint
-- 2. PLZ-Kandidaten zu einem Ort ohne PLZ (E72 a/b): alle (PLZ, Gemeinde),
--    deren Gemeindename zur Eingabe passt (dieselbe Regel wie oben; die
--    Normalisierung der Eingabe steht in den Index-Bedingungen und wird je
--    Aufruf, nicht je Zeile berechnet). Kreis und Land kommen ueber den ARS
--    (Gemeinde-ARS 12-stellig: Land = 2, Kreis = 5 Stellen) aus
--    verwaltungsgebiet — NULL, wenn die VG250-Ebenen nicht importiert sind.
--    Genau eine Zeile heisst: PLZ eindeutig; mehrere: der Mensch waehlt in
--    der Nacharbeit; keine: Ort unbekannt. Reihenfolge deterministisch.
CREATE FUNCTION plz_fuer_ort(p_ort text)
RETURNS TABLE (plz text, ort text, ars text, kreis text, land text)
LANGUAGE sql STABLE AS $$
  SELECT o.plz, o.ort, o.ars,
         (SELECT k.bez || ' ' || k.name FROM verwaltungsgebiet k WHERE k.ebene = 'kreis' AND k.ars = left(o.ars, 5)),
         (SELECT l.name FROM verwaltungsgebiet l WHERE l.ebene = 'land' AND l.ars = left(o.ars, 2))
  FROM plz_ort o
  WHERE plz_ort_norm_passt(plz_ort_norm(p_ort), o.ort_norm)
  ORDER BY o.ort, o.ars, o.plz
$$;
