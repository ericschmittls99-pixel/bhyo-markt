-- AP2.7 Excel-Import, PR c (E67): der CHECK inbox_eintrag_genau_ein_strom_check
-- kannte den Lauf-Bezug (inbox_eintrag.import_lauf_id, Migration 0043) nicht —
-- der erste echte Abschluss eines Laufs auf der Preview scheiterte am Insert
-- des Eintrags import_abgeschlossen (Befund 06.10.2026). Jetzt zaehlt der
-- Lauf als fuenfter Objektbezug; genau einer bleibt Pflicht. Rot-Nachweis im
-- import-check (Eintrag nur mit Lauf-Bezug angenommen, ohne Bezug abgewiesen).
ALTER TABLE "inbox_eintrag" DROP CONSTRAINT "inbox_eintrag_genau_ein_strom_check";--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_genau_ein_strom_check" CHECK (num_nonnulls("inbox_eintrag"."biomassestrom_id", "inbox_eintrag"."output_bedarf_id", "inbox_eintrag"."akteur_id", "inbox_eintrag"."kontaktperson_id", "inbox_eintrag"."import_lauf_id") = 1);