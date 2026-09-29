-- AP2.2 PR c (Expand nach E21): Zugriffsanfrage & Freischaltung. Neue
-- Ereignisarten zugriff_angefragt / zugriff_abgelehnt, neue Inbox-Typen
-- zugriffsanfrage / freischaltung / zugriff_abgelehnt und je Strom-Typ ein
-- partieller Unique-Index (Empfaenger, Strom, Anfragender) WHERE offen AND
-- zugriffsanfrage — zwei Anfragende = zwei Eintraege.
--
-- Der Enum-Wert 'zugriffsanfrage' ist in dieser Transaktion noch nicht als
-- Literal verwendbar, und der nackte Cast typ::text ist fuer ein Index-
-- Praedikat nicht IMMUTABLE. Deshalb die Hilfsfunktion inbox_typ_text
-- (IMMUTABLE — Enum-Labels sind Konstanten dieses Schemas); Index-Praedikat
-- und ON CONFLICT (lib/inbox/zustellung.ts) verwenden dieselbe Form.
CREATE FUNCTION inbox_typ_text(inbox_typ) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT $1::text $$;--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'zugriff_angefragt';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'zugriff_abgelehnt';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'zugriffsanfrage';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'freischaltung';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'zugriff_abgelehnt';--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_biomasse_anfrage_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","biomassestrom_id","ausloeser_id") WHERE "inbox_eintrag"."zustand" = 'offen' and inbox_typ_text("inbox_eintrag"."typ") = 'zugriffsanfrage' and "inbox_eintrag"."biomassestrom_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_output_anfrage_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","output_bedarf_id","ausloeser_id") WHERE "inbox_eintrag"."zustand" = 'offen' and inbox_typ_text("inbox_eintrag"."typ") = 'zugriffsanfrage' and "inbox_eintrag"."output_bedarf_id" is not null;--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: beide Enums um die neuen Werte erweitert (4 bzw.
-- 18 Werte), fuenf Indizes an inbox_eintrag, Hilfsfunktion vorhanden.
DO $$
DECLARE
  n_typ integer;
  n_art integer;
  n_indizes integer;
  n_funktion integer;
BEGIN
  SELECT count(*) INTO n_typ FROM pg_enum WHERE enumtypid = 'inbox_typ'::regtype;
  SELECT count(*) INTO n_art FROM pg_enum WHERE enumtypid = 'ereignis_art'::regtype;
  SELECT count(*) INTO n_indizes FROM pg_indexes
   WHERE tablename = 'inbox_eintrag'
     AND indexname IN ('inbox_eintrag_biomasse_offen_uidx', 'inbox_eintrag_output_offen_uidx', 'inbox_eintrag_zaehler_idx',
                       'inbox_eintrag_biomasse_anfrage_uidx', 'inbox_eintrag_output_anfrage_uidx');
  SELECT count(*) INTO n_funktion FROM pg_proc WHERE proname = 'inbox_typ_text';
  RAISE NOTICE 'ZUGRIFF inbox_typ=% ereignis_art=% indizes=% funktion=%', n_typ, n_art, n_indizes, n_funktion;
  IF n_typ <> 4 OR n_art <> 18 OR n_indizes <> 5 OR n_funktion <> 1 THEN
    RAISE EXCEPTION 'Zugriffsanfrage nach Expand widerspruechlich (inbox_typ=%, ereignis_art=%, indizes=%, funktion=%)', n_typ, n_art, n_indizes, n_funktion;
  END IF;
END $$;
