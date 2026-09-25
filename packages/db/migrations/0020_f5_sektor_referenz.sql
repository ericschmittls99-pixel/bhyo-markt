-- F5 PR B: Sektor als Referenzdaten statt Freitext (Entscheidung Eric,
-- 25.09.2026). Reihenfolge ist wesentlich: Tabelle, Werte, Zuordnung,
-- Zaehlbeweis — und ERST DANN der Fremdschluessel. Umgekehrt wuerde die
-- Migration an Bestandswerten scheitern, die sie gerade zuordnen soll.

CREATE TABLE "sektor" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sortierung" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint

-- Acht Werte. "abnehmer" ist bewusst NICHT dabei: Das ist eine Rolle, keine
-- Branche — und ein Wert, der in einer Auswahlliste etwas anderes bedeutet
-- als alle uebrigen, verdirbt die ganze Liste.
INSERT INTO "sektor" ("code", "label", "sortierung") VALUES
  ('abfallwirtschaft', 'Abfallwirtschaft', 10),
  ('energie',          'Energie',          20),
  ('forstwirtschaft',  'Forstwirtschaft',  30),
  ('holzwirtschaft',   'Holzwirtschaft',   40),
  ('industrie',        'Industrie',        50),
  ('kommunal',         'Kommunal',         60),
  ('landwirtschaft',   'Landwirtschaft',   70),
  ('lebensmittel',     'Lebensmittel',     80);
--> statement-breakpoint

-- Die Rolle sichern, BEVOR das Feld geleert wird. Gemessen am 25.09.2026:
-- `rollen` war bei allen Akteuren leer, `sektor = 'abnehmer'` also der
-- einzige Traeger dieser Angabe. Sie wandert an die richtige Stelle, statt
-- verloren zu gehen.
UPDATE "akteur"
   SET "rollen" = array_append("rollen", 'abnehmer')
 WHERE lower(btrim("sektor")) = 'abnehmer'
   AND NOT ('abnehmer' = ANY("rollen"));
--> statement-breakpoint

-- Zuordnung. Der Vergleich laeuft ohne Ruecksicht auf Gross- und
-- Kleinschreibung und ohne Randleerraum, damit kuenftige Varianten gar nicht
-- erst entstehen ("Energie"/"energie" waren zwei Filterwerte).
--
-- "Entsorgung" und "Entsorgungswirtschaft" gehen auf "abfallwirtschaft":
-- Das ist eine FACHLICHE Zusammenlegung, keine Schreibweise — drei Namen
-- fuer eine Sache.
UPDATE "akteur"
   SET "sektor" = CASE lower(btrim("sektor"))
     WHEN 'abnehmer'              THEN NULL   -- Rolle, kein Sektor
     WHEN 'entsorgung'            THEN 'abfallwirtschaft'
     WHEN 'entsorgungswirtschaft' THEN 'abfallwirtschaft'
     ELSE lower(btrim("sektor"))
   END
 WHERE "sektor" IS NOT NULL;
--> statement-breakpoint

-- Leerstrings sind kein Sektor, sondern eine fehlende Angabe.
UPDATE "akteur" SET "sektor" = NULL WHERE btrim(coalesce("sektor", '')) = '';
--> statement-breakpoint

-- Zaehlbeweis UND Abbruch mit Liste: Taucht ein Wert auf, der in keine
-- Kategorie passt, bricht die Migration ab und nennt ihn — statt ihn still
-- auf "sonstige" zu legen oder am Fremdschluessel zu scheitern, wo die
-- Meldung nichts mehr erklaert.
DO $$
DECLARE
  n_ohne integer;
  n_zugeordnet integer;
  n_rolle integer;
  unbekannt text;
BEGIN
  SELECT string_agg(DISTINCT a.sektor, ', ' ORDER BY a.sektor) INTO unbekannt
    FROM "akteur" a
   WHERE a.sektor IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "sektor" s WHERE s.code = a.sektor);
  IF unbekannt IS NOT NULL THEN
    RAISE EXCEPTION 'Sektorwerte ohne Zuordnung: %. Erst in die Referenzliste aufnehmen oder in der Zuordnung ergaenzen.', unbekannt;
  END IF;

  SELECT count(*) FILTER (WHERE sektor IS NULL),
         count(*) FILTER (WHERE sektor IS NOT NULL),
         count(*) FILTER (WHERE 'abnehmer' = ANY(rollen))
    INTO n_ohne, n_zugeordnet, n_rolle
    FROM "akteur";
  RAISE NOTICE 'SEKTOR ohne=% zugeordnet=% rolle_abnehmer=%', n_ohne, n_zugeordnet, n_rolle;
END $$;
--> statement-breakpoint

-- Jetzt erst der Fremdschluessel: Ab hier kann kein Freitext mehr entstehen.
ALTER TABLE "akteur" ADD CONSTRAINT "akteur_sektor_sektor_code_fk" FOREIGN KEY ("sektor") REFERENCES "public"."sektor"("code") ON DELETE no action ON UPDATE no action;
