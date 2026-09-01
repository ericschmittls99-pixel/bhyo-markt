CREATE TYPE "public"."lauf_status" AS ENUM('arbeitsfassung', 'eingefroren');--> statement-breakpoint
CREATE TYPE "public"."output_vektor" AS ENUM('waerme', 'h2', 'co2');--> statement-breakpoint
CREATE TYPE "public"."preis_herkunft" AS ENUM('eigene_datenbank', 'marktdaten', 'schaetzung');--> statement-breakpoint
CREATE TYPE "public"."qualitaets_stufe" AS ENUM('A', 'B', 'C', 'D');--> statement-breakpoint
CREATE TABLE "akteur" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sektor" text,
	"rollen" text[] DEFAULT '{}'::text[] NOT NULL,
	"kontakt_email" text,
	"kontakt_telefon" text,
	"ansprechperson" text,
	"status" datensatz_status NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "akteur_interesse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"akteur_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"status" datensatz_status NOT NULL,
	"notiz" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "akteur_interesse_akteur_id_region_id_unique" UNIQUE("akteur_id","region_id")
);
--> statement-breakpoint
CREATE TABLE "analyse_lauf" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid NOT NULL,
	"lauf_id" text NOT NULL,
	"status" "lauf_status" DEFAULT 'arbeitsfassung' NOT NULL,
	"baureihe_gewaehlt" text,
	"eingefroren_am" timestamp with time zone,
	"parametersatz_version" text,
	"rechenkern_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analyse_lauf_lauf_id_unique" UNIQUE("lauf_id")
);
--> statement-breakpoint
CREATE TABLE "beleg" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"typ" "beleg_typ" NOT NULL,
	"datei_key" text,
	"link_url" text,
	"notiz" text,
	"gueltig_bis" date,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biomassestrom" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"akteur_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"materialart_code" text NOT NULL,
	"menge_roh_fm" numeric NOT NULL,
	"ts_anteil_pct" numeric NOT NULL,
	"aschegehalt_pct" numeric NOT NULL,
	"menge_atro" numeric GENERATED ALWAYS AS (menge_roh_fm * ts_anteil_pct / 100 * (1 - aschegehalt_pct / 100)) STORED,
	"zeitraum_von" date NOT NULL,
	"zeitraum_bis" date NOT NULL,
	"saisonalitaet" jsonb NOT NULL,
	"preis_min" numeric,
	"preis_mittel" numeric,
	"preis_max" numeric,
	"preis_herkunft" "preis_herkunft",
	"beleg_id" uuid,
	"qualitaet" "qualitaets_stufe",
	"status" datensatz_status NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entfernung" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lauf_id" uuid NOT NULL,
	"ziel_typ" text NOT NULL,
	"ziel_id" uuid NOT NULL,
	"luftlinie_km" numeric NOT NULL,
	"umwegfaktor" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entfernung_ziel_typ_check" CHECK ("entfernung"."ziel_typ" in ('biomassestrom', 'output_bedarf'))
);
--> statement-breakpoint
CREATE TABLE "lauf_nummernkreis" (
	"jahr" integer PRIMARY KEY NOT NULL,
	"letzte_nummer" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materialart" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "output_bedarf" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"akteur_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"vektor" "output_vektor" NOT NULL,
	"menge_wert" numeric NOT NULL,
	"menge_einheit" text NOT NULL,
	"zeitraum_von" date NOT NULL,
	"zeitraum_bis" date NOT NULL,
	"saisonalitaet" jsonb NOT NULL,
	"beleg_id" uuid,
	"qualitaet" "qualitaets_stufe",
	"status" datensatz_status NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "region" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	-- SRID 4326 (WGS84) von Hand ergaenzt: drizzle-kit 0.31 gibt die SRID trotz
	-- { srid: 4326 } im Schema nicht aus. Ohne SRID akzeptiert die Spalte jede
	-- Projektion und die spaetere Luftlinien-Berechnung waere nicht verlaesslich.
	"standort_geom" geometry(Point,4326) NOT NULL,
	"bereitschaft_stufe" "bereitschaft_stufe" DEFAULT 'kein_kontakt' NOT NULL,
	"bereitschaft_beleg_id" uuid,
	"bereitschaft_notiz" text,
	"bereitschaft_stand" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "akteur_interesse" ADD CONSTRAINT "akteur_interesse_akteur_id_akteur_id_fk" FOREIGN KEY ("akteur_id") REFERENCES "public"."akteur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "akteur_interesse" ADD CONSTRAINT "akteur_interesse_region_id_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."region"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyse_lauf" ADD CONSTRAINT "analyse_lauf_region_id_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."region"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD CONSTRAINT "biomassestrom_akteur_id_akteur_id_fk" FOREIGN KEY ("akteur_id") REFERENCES "public"."akteur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD CONSTRAINT "biomassestrom_region_id_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."region"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD CONSTRAINT "biomassestrom_materialart_code_materialart_code_fk" FOREIGN KEY ("materialart_code") REFERENCES "public"."materialart"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biomassestrom" ADD CONSTRAINT "biomassestrom_beleg_id_beleg_id_fk" FOREIGN KEY ("beleg_id") REFERENCES "public"."beleg"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entfernung" ADD CONSTRAINT "entfernung_lauf_id_analyse_lauf_id_fk" FOREIGN KEY ("lauf_id") REFERENCES "public"."analyse_lauf"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD CONSTRAINT "output_bedarf_akteur_id_akteur_id_fk" FOREIGN KEY ("akteur_id") REFERENCES "public"."akteur"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD CONSTRAINT "output_bedarf_region_id_region_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."region"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD CONSTRAINT "output_bedarf_beleg_id_beleg_id_fk" FOREIGN KEY ("beleg_id") REFERENCES "public"."beleg"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region" ADD CONSTRAINT "region_bereitschaft_beleg_id_beleg_id_fk" FOREIGN KEY ("bereitschaft_beleg_id") REFERENCES "public"."beleg"("id") ON DELETE no action ON UPDATE no action;