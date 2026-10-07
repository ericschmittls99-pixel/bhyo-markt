CREATE TYPE "public"."preis_bezug" AS ENUM('fm', 'atro', 'unbekannt');--> statement-breakpoint
ALTER TABLE "import_lauf" DROP CONSTRAINT "import_lauf_status_check";--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD COLUMN "preis_bezug" "preis_bezug";--> statement-breakpoint
ALTER TABLE "import_lauf" ADD COLUMN "verworfen_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_lauf" ADD COLUMN "preis_bezug_standard" "preis_bezug" DEFAULT 'fm' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_lauf" ADD CONSTRAINT "import_lauf_status_check" CHECK ("import_lauf"."status" in ('angelegt', 'zugeordnet', 'aufgeloest', 'probelauf', 'ausgefuehrt', 'zurueckgenommen', 'verworfen', 'fehler'));--> statement-breakpoint
-- AP2.7 PR g (handgeschrieben ab hier, Snapshot unangetastet).
-- E69 (Eric 07.10.2026): Bestehende Zeilen MIT Preis bekommen den Bezug
-- „unbekannt" (Production hat keine Stroeme, auf der Preview trifft es die
-- Testdaten); Zeilen ohne Preis bleiben ohne Bezug. Zaehlbeweis als NOTICE.
DO $$
DECLARE n_mit_preis int; n_gesetzt int;
BEGIN
  SELECT count(*) INTO n_mit_preis FROM biomassestrom
   WHERE preis_min IS NOT NULL OR preis_mittel IS NOT NULL OR preis_max IS NOT NULL;
  UPDATE biomassestrom SET preis_bezug = 'unbekannt'
   WHERE preis_bezug IS NULL AND (preis_min IS NOT NULL OR preis_mittel IS NOT NULL OR preis_max IS NOT NULL);
  GET DIAGNOSTICS n_gesetzt = ROW_COUNT;
  RAISE NOTICE 'E69 preis_bezug: mit_preis=% auf_unbekannt_gesetzt=%', n_mit_preis, n_gesetzt;
  IF n_gesetzt <> n_mit_preis THEN
    RAISE EXCEPTION 'Abbruch E69: % Stroeme mit Preis, aber % Bezuege gesetzt', n_mit_preis, n_gesetzt;
  END IF;
END $$;--> statement-breakpoint
-- Ist ein Preis gesetzt, ist auch der Bezug gesetzt — dieselbe Regel prueft das Formular vor dem Schreiben.
ALTER TABLE "biomassestrom" ADD CONSTRAINT "biomassestrom_preis_bezug_check"
  CHECK ((preis_min IS NULL AND preis_mittel IS NULL AND preis_max IS NULL) OR preis_bezug IS NOT NULL);--> statement-breakpoint
-- Liegengebliebene Laeufe (Eric 07.10.2026): nie ausgefuehrte Laeufe verwirft
-- der Job nach import.lauf_inaktiv_tage Tagen ohne Aktivitaet (updated_at).
-- Eigener Parameter, nicht import.zeilen_aufbewahrung_tage: dort geht es um
-- Zwischendaten ABGESCHLOSSENER Laeufe, hier um das Ende eines nie
-- abgeschlossenen Laufs — zwei Fristen, die unabhaengig voneinander justiert
-- werden koennen; der Startwert ist derselbe (30 Tage).
INSERT INTO parameter_definition (schluessel, bezeichnung, einheit, min, max, beschreibung) VALUES
  ('import.lauf_inaktiv_tage', 'Import-Lauf ohne Aktivität verwerfen', 'tage', 1, 365, 'So viele Tage nach der letzten Aktivität wird ein nie ausgeführter Import-Lauf vom täglichen Job verworfen: Zeilen gelöscht, Lauf „verworfen", protokolliert.');--> statement-breakpoint
INSERT INTO parameter_wert (schluessel, wert, gueltig_ab, begruendung) VALUES
  ('import.lauf_inaktiv_tage', 30, '-infinity', 'Startwert seit Einführung: Entscheidung Eric 07.10.2026 (AP2.7 PR g)');--> statement-breakpoint
DO $$
DECLARE v integer;
BEGIN
  SELECT parameter_wert('import.lauf_inaktiv_tage', current_date) INTO v;
  IF v <> 30 THEN RAISE EXCEPTION 'PR_G: Parameter import.lauf_inaktiv_tage nicht aufloesbar (%)', v; END IF;
  RAISE NOTICE 'PR_G lauf_inaktiv_tage=%', v;
END $$;
