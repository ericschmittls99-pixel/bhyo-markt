-- AP2.5 PR a1 (E66, Expand nach E21): Akteur-Stammdaten — Systemzeile
-- ohne_sektor, Sitz des Akteurs, Verwaist-Hinweis, Rechte-Ereignisse.
--
-- 1. Systemzeile sektor 'ohne_sektor' / „ohne Sektor" (E66 ersetzt E35 „NULL
--    am Akteur"): Der CHECK sektor_code_check verbietet den Code nicht mehr
--    (nur noch 'abnehmer'); stattdessen wacht der Trigger
--    sektor_systemzeile_wache — kein zweiter INSERT dieses Codes, kein
--    Umbenennen/Deaktivieren/Loeschen der Systemzeile, kein Umbenennen eines
--    anderen Codes darauf. Die reservierte Bezeichnung „ohne Sektor" (E61)
--    bleibt fuer alle anderen Zeilen gesperrt (CHECK mit Ausnahme der
--    Systemzeile). Bestehende NULL werden zu 'ohne_sektor' — keine erfundene
--    Fachangabe, NULL hiess laut E35 bereits „ohne Sektor". NOT NULL folgt in
--    a2 (Contract).
-- 2. Sitz des Akteurs (Praezisierung von F0a, Entscheidung Eric 01.10.2026):
--    sitz_strasse, sitz_hausnummer, sitz_plz, sitz_ort, sitz_geom
--    (geometry(Point,4326) — drizzle-kit laesst die SRID weg, hier von Hand).
--    Pflicht fuer PLZ/Ort folgt in a2, nach dem Seed auf der Preview und der
--    Messung auf Production. Der Kreis-ARS kommt ueber den E25-Weg: View
--    akteur_verwaltung (ST_Covers gegen die Kreise), gleiche Form wie
--    strom_verwaltung (0016).
-- 3. Ereignisarten akteur_geaendert, akteur_geloescht; Inbox-Typ
--    akteur_verwaist mit Objektbezug inbox_eintrag.akteur_id (ON DELETE
--    CASCADE: der Hinweis auf einen geloeschten Akteur waere leer), CHECK
--    „genau ein Objekt" um den Akteur erweitert, Urheber-CHECK laesst den
--    Job-Hinweis ohne Urheber zu, Idempotenz-Index (Empfaenger, Typ, Akteur,
--    Bezugsdatum) NULLS NOT DISTINCT wie 0033.
-- 4. Parameter akteur.verwaist_hinweis_monate = 6 (Startwert seit
--    Einfuehrung, E66): nach so vielen Monaten ohne Strom stellt der
--    taegliche Job den Hinweis an alle aktiven Admins zu.
--
-- Neue Enum-Werte werden in derselben Transaktion nicht als Literal
-- verwendet (CHECK/Index ueber inbox_typ_text). Enum-Werte werden nie
-- umbenannt (E53).
ALTER TYPE "public"."ereignis_art" ADD VALUE 'akteur_geaendert';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'akteur_geloescht';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'akteur_verwaist';--> statement-breakpoint
ALTER TABLE "inbox_eintrag" DROP CONSTRAINT "inbox_eintrag_genau_ein_strom_check";--> statement-breakpoint
ALTER TABLE "inbox_eintrag" DROP CONSTRAINT "inbox_eintrag_urheber_check";--> statement-breakpoint
ALTER TABLE "sektor" DROP CONSTRAINT "sektor_code_check";--> statement-breakpoint
ALTER TABLE "sektor" DROP CONSTRAINT "sektor_label_reserviert_check";--> statement-breakpoint
ALTER TABLE "akteur" ADD COLUMN "sitz_strasse" text;--> statement-breakpoint
ALTER TABLE "akteur" ADD COLUMN "sitz_hausnummer" text;--> statement-breakpoint
ALTER TABLE "akteur" ADD COLUMN "sitz_plz" text;--> statement-breakpoint
ALTER TABLE "akteur" ADD COLUMN "sitz_ort" text;--> statement-breakpoint
ALTER TABLE "akteur" ADD COLUMN "sitz_geom" geometry(Point,4326);--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD COLUMN "akteur_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_akteur_id_akteur_id_fk" FOREIGN KEY ("akteur_id") REFERENCES "public"."akteur"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_akteur_hinweis_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","typ","akteur_id","bezugsdatum") NULLS NOT DISTINCT WHERE inbox_typ_text("inbox_eintrag"."typ") = 'akteur_verwaist' and "inbox_eintrag"."akteur_id" is not null;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_genau_ein_strom_check" CHECK (num_nonnulls("inbox_eintrag"."biomassestrom_id", "inbox_eintrag"."output_bedarf_id", "inbox_eintrag"."akteur_id") = 1);--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_urheber_check" CHECK (inbox_typ_text("inbox_eintrag"."typ") in ('verifikation_laeuft_ab', 'verifikation_abgelaufen', 'akteur_verwaist') or ("inbox_eintrag"."ausloeser_id" is not null and "inbox_eintrag"."ereignis_id" is not null));--> statement-breakpoint
ALTER TABLE "sektor" ADD CONSTRAINT "sektor_code_check" CHECK ("sektor"."code" ~ '^[a-z0-9_]+$' and "sektor"."code" <> 'abnehmer');--> statement-breakpoint
ALTER TABLE "sektor" ADD CONSTRAINT "sektor_label_reserviert_check" CHECK (sektor_label_norm("sektor"."label") <> 'abnehmer' and (sektor_label_norm("sektor"."label") <> 'ohne sektor' or "sektor"."code" = 'ohne_sektor'));--> statement-breakpoint
-- 1. Systemzeile anlegen (VOR dem Trigger, der genau das fuer Admins verbietet).
INSERT INTO sektor (code, label, sortierung, aktiv) VALUES ('ohne_sektor', 'ohne Sektor', 9999, true)
  ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
