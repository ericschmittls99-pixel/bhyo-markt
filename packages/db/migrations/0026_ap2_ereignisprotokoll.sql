-- AP2.2 PR a (Expand nach E21): aenderung wird zum Ereignisprotokoll.
-- Neue Spalten art (NOT NULL, ohne DEFAULT — jede neue Zeile nennt ihre Art;
-- Altzeilen = altbestand, weil die Art aus dem Freitext nicht EINDEUTIG
-- ableitbar ist: dieselbe Spalte traegt Code-Texte UND freie Begruendungen)
-- und benutzer_id (FK benutzer(id); Altzeilen per E-Mail-Join ueber die
-- Spalte benutzer_email — der Textpraefix ist seit F8/E30 keine Quelle).
-- Keine neue Tabelle, keine Umbenennung, Freitext und Urheber-E-Mail bleiben.
CREATE TYPE "public"."ereignis_art" AS ENUM('angelegt', 'geaendert', 'status_gesetzt', 'verworfen', 'gesperrt', 'entsperrt', 'zugewiesen', 'zuweisung_entfernt', 'benutzer_angelegt', 'rolle_gesetzt', 'benutzer_aktiviert', 'benutzer_deaktiviert', 'region_angelegt', 'akteur_angelegt', 'projekt_angelegt', 'altbestand');--> statement-breakpoint
ALTER TABLE "aenderung" ADD COLUMN "art" "ereignis_art";--> statement-breakpoint
ALTER TABLE "aenderung" ADD COLUMN "benutzer_id" uuid;--> statement-breakpoint
-- Altzeilen: Art = altbestand, Urheber per E-Mail-Join (benutzer.email ist
-- Primaerschluessel, ein Treffer ist also "genau einer"); sonst NULL.
UPDATE "aenderung" SET "art" = 'altbestand' WHERE "art" IS NULL;--> statement-breakpoint
UPDATE "aenderung" a SET "benutzer_id" = b."id" FROM "benutzer" b WHERE a."benutzer_id" IS NULL AND a."benutzer_email" IS NOT NULL AND b."email" = a."benutzer_email";--> statement-breakpoint
ALTER TABLE "aenderung" ALTER COLUMN "art" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "aenderung" ADD CONSTRAINT "aenderung_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aenderung_entitaet_idx" ON "aenderung" USING btree ("entitaet_typ","entitaet_id");--> statement-breakpoint
ALTER TABLE "aenderung" ADD CONSTRAINT "aenderung_urheber_check" CHECK ("aenderung"."art" = 'altbestand' or "aenderung"."benutzer_id" is not null);--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: jede Zeile hat eine Art (hier: alle
-- altbestand), benutzer_id ist genau bei den Zeilen gesetzt, deren E-Mail
-- einem Benutzer entspricht — sonst gilt die Migration nicht als gelungen.
DO $$
DECLARE
  n_zeilen integer;
  n_ohne_art integer;
  n_altbestand integer;
  n_mit_benutzer integer;
  n_ohne_benutzer integer;
  n_join integer;
  je_art text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE art IS NULL), count(*) FILTER (WHERE art = 'altbestand'),
         count(*) FILTER (WHERE benutzer_id IS NOT NULL), count(*) FILTER (WHERE benutzer_id IS NULL)
    INTO n_zeilen, n_ohne_art, n_altbestand, n_mit_benutzer, n_ohne_benutzer
    FROM aenderung;
  SELECT count(*) INTO n_join FROM aenderung a JOIN benutzer b ON b.email = a.benutzer_email;
  SELECT string_agg(art::text || '=' || n, ' ' ORDER BY art) INTO je_art
    FROM (SELECT art, count(*) AS n FROM aenderung GROUP BY art) t;
  RAISE NOTICE 'PROTOKOLL zeilen=% ohne_art=% je_art=[%] benutzer_id_gesetzt=% null=% email_join=%',
    n_zeilen, n_ohne_art, coalesce(je_art, ''), n_mit_benutzer, n_ohne_benutzer, n_join;
  IF n_ohne_art <> 0 OR n_altbestand <> n_zeilen OR n_mit_benutzer <> n_join THEN
    RAISE EXCEPTION 'Ereignisprotokoll nach Expand widerspruechlich (zeilen=%, ohne_art=%, altbestand=%, benutzer_id=%, join=%)',
      n_zeilen, n_ohne_art, n_altbestand, n_mit_benutzer, n_join;
  END IF;
END $$;
