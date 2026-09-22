-- Stammdaten-Ergaenzung (Seed-v2-Auftrag Eric, 22.09.2026): vier real
-- existierende Reststoffarten, die der Auftrag explizit benennt und die in
-- der AP1f-Taxonomie bisher fehlten. Upsert wie in 0008 — idempotent, kein
-- Delete. Cluster-Zuordnung: holzige Arten lignozellulosisch, Schlaemme und
-- Gaerreste organisch.
INSERT INTO "materialart" (code, label, cluster) VALUES
  ('altholz_a1_a3', 'Altholz A1–A3', 'lignozellulosische_reststoffe'),
  ('rebholz', 'Rebholz', 'lignozellulosische_reststoffe'),
  ('gaerreste_fest', 'Gärreste (fest)', 'organische_rest_abfallstoffe'),
  ('papierschlamm', 'Papierschlamm', 'organische_rest_abfallstoffe')
ON CONFLICT (code) DO UPDATE SET label = excluded.label, cluster = excluded.cluster;
