-- E34 (25.09.2026): Belegtypen, Rangfolge, Qualitaet — Schritt 1.
-- Handgeschrieben; der drizzle-kit-Entwurf haette den Enum-Typ ueber
-- text fallen lassen und neu angelegt (scheitert an der abhaengigen
-- Funktion, verliert die OID). Stattdessen: RENAME VALUE + ADD VALUE,
-- wie von Eric festgelegt. Der Snapshot 0021 beschreibt den Zielzustand
-- (neue Enum-Werte, neuer Generated-Ausdruck, CHECK) und bleibt unangetastet.
--
-- Reihenfolge ist wesentlich:
--   1. Enum: dokument_link -> dokument, webrecherche anhaengen (Zaehlbeweis)
--   2. Generated-Spalte loesen, alte Funktion (7 Parameter) entfernen
--   3. Neue Funktion qualitaetsstufe(typ, datei_key, link_url) — Spiegel
--      von apps/web/lib/qualitaet.ts, Paritaetstest im Deploy-CI
--   4. Generated-Spalte neu anlegen (Postgres rechnet alle Zeilen neu)
--   5. CHECK Quellenangabe (mit Vorpruefung und Liste statt nacktem Fehler)
--
-- Der gueltig_bis-CHECK der oberen vier Typen kommt BEWUSST NICHT hier,
-- sondern als eigene Migration in Schritt 3, nachdem die Daten nachgetragen
-- sind (Eric in der Anwendung, Preview per Re-Seed). Diese Migration
-- schreibt keinen Fachwert: keine Umwidmung einzelner Belege, kein Datum.
--
-- ACHTUNG Transaktion: drizzle fuehrt alle ausstehenden Migrationen in
-- EINER Transaktion aus. Ein per ADD VALUE angehaengter Enum-Wert darf in
-- derselben Transaktion nicht verwendet werden ("unsafe use of new value").
-- Deshalb vergleicht die Funktion ueber p_typ::text und diese Migration
-- schreibt nirgends 'webrecherche' als Enum-Wert.

-- 1. Enum -------------------------------------------------------------------

-- Zaehlbeweis VOR dem Umbenennen: Anzahl der Dokument/Link-Belege merken.
CREATE TEMP TABLE e34_zaehlung AS
  SELECT count(*)::int AS dokument_link_vorher FROM "beleg" WHERE typ::text = 'dokument_link';
--> statement-breakpoint
ALTER TYPE "public"."beleg_typ" RENAME VALUE 'dokument_link' TO 'dokument';
--> statement-breakpoint
ALTER TYPE "public"."beleg_typ" ADD VALUE 'webrecherche';
--> statement-breakpoint
-- Zaehlbeweis NACH dem Umbenennen: dieselben Zeilen heissen jetzt dokument,
-- dokument_link kommt nicht mehr vor. Abbruch bei jeder Abweichung.
DO $$
DECLARE
  vorher integer;
  nachher integer;
  alt integer;
BEGIN
  SELECT dokument_link_vorher INTO vorher FROM e34_zaehlung;
  SELECT count(*) INTO nachher FROM "beleg" WHERE typ::text = 'dokument';
  SELECT count(*) INTO alt FROM "beleg" WHERE typ::text = 'dokument_link';
  IF vorher <> nachher OR alt <> 0 THEN
    RAISE EXCEPTION 'E34 Enum-Umbenennung: dokument_link vorher=%, dokument nachher=%, dokument_link uebrig=% — Abbruch.', vorher, nachher, alt;
  END IF;
  RAISE NOTICE 'E34 ENUM dokument_link->dokument: % Belege umbenannt, webrecherche angehaengt', nachher;
END $$;
--> statement-breakpoint

-- 2. Alte Ableitung loesen --------------------------------------------------

ALTER TABLE "beleg" DROP COLUMN "qualitaet";
--> statement-breakpoint
DROP FUNCTION qualitaetsstufe(beleg_typ, boolean, text, text, date, jsonb, timestamptz);
--> statement-breakpoint

-- 3. Neue Ableitung (E34) ----------------------------------------------------
-- Nur noch (typ, datei_key, link_url). Vollstaendig / unvollstaendig:
--   betriebsdaten A/B · vertrag A/B · absichtserklaerung B/C · angebot B/C ·
--   gespraech C/C · dokument C/D · webrecherche D/D.
-- "Datei oder Link" bei Betriebsdaten, Angebot, Dokument; "Datei" bei
-- Vertrag und Absichtserklaerung; Gespraech und Webrecherche sind glatt.
-- D ist die Untergrenze — "unbelegt" bleibt dem Strom ohne Beleg (E24).
CREATE FUNCTION qualitaetsstufe(
  p_typ beleg_typ,
  p_datei_key text,
  p_link_url text
) RETURNS qualitaets_stufe
LANGUAGE sql IMMUTABLE AS $fn$
WITH f AS (
  SELECT
    coalesce(btrim(p_datei_key), '') <> '' AS datei,
    (coalesce(btrim(p_datei_key), '') <> '' OR coalesce(btrim(p_link_url), '') <> '') AS datei_oder_link
)
SELECT (CASE p_typ::text
    WHEN 'betriebsdaten'      THEN CASE WHEN datei_oder_link THEN 'A' ELSE 'B' END
    WHEN 'vertrag'            THEN CASE WHEN datei            THEN 'A' ELSE 'B' END
    WHEN 'absichtserklaerung' THEN CASE WHEN datei            THEN 'B' ELSE 'C' END
    WHEN 'angebot'            THEN CASE WHEN datei_oder_link THEN 'B' ELSE 'C' END
    WHEN 'gespraech'          THEN 'C'
    WHEN 'dokument'           THEN CASE WHEN datei_oder_link THEN 'C' ELSE 'D' END
    WHEN 'webrecherche'       THEN 'D'
  END)::qualitaets_stufe
FROM f
$fn$;
--> statement-breakpoint

-- 4. Generated-Spalte neu ---------------------------------------------------
ALTER TABLE "beleg" ADD COLUMN "qualitaet" "qualitaets_stufe" GENERATED ALWAYS AS (qualitaetsstufe(typ, datei_key, link_url)) STORED;
--> statement-breakpoint

-- 5. CHECK Quellenangabe ----------------------------------------------------
-- Vorpruefung mit Liste: Ein Beleg ohne Quellenangabe wuerde den CHECK
-- scheitern lassen — dann soll die Meldung die Belegnummern nennen, statt
-- dass ein nackter Constraint-Fehler erklaert werden muss. Gemessen am
-- 26.09.2026: Preview 0, Production 0 (beleg-abweichung, OHNE_QUELLE).
DO $$
DECLARE
  fehlend text;
BEGIN
  SELECT string_agg(beleg_nr, ', ' ORDER BY beleg_nr) INTO fehlend
    FROM "beleg"
   WHERE btrim(coalesce(metadata ->> 'quellenangabe', '')) = '';
  IF fehlend IS NOT NULL THEN
    RAISE EXCEPTION 'E34 CHECK Quellenangabe: Belege ohne Quellenangabe: %. Erst in der Anwendung nachtragen, dann migrieren.', fehlend;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "beleg" ADD CONSTRAINT "beleg_quellenangabe_check" CHECK (btrim(coalesce("beleg"."metadata" ->> 'quellenangabe', '')) <> '');
--> statement-breakpoint
DROP TABLE e34_zaehlung;
