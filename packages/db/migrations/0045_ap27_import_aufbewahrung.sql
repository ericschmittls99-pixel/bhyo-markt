-- AP2.7 Excel-Import, PR c (E67): Aufbewahrung der Import-Zeilen. Die Zeilen
-- (import_zeile) sind Zwischendaten des Laufs; nach Abschluss werden sie
-- nach import.zeilen_aufbewahrung_tage Tagen durch den taeglichen Job
-- geloescht — die Zaehler und das Protokoll bleiben am Lauf. Parameter mit
-- seinem Verbraucher (lib/jobs/import-aufraeumen.ts) im selben PR. Nur
-- Daten, keine Strukturaenderung.
INSERT INTO parameter_definition (schluessel, bezeichnung, einheit, min, max, beschreibung) VALUES
  ('import.zeilen_aufbewahrung_tage', 'Import-Zeilen aufbewahren', 'tage', 1, 365, 'So viele Tage nach Abschluss eines Import-Laufs werden seine Zeilen (Zwischendaten) gelöscht; Zähler und Protokoll bleiben (E67).');--> statement-breakpoint
INSERT INTO parameter_wert (schluessel, wert, gueltig_ab, begruendung) VALUES
  ('import.zeilen_aufbewahrung_tage', 30, '-infinity', 'Startwert seit Einführung: Entscheidung E67 (AP2.7 PR c)');--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: Parameter aufloesbar (30).
DO $$
DECLARE v integer;
BEGIN
  SELECT parameter_wert('import.zeilen_aufbewahrung_tage', current_date) INTO v;
  IF v <> 30 THEN RAISE EXCEPTION 'PR_IMPORT_AUFBEWAHRUNG: Parameter nicht aufloesbar (%)', v; END IF;
  RAISE NOTICE 'PR_IMPORT_AUFBEWAHRUNG tage=%', v;
END $$;
