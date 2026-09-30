-- E61 (30.09.2026): Reservierte Werte der Sektorliste auch als Bezeichnung
-- per DB geschuetzt, und die Vergleichsform der Bezeichnung als EINE
-- Funktion. Befund aus dem sektor-check (PR #136): btrim() ohne
-- Zeichenliste entfernt nur Leerzeichen — ein Tabulator am Rand ging am
-- Index vorbei; und die Bezeichnungen „Abnehmer" / „ohne Sektor" schuetzte
-- nur die App. Jetzt: sektor_label_norm(label) = lower(btrim(label, Leer/
-- Tab/CR/LF)), IMMUTABLE, Grundlage von Index und CHECK;
-- apps/web/lib/sektor.ts (labelSchluessel) rechnet dieselbe Form.
-- Vorpruefung: Kollisionen unter der neuen Regel und reservierte
-- Bezeichnungen brechen die Migration mit der Liste ab, statt mit einem
-- nackten Constraint-Fehler (gemessen 30.09.2026: Production 8 Sektoren aus
-- 0020, Preview 9 — keine).
CREATE FUNCTION sektor_label_norm(p_label text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT AS $fn$
  SELECT lower(btrim(p_label, E' \t\r\n'))
$fn$;--> statement-breakpoint
DO $$
DECLARE
  liste text;
  n integer;
BEGIN
  SELECT count(*), string_agg(k.norm || ' (' || k.codes || ')', ', ')
    INTO n, liste
    FROM (
      SELECT sektor_label_norm(label) AS norm, string_agg(code, '/' ORDER BY code) AS codes
        FROM sektor GROUP BY 1 HAVING count(*) > 1
    ) k;
  IF n > 0 THEN
    RAISE EXCEPTION 'E61: % Bezeichnung(en) unter der neuen Vergleichsform doppelt: %', n, liste;
  END IF;
  SELECT count(*), string_agg(code, ', ' ORDER BY code)
    INTO n, liste
    FROM sektor WHERE sektor_label_norm(label) IN ('abnehmer', 'ohne sektor');
  IF n > 0 THEN
    RAISE EXCEPTION 'E61: % Sektor(en) mit reservierter Bezeichnung: %', n, liste;
  END IF;
END $$;--> statement-breakpoint
DROP INDEX "sektor_label_lower_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "sektor_label_norm_idx" ON "sektor" USING btree (sektor_label_norm("label"));--> statement-breakpoint
ALTER TABLE "sektor" ADD CONSTRAINT "sektor_label_reserviert_check" CHECK (sektor_label_norm("sektor"."label") not in ('abnehmer', 'ohne sektor'));
