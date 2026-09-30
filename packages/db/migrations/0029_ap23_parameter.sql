-- AP2.3 PR a (E59/E60, Expand nach E21): Parameter mit Verlauf; erster
-- Verbraucher sind die Verifikationsfristen (E33). Schluessel sind Text
-- (keine Enum-Werte, E53). Ein Wert gilt ab einem Datum, nie rueckwirkend
-- (CHECK gegen den Erfassungstag in Europe/Berlin), bleibt im Verlauf
-- (UPDATE nie), und nur ein kuenftiger Wert laesst sich zuruecknehmen
-- (DELETE nur wenn gueltig_ab > current_date). Gelesen wird ausschliesslich
-- ueber parameter_wert(schluessel, stichtag): Wert der Zeile mit dem
-- groessten gueltig_ab <= stichtag; kein Treffer = Fehler, kein Standardwert.
--
-- Startwerte (gueltig_ab = '-infinity' = „seit Einfuehrung", ohne Urheber):
-- die bisherigen Konstanten aus apps/web/lib/verifizierung.ts, BELEG_MONATE
-- (E33, Entscheidungslog Abschnitt 14; Reservierung: Beschluss 22.09.2026,
-- „derselbe Mechanismus, 12 Monate ab reserviert_seit"):
--   gespraech 3, dokument 6, webrecherche 3, reservierung 12 Monate.
-- Keine erfundenen Werte.
ALTER TYPE "public"."ereignis_art" ADD VALUE 'parameter_gesetzt';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'parameter_zurueckgenommen';--> statement-breakpoint
CREATE TABLE "parameter_definition" (
	"schluessel" text PRIMARY KEY NOT NULL,
	"bezeichnung" text NOT NULL,
	"einheit" text NOT NULL,
	"min" integer NOT NULL,
	"max" integer NOT NULL,
	"beschreibung" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parameter_wert" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schluessel" text NOT NULL,
	"wert" integer NOT NULL,
	"gueltig_ab" date NOT NULL,
	"begruendung" text NOT NULL,
	"erstellt_von" uuid,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parameter_wert_schluessel_gueltig_ab_unique" UNIQUE("schluessel","gueltig_ab"),
	CONSTRAINT "parameter_wert_begruendung_check" CHECK (length(trim("parameter_wert"."begruendung")) > 0),
	CONSTRAINT "parameter_wert_nie_rueckwirkend_check" CHECK ("parameter_wert"."gueltig_ab" = '-infinity'::date or "parameter_wert"."gueltig_ab" >= ("parameter_wert"."erstellt_am" at time zone 'Europe/Berlin')::date),
	CONSTRAINT "parameter_wert_urheber_check" CHECK ("parameter_wert"."gueltig_ab" = '-infinity'::date or "parameter_wert"."erstellt_von" is not null)
);
--> statement-breakpoint
ALTER TABLE "parameter_wert" ADD CONSTRAINT "parameter_wert_schluessel_parameter_definition_schluessel_fk" FOREIGN KEY ("schluessel") REFERENCES "public"."parameter_definition"("schluessel") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parameter_wert" ADD CONSTRAINT "parameter_wert_erstellt_von_benutzer_id_fk" FOREIGN KEY ("erstellt_von") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Lesen: genau eine Stelle. STABLE, weil sie die Tabelle liest.
CREATE FUNCTION parameter_wert(p_schluessel text, p_stichtag date) RETURNS integer
  LANGUAGE plpgsql STABLE STRICT AS $fn$
DECLARE
  v integer;
BEGIN
  SELECT w.wert INTO v
    FROM parameter_wert w
   WHERE w.schluessel = p_schluessel AND w.gueltig_ab <= p_stichtag
   ORDER BY w.gueltig_ab DESC
   LIMIT 1;
  IF v IS NULL THEN
    RAISE EXCEPTION 'Kein Parameterwert fuer % am %', p_schluessel, p_stichtag
      USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v;
END
$fn$;--> statement-breakpoint
-- Unveraenderlichkeit (E60): UPDATE immer abweisen; DELETE nur fuer einen
-- kuenftigen Wert (Zuruecknehmen einer geplanten Aenderung).
CREATE FUNCTION parameter_wert_unveraenderlich() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'parameter_wert ist unveraenderlich — neuen Wert mit gueltig_ab anlegen (E60)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.gueltig_ab > current_date THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'parameter_wert % gilt bereits (ab %) und kann nicht zurueckgenommen werden (E60)', OLD.id, OLD.gueltig_ab
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$fn$;--> statement-breakpoint
CREATE TRIGGER parameter_wert_unveraenderlich
  BEFORE UPDATE OR DELETE ON parameter_wert
  FOR EACH ROW EXECUTE FUNCTION parameter_wert_unveraenderlich();--> statement-breakpoint
-- Wertebereich aus der Definition, auch in der DB (die Anwendung prueft zuerst).
CREATE FUNCTION parameter_wert_bereich() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
DECLARE
  d parameter_definition%ROWTYPE;
BEGIN
  SELECT * INTO d FROM parameter_definition WHERE schluessel = NEW.schluessel;
  IF NEW.wert < d.min OR NEW.wert > d.max THEN
    RAISE EXCEPTION 'Wert % fuer % ausserhalb von % bis % %', NEW.wert, NEW.schluessel, d.min, d.max, d.einheit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
CREATE TRIGGER parameter_wert_bereich
  BEFORE INSERT ON parameter_wert
  FOR EACH ROW EXECUTE FUNCTION parameter_wert_bereich();--> statement-breakpoint
INSERT INTO parameter_definition (schluessel, bezeichnung, einheit, min, max, beschreibung) VALUES
  ('verifikationsfrist.gespraech',    'Gespräch',     'monate', 1, 120, 'Verifikationsfrist eines Belegs vom Typ Gespräch ab Erhebungsdatum (E33).'),
  ('verifikationsfrist.dokument',     'Dokument',     'monate', 1, 120, 'Verifikationsfrist eines Belegs vom Typ Dokument ab Erhebungsdatum (E33).'),
  ('verifikationsfrist.webrecherche', 'Webrecherche', 'monate', 1, 120, 'Verifikationsfrist eines Belegs vom Typ Webrecherche ab Erhebungsdatum (E33).'),
  ('verifikationsfrist.reservierung', 'Reservierung', 'monate', 1, 120, 'Gültigkeit einer bhyo-Reservierung ab reserviert_seit — derselbe Mechanismus wie die Belegfristen (Beschluss 22.09.2026).');--> statement-breakpoint
INSERT INTO parameter_wert (schluessel, wert, gueltig_ab, begruendung) VALUES
  ('verifikationsfrist.gespraech',    3,  '-infinity', 'Startwert seit Einführung: BELEG_MONATE in apps/web/lib/verifizierung.ts (E33)'),
  ('verifikationsfrist.dokument',     6,  '-infinity', 'Startwert seit Einführung: BELEG_MONATE in apps/web/lib/verifizierung.ts (E33)'),
  ('verifikationsfrist.webrecherche', 3,  '-infinity', 'Startwert seit Einführung: BELEG_MONATE in apps/web/lib/verifizierung.ts (E33)'),
  ('verifikationsfrist.reservierung', 12, '-infinity', 'Startwert seit Einführung: BELEG_MONATE.reservierung in apps/web/lib/verifizierung.ts (Beschluss 22.09.2026)');--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: vier Definitionen, vier Startwerte, jeder
-- Schluessel ist heute aufloesbar und liefert den Startwert; Funktion und
-- beide Trigger stehen — sonst gilt die Migration nicht als gelungen.
DO $$
DECLARE
  n_def integer;
  n_wert integer;
  n_trigger integer;
  g integer; d integer; w integer; r integer;
BEGIN
  SELECT count(*) INTO n_def FROM parameter_definition;
  SELECT count(*) INTO n_wert FROM parameter_wert WHERE gueltig_ab = '-infinity';
  SELECT count(*) INTO n_trigger FROM pg_trigger WHERE tgrelid = 'parameter_wert'::regclass AND NOT tgisinternal;
  g := parameter_wert('verifikationsfrist.gespraech', current_date);
  d := parameter_wert('verifikationsfrist.dokument', current_date);
  w := parameter_wert('verifikationsfrist.webrecherche', current_date);
  r := parameter_wert('verifikationsfrist.reservierung', current_date);
  RAISE NOTICE 'PARAMETER definitionen=% startwerte=% trigger=% gespraech=% dokument=% webrecherche=% reservierung=%', n_def, n_wert, n_trigger, g, d, w, r;
  IF n_def <> 4 OR n_wert <> 4 OR n_trigger <> 2 OR g <> 3 OR d <> 6 OR w <> 3 OR r <> 12 THEN
    RAISE EXCEPTION 'Parameter nach Expand widerspruechlich (def=%, startwerte=%, trigger=%, %/%/%/%)', n_def, n_wert, n_trigger, g, d, w, r;
  END IF;
END $$;
