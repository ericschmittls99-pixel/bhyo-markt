-- AP2.5 PR c (E66): Dubletten und Zusammenfuehren.
--
-- 1. pg_trgm und die Normalisierung akteur_name_norm — dieselbe Form wie
--    apps/web/lib/akteur-norm.ts (Fixtures in src/dubletten-fixtures.ts,
--    Paritaet prueft dubletten-check in der CI): Kleinschreibung, Umlaute
--    (ae/oe/ue/ss), e.K./e.V. als Woerter, alles Nicht-Alphanumerische zu
--    Leerzeichen, Rechtsform-Woerter entfernt (gmbh, mbh, gbr, kg, kgaa, ag,
--    ohg, ug, se, eg, ek, ev, co, haftungsbeschraenkt, ltd, inc), Leerraum
--    zusammengezogen. Die Aehnlichkeit kommt aus pg_trgm (similarity), die
--    Schwellen stehen als Konstanten in der App (akteur-norm.ts, kalibriert
--    laut docs/ap25-dubletten-kalibrierung.md). GIN-Index fuer den
--    %-Operator (Trigramm-Suche „Meinten Sie …?" und Dublettenliste).
-- 2. Tabelle akteur_keine_dublette: ein markiertes Paar (akteur_a < akteur_b,
--    UNIQUE) wird nicht mehr vorgeschlagen; zwei FKs ON DELETE CASCADE.
-- 3. Ereignisarten akteur_zusammengefuehrt (am Quell-Akteur, Text nur IDs:
--    „Quelle <id> → Ziel <id>"), keine_dublette_markiert und
--    keine_dublette_aufgehoben (Markierung aufheben, nur Pruefer/Admin).
--    Rename-Verbot (E53).
-- 4. Trigger kontaktperson_kein_umhaengen (0036) bekommt seine EINZIGE
--    Ausnahme: das Umhaengen auf das Ziel einer Zusammenfuehrung, belegt durch
--    das Ereignis akteur_zusammengefuehrt der Quelle in DERSELBEN Transaktion
--    (zeitpunkt = now(): now() ist die Startzeit der Transaktion). Ohne dieses
--    Ereignis bleibt jedes UPDATE von akteur_id abgewiesen.
--
-- Neue Enum-Werte werden in derselben Transaktion nicht als Literal verwendet
-- (im Trigger nur als Textvergleich art::text, zur Laufzeit ausgewertet).
ALTER TYPE "public"."ereignis_art" ADD VALUE 'akteur_zusammengefuehrt';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'keine_dublette_markiert';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'keine_dublette_aufgehoben';--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE FUNCTION akteur_name_norm(p_name text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE STRICT AS $fn$
DECLARE
  s text := lower(p_name);
  v text;
BEGIN
  s := replace(replace(replace(replace(s, 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss');
  -- e.K. / e.V. als Woerter erkennbar machen, bevor die Punkte fallen.
  s := regexp_replace(s, '\me\.\s?k\.?', ' ek ', 'g');
  s := regexp_replace(s, '\me\.\s?v\.?', ' ev ', 'g');
  s := regexp_replace(s, '[^a-z0-9]+', ' ', 'g');
  -- Abkuerzung SW (Stadtwerke) als eigenes Wort; „Gem." bewusst nicht (gem. GmbH = gemeinnuetzig).
  s := regexp_replace(s, '(^|\s)sw(?=\s|$)', '\1stadtwerke', 'g');
  LOOP
    v := regexp_replace(s, '(^|\s)(gmbh|mbh|gbr|kg|kgaa|ag|ohg|ug|se|eg|ek|ev|co|haftungsbeschraenkt|ltd|inc)(?=\s|$)', ' ', 'g');
    EXIT WHEN v = s;
    s := v;
  END LOOP;
  RETURN btrim(regexp_replace(s, '\s+', ' ', 'g'));
END
$fn$;--> statement-breakpoint
CREATE INDEX "akteur_name_norm_trgm_idx" ON "akteur" USING gin (akteur_name_norm("name") gin_trgm_ops);--> statement-breakpoint
CREATE TABLE "akteur_keine_dublette" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"akteur_a" uuid NOT NULL,
	"akteur_b" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "akteur_keine_dublette_paar_uniq" UNIQUE("akteur_a","akteur_b"),
	CONSTRAINT "akteur_keine_dublette_ordnung_check" CHECK ("akteur_keine_dublette"."akteur_a" < "akteur_keine_dublette"."akteur_b")
);
--> statement-breakpoint
ALTER TABLE "akteur_keine_dublette" ADD CONSTRAINT "akteur_keine_dublette_akteur_a_akteur_id_fk" FOREIGN KEY ("akteur_a") REFERENCES "public"."akteur"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "akteur_keine_dublette" ADD CONSTRAINT "akteur_keine_dublette_akteur_b_akteur_id_fk" FOREIGN KEY ("akteur_b") REFERENCES "public"."akteur"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION kontaktperson_kein_umhaengen() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.akteur_id IS DISTINCT FROM OLD.akteur_id THEN
    -- AP2.5 PR c: einzige Ausnahme ist das Zusammenfuehren — das Ereignis der
    -- Quelle (OLD.akteur_id) nennt das Ziel (NEW.akteur_id) und steht in
    -- derselben Transaktion (zeitpunkt = now()).
    IF NOT EXISTS (
      SELECT 1 FROM aenderung
       WHERE entitaet_typ = 'akteur'
         AND entitaet_id = OLD.akteur_id
         AND art::text = 'akteur_zusammengefuehrt'
         AND text LIKE '%Ziel ' || NEW.akteur_id::text || '%'
         AND zeitpunkt = now()
    ) THEN
      RAISE EXCEPTION 'Eine Kontaktperson gehoert zu genau einem Akteur und wird nicht umgehaengt (E66)' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: Extension, Normalisierung (Beispiel), Index,
-- Tabelle mit zwei FKs, Trigger-Ausnahme im Funktionstext.
DO $$
DECLARE
  n_ext integer; norm text; sim real; n_idx integer; n_fk integer; n_trg integer; n_ausnahme integer;
BEGIN
  SELECT count(*) INTO n_ext FROM pg_extension WHERE extname = 'pg_trgm';
  norm := akteur_name_norm('Müller Agrar GmbH & Co. KG');
  sim := similarity(akteur_name_norm('Biogas Kraichgau GmbH & Co. KG'), akteur_name_norm('Biogas Kraichgau KG'));
  SELECT count(*) INTO n_idx FROM pg_class WHERE relname = 'akteur_name_norm_trgm_idx';
  SELECT count(*) INTO n_fk FROM pg_constraint WHERE conrelid = 'akteur_keine_dublette'::regclass AND contype = 'f' AND confdeltype = 'c';
  SELECT count(*) INTO n_trg FROM pg_trigger WHERE tgname = 'kontaktperson_kein_umhaengen' AND NOT tgisinternal;
  SELECT count(*) INTO n_ausnahme FROM pg_proc WHERE proname = 'kontaktperson_kein_umhaengen' AND prosrc LIKE '%akteur_zusammengefuehrt%';
  RAISE NOTICE 'PR_C pg_trgm=% norm=% sim=% index=% fks=% trigger=% ausnahme=%', n_ext, norm, sim, n_idx, n_fk, n_trg, n_ausnahme;
  IF n_ext <> 1 OR norm <> 'mueller agrar' OR sim <> 1 OR n_idx <> 1 OR n_fk <> 2 OR n_trg <> 1 OR n_ausnahme <> 1 THEN
    RAISE EXCEPTION 'PR c nach Expand widerspruechlich (ext=%, norm=%, sim=%, idx=%, fk=%, trg=%, ausnahme=%)', n_ext, norm, sim, n_idx, n_fk, n_trg, n_ausnahme;
  END IF;
END $$;
