-- AP2.5 Contract (E66/E57, nach E21): Die alten Kontaktfelder entfallen.
--
-- akteur.rollen, kontakt_email, kontakt_telefon, ansprechperson und
-- biomassestrom/output_bedarf.kontaktperson (Freitext) sind seit PR b (0036)
-- durch die Tabelle kontaktperson abgeloest. Freitext-Namen am Strom wuerden
-- das echte Loeschen (E57) aushebeln, darum fallen die Spalten.
--
-- Messung vor dem DROP: Auf Production sind alle sechs Spalten leer (Leseweg
-- 05.10.2026, Lauf 37276168234: 0 Akteure, akteure_mit_strom_kontaktperson=0);
-- der Vor-DROP-Waechter in migrate-production.yml (pre-drop-check) zaehlt
-- unmittelbar vor diesem Lauf noch einmal und bricht bei einem Wert > 0 ab.
-- Auf der Preview stehen Testtexte (Entscheidung Eric 01.10.2026: Testdaten,
-- werden verworfen) — die Zaehlung hier ist deshalb Protokoll, kein Abbruch.
DO $$
DECLARE
  n_rollen integer; n_mail integer; n_tel integer; n_ansp integer; n_bio integer; n_out integer;
BEGIN
  SELECT count(*) FILTER (WHERE cardinality(rollen) > 0),
         count(*) FILTER (WHERE kontakt_email IS NOT NULL AND btrim(kontakt_email) <> ''),
         count(*) FILTER (WHERE kontakt_telefon IS NOT NULL AND btrim(kontakt_telefon) <> ''),
         count(*) FILTER (WHERE ansprechperson IS NOT NULL AND btrim(ansprechperson) <> '')
    INTO n_rollen, n_mail, n_tel, n_ansp FROM akteur;
  SELECT count(*) INTO n_bio FROM biomassestrom WHERE kontaktperson IS NOT NULL AND btrim(kontaktperson) <> '';
  SELECT count(*) INTO n_out FROM output_bedarf WHERE kontaktperson IS NOT NULL AND btrim(kontaktperson) <> '';
  RAISE NOTICE 'PR_CONTRACT verworfen rollen=% kontakt_email=% kontakt_telefon=% ansprechperson=% biomassestrom_kontaktperson=% output_bedarf_kontaktperson=%',
    n_rollen, n_mail, n_tel, n_ansp, n_bio, n_out;
END $$;--> statement-breakpoint
ALTER TABLE "akteur" DROP COLUMN "rollen";--> statement-breakpoint
ALTER TABLE "akteur" DROP COLUMN "kontakt_email";--> statement-breakpoint
ALTER TABLE "akteur" DROP COLUMN "kontakt_telefon";--> statement-breakpoint
ALTER TABLE "akteur" DROP COLUMN "ansprechperson";--> statement-breakpoint
ALTER TABLE "biomassestrom" DROP COLUMN "kontaktperson";--> statement-breakpoint
ALTER TABLE "output_bedarf" DROP COLUMN "kontaktperson";--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: keine der sechs Spalten existiert mehr, die
-- Tabelle kontaktperson steht.
DO $$
DECLARE
  n_alt integer; n_tab integer;
BEGIN
  SELECT count(*) INTO n_alt FROM information_schema.columns
   WHERE (table_name = 'akteur' AND column_name IN ('rollen', 'kontakt_email', 'kontakt_telefon', 'ansprechperson'))
      OR (table_name IN ('biomassestrom', 'output_bedarf') AND column_name = 'kontaktperson');
  SELECT count(*) INTO n_tab FROM information_schema.tables WHERE table_name = 'kontaktperson';
  RAISE NOTICE 'PR_CONTRACT altspalten=% kontaktperson_tabelle=%', n_alt, n_tab;
  IF n_alt <> 0 OR n_tab <> 1 THEN
    RAISE EXCEPTION 'Contract widerspruechlich (altspalten=%, tabelle=%)', n_alt, n_tab;
  END IF;
END $$;