CREATE FUNCTION sektor_systemzeile_wache() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.code = 'ohne_sektor' THEN
      RAISE EXCEPTION 'ohne_sektor ist die Systemzeile und wird nicht angelegt' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.code = 'ohne_sektor' AND (NEW.code IS DISTINCT FROM OLD.code OR NEW.label IS DISTINCT FROM OLD.label OR NEW.aktiv IS DISTINCT FROM OLD.aktiv) THEN
      RAISE EXCEPTION 'Die Systemzeile ohne_sektor wird weder umbenannt noch deaktiviert' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.code = 'ohne_sektor' AND OLD.code <> 'ohne_sektor' THEN
      RAISE EXCEPTION 'ohne_sektor ist der Systemzeile vorbehalten' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.code = 'ohne_sektor' THEN
      RAISE EXCEPTION 'Die Systemzeile ohne_sektor wird nicht geloescht' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END
$fn$;--> statement-breakpoint
CREATE TRIGGER sektor_systemzeile_wache
  BEFORE INSERT OR UPDATE OR DELETE ON sektor
  FOR EACH ROW EXECUTE FUNCTION sektor_systemzeile_wache();--> statement-breakpoint
-- NULL hiess „ohne Sektor" (E35) — jetzt die Systemzeile.
UPDATE akteur SET sektor = 'ohne_sektor' WHERE sektor IS NULL;--> statement-breakpoint
-- 2. Kreis-ARS des Sitzes ueber den E25-Weg (wie strom_verwaltung, 0016).
CREATE VIEW akteur_verwaltung AS
WITH kreis AS (
  SELECT DISTINCT ON (a.id)
         a.id AS akteur_id, k.ars, k.name, k.bez
    FROM akteur a
    LEFT JOIN verwaltungsgebiet k
      ON k.ebene = 'kreis' AND a.sitz_geom IS NOT NULL
     AND ST_Covers(k.geom, a.sitz_geom)
   ORDER BY a.id, k.ars
)
SELECT kreis.akteur_id,
       kreis.ars  AS kreis_ars,
       kreis.name AS kreis_name,
       kreis.bez  AS kreis_bez,
       l.ars      AS land_ars,
       l.name     AS land_name
  FROM kreis
  LEFT JOIN verwaltungsgebiet l
    ON l.ebene = 'land' AND l.ars = left(kreis.ars, 2);--> statement-breakpoint
-- 4. Parameter (mit seinem Verbraucher lib/inbox/hinweise.ts im selben PR).
INSERT INTO parameter_definition (schluessel, bezeichnung, einheit, min, max, beschreibung) VALUES
  ('akteur.verwaist_hinweis_monate', 'Verwaist-Hinweis', 'monate', 1, 120, 'Nach so vielen Monaten ohne Strom erhalten die Admins den Hinweis, dass ein Akteur verwaist ist (E66).');--> statement-breakpoint
INSERT INTO parameter_wert (schluessel, wert, gueltig_ab, begruendung) VALUES
  ('akteur.verwaist_hinweis_monate', 6, '-infinity', 'Startwert seit Einführung: Entscheidung E66 (AP2.5 PR a1)');--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: Systemzeile genau einmal, kein Akteur mit NULL,
-- Trigger und View stehen, Parameter aufloesbar (6), Index NULLS NOT DISTINCT.
DO $$
DECLARE
  n_sys integer; n_null integer; n_trg integer; n_view integer; v integer; n_idx integer;
BEGIN
  SELECT count(*) INTO n_sys FROM sektor WHERE code = 'ohne_sektor' AND label = 'ohne Sektor' AND aktiv;
  SELECT count(*) INTO n_null FROM akteur WHERE sektor IS NULL;
  SELECT count(*) INTO n_trg FROM pg_trigger WHERE tgname = 'sektor_systemzeile_wache' AND NOT tgisinternal;
  SELECT count(*) INTO n_view FROM information_schema.views WHERE table_name = 'akteur_verwaltung';
  v := parameter_wert('akteur.verwaist_hinweis_monate', current_date);
  SELECT count(*) INTO n_idx FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'inbox_eintrag_akteur_hinweis_uidx' AND i.indisunique AND i.indnullsnotdistinct;
  RAISE NOTICE 'PR_A1 systemzeile=% akteur_null=% trigger=% view=% verwaist_monate=% index=%', n_sys, n_null, n_trg, n_view, v, n_idx;
  IF n_sys <> 1 OR n_null <> 0 OR n_trg <> 1 OR n_view <> 1 OR v <> 6 OR n_idx <> 1 THEN
    RAISE EXCEPTION 'PR a1 nach Expand widerspruechlich (sys=%, null=%, trg=%, view=%, v=%, idx=%)', n_sys, n_null, n_trg, n_view, v, n_idx;
  END IF;
END $$;
