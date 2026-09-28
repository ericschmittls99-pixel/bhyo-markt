-- AP2.1 PR b0 (Expand nach E21): stabile Nutzer-ID fuer neue Referenzen —
-- Sperren und Zuweisungen zeigen ab PR b auf benutzer(id), nie auf die
-- E-Mail. Der Primaerschluessel bleibt die E-Mail; bestehende Tabellen und
-- aenderung.benutzer_email bleiben unangetastet. Bestehende Zeilen bekommen
-- ihre ID ueber den DEFAULT im selben Schritt.
ALTER TABLE "benutzer" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "benutzer" ADD CONSTRAINT "benutzer_id_unique" UNIQUE("id");--> statement-breakpoint
-- Zaehlbeweis im selben Lauf (wie 0018/0019): jede Zeile traegt eine ID,
-- keine zwei Zeilen dieselbe — sonst gilt die Migration nicht als gelungen.
DO $$
DECLARE
  n_zeilen integer;
  n_ids integer;
  n_ohne integer;
BEGIN
  SELECT count(*), count(DISTINCT id), count(*) FILTER (WHERE id IS NULL)
    INTO n_zeilen, n_ids, n_ohne FROM "benutzer";
  RAISE NOTICE 'BENUTZER_ID zeilen=% ids=% ohne_id=%', n_zeilen, n_ids, n_ohne;
  IF n_ohne > 0 OR n_ids <> n_zeilen THEN
    RAISE EXCEPTION 'benutzer.id unvollstaendig oder doppelt (zeilen=%, ids=%, ohne=%)', n_zeilen, n_ids, n_ohne;
  END IF;
END $$;
