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

-- Zuordnung. Der Vergleich laeuft ohne Ruecksicht auf Gross- und
-- Kleinschreibung und ohne Randleerraum, damit kuenftige Varianten gar nicht
-- erst entstehen ("Energie"/"energie" waren zwei Filterwerte).
--
-- "Entsorgung" und "Entsorgungswirtschaft" gehen auf "abfallwirtschaft":
-- Das ist eine FACHLICHE Zusammenlegung, keine Schreibweise — drei Namen
-- fuer eine Sache.
--
-- 'abnehmer' wird geleert und NICHT nach "rollen" gerettet: Gemessen am
-- 25.09.2026 liest nichts diese Spalte, und die Rolle ist vollstaendig aus
-- den Stroemen ableitbar (E23) — vier Akteure sind sogar beides zugleich.
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
         count(*) FILTER (WHERE sektor IS NOT NULL)
    INTO n_ohne, n_zugeordnet
    FROM "akteur";
  RAISE NOTICE 'SEKTOR ohne=% zugeordnet=%', n_ohne, n_zugeordnet;
END $$;
--> statement-breakpoint

-- Jetzt erst der Fremdschluessel: Ab hier kann kein Freitext mehr entstehen.
ALTER TABLE "akteur" ADD CONSTRAINT "akteur_sektor_sektor_code_fk" FOREIGN KEY ("sektor") REFERENCES "public"."sektor"("code") ON DELETE no action ON UPDATE no action;
