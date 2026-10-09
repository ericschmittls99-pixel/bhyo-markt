-- AP2.6 PR d (E71 Punkt 9, D14, Eric 07.10.2026): Aufbewahrung der Inbox-
-- Eintraege, fuer alle Typen: erledigt (und verworfen) → nach 14 Tagen
-- loeschen, gelesen und nicht erledigt → nach 60 Tagen. Zwei Parameter mit
-- Verlauf (E60), ausgefuehrt im taeglichen Job (lib/inbox/aufbewahrung.ts).
-- Zustandsbasierte Hinweise des Jobs (verifikation_*, akteur_verwaist,
-- kontaktperson_loeschpruefung, biomasse_wird_frei) bleiben ausgenommen: ihre
-- Idempotenz-Indizes gelten ueber alle Zustaende — ein geloeschter Eintrag
-- wuerde beim naechsten Lauf als neu entstehen (OFFEN im PR-Text).
INSERT INTO parameter_definition (schluessel, bezeichnung, einheit, min, max, beschreibung) VALUES
  ('inbox.aufbewahrung_erledigt_tage', 'Inbox: erledigte Einträge löschen nach', 'tage', 1, 365, 'So viele Tage nach dem Erledigen (oder Verwerfen) löscht der tägliche Job einen Inbox-Eintrag endgültig (D14). Zustandsbasierte Hinweise des Jobs sind ausgenommen.'),
  ('inbox.aufbewahrung_gelesen_tage', 'Inbox: gelesene, offene Einträge löschen nach', 'tage', 1, 730, 'So viele Tage nach dem Lesen löscht der tägliche Job einen noch offenen Inbox-Eintrag (D14). Ungelesene Einträge bleiben; zustandsbasierte Hinweise des Jobs sind ausgenommen.');--> statement-breakpoint
INSERT INTO parameter_wert (schluessel, wert, gueltig_ab, begruendung) VALUES
  ('inbox.aufbewahrung_erledigt_tage', 14, '-infinity', 'Startwert seit Einführung: Entscheidung Eric 07.10.2026 (E71 Punkt 9, D14)'),
  ('inbox.aufbewahrung_gelesen_tage', 60, '-infinity', 'Startwert seit Einführung: Entscheidung Eric 07.10.2026 (E71 Punkt 9, D14)');--> statement-breakpoint
DO $$
DECLARE e integer; g integer; n_erl integer; n_gel integer;
BEGIN
  SELECT parameter_wert('inbox.aufbewahrung_erledigt_tage', current_date) INTO e;
  SELECT parameter_wert('inbox.aufbewahrung_gelesen_tage', current_date) INTO g;
  IF e <> 14 OR g <> 60 THEN RAISE EXCEPTION 'AP26d: Aufbewahrung nicht aufloesbar (%, %)', e, g; END IF;
  -- Bestand zum Zeitpunkt der Migration (nur gezaehlt, nichts geloescht — das tut der Job).
  SELECT count(*) INTO n_erl FROM inbox_eintrag WHERE zustand IN ('erledigt', 'verworfen');
  SELECT count(*) INTO n_gel FROM inbox_eintrag WHERE zustand = 'offen' AND gelesen_am IS NOT NULL;
  RAISE NOTICE 'AP26d inbox_aufbewahrung: erledigt_tage=% gelesen_tage=% bestand_erledigt=% bestand_gelesen_offen=%', e, g, n_erl, n_gel;
END $$;
