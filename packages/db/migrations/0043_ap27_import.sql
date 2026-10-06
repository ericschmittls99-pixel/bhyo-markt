-- AP2.7 Excel-Import, PR a (E67, Eric 06.10.2026): Datenmodell des Imports.
-- Drei Tabellen (import_vorlage, import_lauf, import_zeile), Lauf-ID an jedem
-- Protokoll-Ereignis (aenderung.import_lauf_id) und am Inbox-Eintrag
-- (inbox_eintrag.import_lauf_id, genau ein Eintrag je Lauf und Empfaenger),
-- zwei neue Enum-Werte unter Rename-Verbot (E53): ereignis_art
-- kontaktdaten_uebersprungen, inbox_typ import_abgeschlossen (Praedikat des
-- Index ueber inbox_typ_text, weil ein neuer Enum-Wert in derselben
-- Transaktion nicht als Literal verwendbar ist).
-- DSGVO (E67): import_zeile.felder traegt nur zugeordnete Zielfelder; der
-- CHECK import_zeile_felder_check weist Personen-Schluessel ab — die
-- Datenbank-Zusicherung zu „Personen-Inhalte werden nie gespeichert".
-- Alles additiv, mit Verbraucher (lib/import-actions.ts, lib/protokoll).
-- Nummer 0043: 0042 ist die Job-Laufzeitmessung (#181).
ALTER TYPE "public"."ereignis_art" ADD VALUE 'kontaktdaten_uebersprungen';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'import_abgeschlossen';--> statement-breakpoint
CREATE TABLE "import_lauf" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"art" text NOT NULL,
	"dateiname" text NOT NULL,
	"datei_hash" text NOT NULL,
	"beleg_typ" "beleg_typ" NOT NULL,
	"standard_sektor" text NOT NULL,
	"vorlage_id" uuid,
	"ersteller_id" uuid NOT NULL,
	"status" text DEFAULT 'angelegt' NOT NULL,
	"zaehler" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"abgeschlossen_am" timestamp with time zone,
	"zurueckgenommen_am" timestamp with time zone,
	CONSTRAINT "import_lauf_art_check" CHECK ("import_lauf"."art" in ('biomasse', 'output')),
	CONSTRAINT "import_lauf_status_check" CHECK ("import_lauf"."status" in ('angelegt', 'zugeordnet', 'aufgeloest', 'probelauf', 'ausgefuehrt', 'zurueckgenommen', 'fehler')),
	CONSTRAINT "import_lauf_datei_hash_check" CHECK ("import_lauf"."datei_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "import_lauf_dateiname_check" CHECK (length(btrim("import_lauf"."dateiname")) between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "import_vorlage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"quelle" text,
	"spalten" jsonb NOT NULL,
	"werte" jsonb NOT NULL,
	"ersteller_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_vorlage_name_unique" UNIQUE("name"),
	CONSTRAINT "import_vorlage_name_check" CHECK (length(btrim("import_vorlage"."name")) between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "import_zeile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lauf_id" uuid NOT NULL,
	"zeilennummer" integer NOT NULL,
	"felder" jsonb NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"fehlergrund" text,
	"biomassestrom_id" uuid,
	"output_bedarf_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_zeile_lauf_zeile_unique" UNIQUE("lauf_id","zeilennummer"),
	CONSTRAINT "import_zeile_status_check" CHECK ("import_zeile"."status" in ('offen', 'fehler', 'aehnlich', 'importiert', 'uebersprungen')),
	CONSTRAINT "import_zeile_strom_check" CHECK (not ("import_zeile"."biomassestrom_id" is not null and "import_zeile"."output_bedarf_id" is not null)),
	CONSTRAINT "import_zeile_felder_check" CHECK (jsonb_typeof("import_zeile"."felder") = 'object' and not ("import_zeile"."felder" ?| array['ansprechpartner', 'ansprechperson', 'kontakt', 'kontaktperson', 'person', 'email', 'e_mail', 'mail', 'telefon', 'mobil', 'handy', 'fax']))
);
--> statement-breakpoint
ALTER TABLE "aenderung" ADD COLUMN "import_lauf_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD COLUMN "import_lauf_id" uuid;--> statement-breakpoint
ALTER TABLE "import_lauf" ADD CONSTRAINT "import_lauf_standard_sektor_sektor_code_fk" FOREIGN KEY ("standard_sektor") REFERENCES "public"."sektor"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_lauf" ADD CONSTRAINT "import_lauf_vorlage_id_import_vorlage_id_fk" FOREIGN KEY ("vorlage_id") REFERENCES "public"."import_vorlage"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_lauf" ADD CONSTRAINT "import_lauf_ersteller_id_benutzer_id_fk" FOREIGN KEY ("ersteller_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_vorlage" ADD CONSTRAINT "import_vorlage_ersteller_id_benutzer_id_fk" FOREIGN KEY ("ersteller_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_zeile" ADD CONSTRAINT "import_zeile_lauf_id_import_lauf_id_fk" FOREIGN KEY ("lauf_id") REFERENCES "public"."import_lauf"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_zeile" ADD CONSTRAINT "import_zeile_biomassestrom_id_biomassestrom_id_fk" FOREIGN KEY ("biomassestrom_id") REFERENCES "public"."biomassestrom"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_zeile" ADD CONSTRAINT "import_zeile_output_bedarf_id_output_bedarf_id_fk" FOREIGN KEY ("output_bedarf_id") REFERENCES "public"."output_bedarf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_lauf_datei_hash_idx" ON "import_lauf" USING btree ("datei_hash");--> statement-breakpoint
CREATE INDEX "import_zeile_status_idx" ON "import_zeile" USING btree ("lauf_id","status");--> statement-breakpoint
ALTER TABLE "aenderung" ADD CONSTRAINT "aenderung_import_lauf_id_import_lauf_id_fk" FOREIGN KEY ("import_lauf_id") REFERENCES "public"."import_lauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_import_lauf_id_import_lauf_id_fk" FOREIGN KEY ("import_lauf_id") REFERENCES "public"."import_lauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aenderung_import_lauf_idx" ON "aenderung" USING btree ("import_lauf_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_import_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","typ","import_lauf_id") WHERE inbox_typ_text("inbox_eintrag"."typ") = 'import_abgeschlossen' and "inbox_eintrag"."import_lauf_id" is not null;
--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: Struktur vorhanden, noch kein Lauf.
DO $$
DECLARE
  n_tab integer; n_enum integer; n_spalten integer; n_idx integer; n_laeufe integer;
BEGIN
  SELECT count(*) INTO n_tab FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name IN ('import_vorlage', 'import_lauf', 'import_zeile');
  SELECT count(*) INTO n_enum FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE (t.typname = 'ereignis_art' AND e.enumlabel = 'kontaktdaten_uebersprungen')
      OR (t.typname = 'inbox_typ' AND e.enumlabel = 'import_abgeschlossen');
  SELECT count(*) INTO n_spalten FROM information_schema.columns
   WHERE table_name IN ('aenderung', 'inbox_eintrag') AND column_name = 'import_lauf_id';
  SELECT count(*) INTO n_idx FROM pg_indexes WHERE indexname = 'inbox_eintrag_import_uidx';
  SELECT count(*) INTO n_laeufe FROM import_lauf;
  RAISE NOTICE 'PR_IMPORT tabellen=% enum_werte=% lauf_id_spalten=% index=% laeufe=%', n_tab, n_enum, n_spalten, n_idx, n_laeufe;
  IF n_tab <> 3 OR n_enum <> 2 OR n_spalten <> 2 OR n_idx <> 1 THEN
    RAISE EXCEPTION 'Import-Datenmodell unvollstaendig (tabellen=%, enum=%, spalten=%, index=%)', n_tab, n_enum, n_spalten, n_idx;
  END IF;
END $$;
