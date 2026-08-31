CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TYPE "public"."beleg_typ" AS ENUM('dokument_link', 'gespraech', 'angebot', 'absichtserklaerung', 'vertrag');--> statement-breakpoint
CREATE TYPE "public"."bereitschaft_stufe" AS ENUM('kein_kontakt', 'erstgespraech', 'positives_signal', 'absichtserklaerung');--> statement-breakpoint
CREATE TYPE "public"."datensatz_status" AS ENUM('entwurf', 'in_pruefung', 'geprueft', 'verworfen');