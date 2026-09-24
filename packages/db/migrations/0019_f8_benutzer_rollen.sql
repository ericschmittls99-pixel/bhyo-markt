CREATE TYPE "public"."benutzer_rolle" AS ENUM('betrachter', 'bearbeiter', 'admin');--> statement-breakpoint
CREATE TABLE "benutzer" (
	"email" text PRIMARY KEY NOT NULL,
	"rolle" "benutzer_rolle" NOT NULL,
	"name" text,
	"aktiv" boolean DEFAULT true NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benutzer_email_lower_check" CHECK ("benutzer"."email" = lower("benutzer"."email"))
);
--> statement-breakpoint
ALTER TABLE "aenderung" ADD COLUMN "benutzer_email" text;--> statement-breakpoint
-- E30: Erster Admin. Ohne diese Zeile ist das Paket NICHT BENUTZBAR: Die
-- Durchsetzung in PR B ist fail closed, ein leeres `benutzer` sperrt damit
-- alle aus — auch die Person, die Rollen vergeben muesste. Die Adresse ist
-- die verifizierte Access-Identitaet (aus /api/me auf Production gelesen,
-- nicht geraten): eine andere Schreibweise oder Domain wuerde genau die
-- Aussperrung ausloesen, die hier verhindert werden soll.
-- Idempotent, damit ein erneuter Lauf eine spaeter geaenderte Rolle NICHT
-- zurueckdreht.
INSERT INTO "benutzer" ("email", "rolle", "name")
VALUES ('eric.schmitt@bhyo.de', 'admin', 'Eric Schmitt')
ON CONFLICT ("email") DO NOTHING;
--> statement-breakpoint
-- Zaehlbeweis im selben Lauf (wie 0018): Ohne mindestens einen aktiven Admin
-- darf die Migration nicht als erfolgreich gelten — ein fail-closed-Zugang
-- ohne Admin ist ein gesperrtes System.
DO $$
DECLARE
  n_admins integer;
  n_klein integer;
BEGIN
  SELECT count(*) INTO n_admins FROM "benutzer" WHERE rolle = 'admin' AND aktiv;
  SELECT count(*) INTO n_klein FROM "benutzer" WHERE email <> lower(email);
  RAISE NOTICE 'BENUTZER aktive_admins=% abweichende_schreibweise=%', n_admins, n_klein;
  IF n_admins < 1 THEN
    RAISE EXCEPTION 'Kein aktiver Admin nach der Migration — Zugang waere gesperrt.';
  END IF;
  IF n_klein > 0 THEN
    RAISE EXCEPTION '% E-Mail(s) nicht in Kleinschreibung', n_klein;
  END IF;
END $$;
