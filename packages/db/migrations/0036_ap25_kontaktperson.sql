-- AP2.5 PR b (E66/E57/E47, Expand nach E21): Kontaktpersonen und DSGVO.
--
-- 1. Tabelle kontaktperson: akteur_id NOT NULL — jede Person gehoert zu genau
--    einem Akteur, kein Umhaengen (Trigger kontaktperson_kein_umhaengen weist
--    jede Aenderung von akteur_id ab; wechselt jemand den Arbeitgeber, wird
--    eine neue Person angelegt). name NOT NULL; Laengengrenzen per CHECK
--    (Name 1–200, Funktion 120, Mail 200, Telefon 60, Notiz 1000).
-- 2. Ereignisarten kontaktperson_angelegt/_geaendert/_geloescht — im
--    Freitext stehen nie Namen, nur IDs (E57; protokoll-check prueft das
--    quellentextbasiert, kontaktperson-check in der DB nach dem Loeschen).
-- 3. Inbox-Typ kontaktperson_loeschpruefung mit Objektbezug
--    inbox_eintrag.kontaktperson_id (ON DELETE CASCADE: echtes Loeschen nimmt
--    die Hinweise mit), CHECK „genau ein Objekt" um die Person erweitert,
--    Urheber-CHECK laesst den Job-Hinweis zu, Idempotenz-Index NULLS NOT
--    DISTINCT wie 0033/0035.
-- 4. Parameter kontaktperson.loeschpruefung_monate = 24 (Startwert seit
--    Einfuehrung, E57): nach so vielen Monaten ohne Aktivitaet (Aenderung an
--    der Person oder an einem Beleg ihres Akteurs) erhalten die Admins den
--    Hinweis zur Loeschpruefung. Geloescht wird nur von Hand.
--
-- Der Contract (Spalten rollen, kontakt_email, kontakt_telefon,
-- ansprechperson am Akteur und kontaktperson am Strom) folgt als eigener PR
-- nach der Messung auf Production, dass die Spalten leer sind.
-- Neue Enum-Werte werden in derselben Transaktion nicht als Literal verwendet.
ALTER TYPE "public"."ereignis_art" ADD VALUE 'kontaktperson_angelegt';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'kontaktperson_geaendert';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'kontaktperson_geloescht';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'kontaktperson_loeschpruefung';--> statement-breakpoint
CREATE TABLE "kontaktperson" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"akteur_id" uuid NOT NULL,
	"name" text NOT NULL,
	"funktion" text,
	"mail_dienstlich" text,
	"telefon" text,
	"notiz" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kontaktperson_name_check" CHECK (length(btrim("kontaktperson"."name")) between 1 and 200),
	CONSTRAINT "kontaktperson_funktion_check" CHECK ("kontaktperson"."funktion" is null or length("kontaktperson"."funktion") <= 120),
	CONSTRAINT "kontaktperson_mail_check" CHECK ("kontaktperson"."mail_dienstlich" is null or length("kontaktperson"."mail_dienstlich") <= 200),
	CONSTRAINT "kontaktperson_telefon_check" CHECK ("kontaktperson"."telefon" is null or length("kontaktperson"."telefon") <= 60),
	CONSTRAINT "kontaktperson_notiz_check" CHECK ("kontaktperson"."notiz" is null or length("kontaktperson"."notiz") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "inbox_eintrag" DROP CONSTRAINT "inbox_eintrag_genau_ein_strom_check";--> statement-breakpoint
ALTER TABLE "inbox_eintrag" DROP CONSTRAINT "inbox_eintrag_urheber_check";--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD COLUMN "kontaktperson_id" uuid;--> statement-breakpoint
ALTER TABLE "kontaktperson" ADD CONSTRAINT "kontaktperson_akteur_id_akteur_id_fk" FOREIGN KEY ("akteur_id") REFERENCES "public"."akteur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kontaktperson_akteur_id_idx" ON "kontaktperson" USING btree ("akteur_id");--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_kontaktperson_id_kontaktperson_id_fk" FOREIGN KEY ("kontaktperson_id") REFERENCES "public"."kontaktperson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_kontaktperson_hinweis_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","typ","kontaktperson_id","bezugsdatum") NULLS NOT DISTINCT WHERE inbox_typ_text("inbox_eintrag"."typ") = 'kontaktperson_loeschpruefung' and "inbox_eintrag"."kontaktperson_id" is not null;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_genau_ein_strom_check" CHECK (num_nonnulls("inbox_eintrag"."biomassestrom_id", "inbox_eintrag"."output_bedarf_id", "inbox_eintrag"."akteur_id", "inbox_eintrag"."kontaktperson_id") = 1);--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_urheber_check" CHECK (inbox_typ_text("inbox_eintrag"."typ") in ('verifikation_laeuft_ab', 'verifikation_abgelaufen', 'akteur_verwaist', 'kontaktperson_loeschpruefung') or ("inbox_eintrag"."ausloeser_id" is not null and "inbox_eintrag"."ereignis_id" is not null));--> statement-breakpoint
CREATE FUNCTION kontaktperson_kein_umhaengen() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.akteur_id IS DISTINCT FROM OLD.akteur_id THEN
    RAISE EXCEPTION 'Eine Kontaktperson gehoert zu genau einem Akteur und wird nicht umgehaengt (E66)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
CREATE TRIGGER kontaktperson_kein_umhaengen
  BEFORE UPDATE ON kontaktperson
  FOR EACH ROW EXECUTE FUNCTION kontaktperson_kein_umhaengen();--> statement-breakpoint
INSERT INTO parameter_definition (schluessel, bezeichnung, einheit, min, max, beschreibung) VALUES
  ('kontaktperson.loeschpruefung_monate', 'Löschprüfung', 'monate', 1, 120, 'Nach so vielen Monaten ohne Aktivität (Änderung an der Person oder an einem Beleg ihres Akteurs) erhalten die Admins den Hinweis zur Löschprüfung (E57).');--> statement-breakpoint
INSERT INTO parameter_wert (schluessel, wert, gueltig_ab, begruendung) VALUES
  ('kontaktperson.loeschpruefung_monate', 24, '-infinity', 'Startwert seit Einführung: Entscheidung E57 (AP2.5 PR b)');--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: Tabelle, Trigger, Parameter (24), Index NULLS NOT DISTINCT.
DO $$
DECLARE
  n_tab integer; n_trg integer; v integer; n_idx integer; n_chk integer;
BEGIN
  SELECT count(*) INTO n_tab FROM information_schema.tables WHERE table_name = 'kontaktperson';
  SELECT count(*) INTO n_trg FROM pg_trigger WHERE tgname = 'kontaktperson_kein_umhaengen' AND NOT tgisinternal;
  v := parameter_wert('kontaktperson.loeschpruefung_monate', current_date);
  SELECT count(*) INTO n_idx FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'inbox_eintrag_kontaktperson_hinweis_uidx' AND i.indisunique AND i.indnullsnotdistinct;
  SELECT count(*) INTO n_chk FROM pg_constraint WHERE conrelid = 'kontaktperson'::regclass AND contype = 'c';
  RAISE NOTICE 'PR_B kontaktperson=% trigger=% loeschpruefung_monate=% index=% checks=%', n_tab, n_trg, v, n_idx, n_chk;
  IF n_tab <> 1 OR n_trg <> 1 OR v <> 24 OR n_idx <> 1 OR n_chk <> 5 THEN
    RAISE EXCEPTION 'PR b nach Expand widerspruechlich (tab=%, trg=%, v=%, idx=%, chk=%)', n_tab, n_trg, v, n_idx, n_chk;
  END IF;
END $$;
