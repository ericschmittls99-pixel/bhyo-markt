ALTER TYPE "public"."inbox_typ" ADD VALUE 'biomasse_wird_frei';--> statement-breakpoint
ALTER TABLE "inbox_eintrag" DROP CONSTRAINT "inbox_eintrag_urheber_check";--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD COLUMN "stufe" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_wird_frei_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","biomassestrom_id","bezugsdatum","stufe") WHERE inbox_typ_text("inbox_eintrag"."typ") = 'biomasse_wird_frei';--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_stufe_check" CHECK ((inbox_typ_text("inbox_eintrag"."typ") = 'biomasse_wird_frei') = ("inbox_eintrag"."stufe" is not null));--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_urheber_check" CHECK (inbox_typ_text("inbox_eintrag"."typ") in ('verifikation_laeuft_ab', 'verifikation_abgelaufen', 'akteur_verwaist', 'kontaktperson_loeschpruefung', 'biomasse_wird_frei') or ("inbox_eintrag"."ausloeser_id" is not null and "inbox_eintrag"."ereignis_id" is not null));--> statement-breakpoint
-- AP2.8 (E70, handgeschrieben ab hier, Snapshot unangetastet): Staffel der
-- Wird-frei-Hinweise. parameter_wert kennt nur ganzzahlige Einzelwerte, keine
-- Liste — die vier Stufen liegen deshalb als vier Schluessel (OFFEN im PR-Text:
-- E70 nennt EINEN Parameter hinweis.wird_frei_stufen_tage = [180, 60, 30, 0]).
INSERT INTO parameter_definition (schluessel, bezeichnung, einheit, min, max, beschreibung) VALUES
  ('hinweis.wird_frei_stufe_1', 'Wird-frei-Hinweis, Stufe 1', 'tage', 0, 730, 'Groesste Stufe der Staffel: so viele Tage vor frei_ab beginnt der erste Hinweis „wird frei" (E70). Resttage ueber dieser Stufe: kein Hinweis.'),
  ('hinweis.wird_frei_stufe_2', 'Wird-frei-Hinweis, Stufe 2', 'tage', 0, 730, 'Zweite Stufe der Staffel (E70).'),
  ('hinweis.wird_frei_stufe_3', 'Wird-frei-Hinweis, Stufe 3', 'tage', 0, 730, 'Dritte Stufe der Staffel (E70).'),
  ('hinweis.wird_frei_stufe_4', 'Wird-frei-Hinweis, Stufe 4', 'tage', 0, 730, 'Kleinste Stufe der Staffel; 0 = „frei seit" ab frei_ab (E70).');--> statement-breakpoint
INSERT INTO parameter_wert (schluessel, wert, gueltig_ab, begruendung) VALUES
  ('hinweis.wird_frei_stufe_1', 180, '-infinity', 'Startwert seit Einführung: Entscheidung E70 (AP2.8)'),
  ('hinweis.wird_frei_stufe_2', 60, '-infinity', 'Startwert seit Einführung: Entscheidung E70 (AP2.8)'),
  ('hinweis.wird_frei_stufe_3', 30, '-infinity', 'Startwert seit Einführung: Entscheidung E70 (AP2.8)'),
  ('hinweis.wird_frei_stufe_4', 0, '-infinity', 'Startwert seit Einführung: Entscheidung E70 (AP2.8)');--> statement-breakpoint
DO $$
DECLARE s1 integer; s4 integer; n_stufe integer;
BEGIN
  SELECT parameter_wert('hinweis.wird_frei_stufe_1', current_date) INTO s1;
  SELECT parameter_wert('hinweis.wird_frei_stufe_4', current_date) INTO s4;
  SELECT count(*) INTO n_stufe FROM inbox_eintrag WHERE stufe IS NOT NULL;
  IF s1 <> 180 OR s4 <> 0 THEN RAISE EXCEPTION 'AP28: Staffel nicht aufloesbar (%, %)', s1, s4; END IF;
  RAISE NOTICE 'AP28 wird_frei: stufe_1=% stufe_4=% eintraege_mit_stufe=%', s1, s4, n_stufe;
END $$;
