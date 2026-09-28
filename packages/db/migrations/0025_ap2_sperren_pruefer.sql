-- AP2.1 PR b (E42/E44, Expand nach E21): Rolle pruefer, Sperre am Strom
-- (biomassestrom / output_bedarf: gesperrt_von -> benutzer(id), gesperrt_am,
-- CHECK beide NULL oder beide gesetzt) und Tabelle strom_zuweisung (genau
-- ein Elternbezug, typisierte FKs auf benutzer(id), partielle Unique-Indizes
-- je Strom-Typ). Niemand wird automatisch Pruefer; bestehende Zeilen bleiben
-- ungesperrt. Schreibpfade auf die neuen Spalten gibt es erst mit diesem PR.
--
-- ADD VALUE laeuft in derselben Transaktion; der neue Enum-Wert wird hier
-- bewusst nicht verwendet (Postgres verbietet das bis zum Commit).
ALTER TYPE "public"."benutzer_rolle" ADD VALUE 'pruefer';--> statement-breakpoint
CREATE TABLE "strom_zuweisung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"biomassestrom_id" uuid,
	"output_bedarf_id" uuid,
	"nutzer_id" uuid NOT NULL,
	"zugewiesen_von" uuid NOT NULL,
	"zugewiesen_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strom_zuweisung_genau_ein_strom_check" CHECK (num_nonnulls("strom_zuweisung"."biomassestrom_id", "strom_zuweisung"."output_bedarf_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD COLUMN "gesperrt_von" uuid;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD COLUMN "gesperrt_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD COLUMN "gesperrt_von" uuid;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD COLUMN "gesperrt_am" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "strom_zuweisung" ADD CONSTRAINT "strom_zuweisung_biomassestrom_id_biomassestrom_id_fk" FOREIGN KEY ("biomassestrom_id") REFERENCES "public"."biomassestrom"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strom_zuweisung" ADD CONSTRAINT "strom_zuweisung_output_bedarf_id_output_bedarf_id_fk" FOREIGN KEY ("output_bedarf_id") REFERENCES "public"."output_bedarf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strom_zuweisung" ADD CONSTRAINT "strom_zuweisung_nutzer_id_benutzer_id_fk" FOREIGN KEY ("nutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strom_zuweisung" ADD CONSTRAINT "strom_zuweisung_zugewiesen_von_benutzer_id_fk" FOREIGN KEY ("zugewiesen_von") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "strom_zuweisung_biomasse_nutzer_uidx" ON "strom_zuweisung" USING btree ("biomassestrom_id","nutzer_id") WHERE "strom_zuweisung"."biomassestrom_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "strom_zuweisung_output_nutzer_uidx" ON "strom_zuweisung" USING btree ("output_bedarf_id","nutzer_id") WHERE "strom_zuweisung"."output_bedarf_id" is not null;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD CONSTRAINT "biomassestrom_gesperrt_von_benutzer_id_fk" FOREIGN KEY ("gesperrt_von") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD CONSTRAINT "output_bedarf_gesperrt_von_benutzer_id_fk" FOREIGN KEY ("gesperrt_von") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD CONSTRAINT "biomassestrom_sperre_check" CHECK (("biomassestrom"."gesperrt_von" is null) = ("biomassestrom"."gesperrt_am" is null));--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD CONSTRAINT "output_bedarf_sperre_check" CHECK (("output_bedarf"."gesperrt_von" is null) = ("output_bedarf"."gesperrt_am" is null));--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: kein Strom ist nach der Migration gesperrt,
-- keine Zuweisung vorhanden — sonst gilt die Migration nicht als gelungen.
DO $$
DECLARE
  n_gesperrt integer;
  n_zuweisungen integer;
BEGIN
  SELECT (SELECT count(*) FROM biomassestrom WHERE gesperrt_von IS NOT NULL OR gesperrt_am IS NOT NULL)
       + (SELECT count(*) FROM output_bedarf WHERE gesperrt_von IS NOT NULL OR gesperrt_am IS NOT NULL)
    INTO n_gesperrt;
  SELECT count(*) INTO n_zuweisungen FROM strom_zuweisung;
  RAISE NOTICE 'SPERREN gesperrt=% zuweisungen=%', n_gesperrt, n_zuweisungen;
  IF n_gesperrt <> 0 OR n_zuweisungen <> 0 THEN
    RAISE EXCEPTION 'Sperren/Zuweisungen nach Expand nicht leer (gesperrt=%, zuweisungen=%)', n_gesperrt, n_zuweisungen;
  END IF;
END $$;
