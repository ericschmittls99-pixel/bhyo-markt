-- AP2.4 PR a (E62, Expand nach E21): Verifikationsmodell und Rechte.
--
-- 1. Ereignisarten: jeder Statuswechsel mit eigener Art (in_pruefung_gegeben,
--    geprueft, zurueckgegeben, reaktiviert; verworfen bestand), das
--    automatische Ruecksetzen bei fachlicher Aenderung (zurueckgesetzt, mit
--    Feldliste im Text) und die Ablauf-Markierung (als_abgelaufen_markiert,
--    abgelaufen_aufgehoben). status_gesetzt bleibt nur fuer Altbestand.
-- 2. Inbox-Typen pruefauftrag (an alle aktiven Pruefer, gebuendelt je Pruefer
--    und Strom) und pruefung_erledigt (an den Ausloeser).
-- 3. beleg.abgelaufen_am (D3): eine Eingabe des Pruefers, nicht ableitbar,
--    deshalb gespeichert.
-- 4. Qualitaet (E34): qualitaetsstufe() bekommt abgelaufen_am — eine Stufe
--    tiefer (A→B, B→C, C→D, D bleibt D). Die GENERATED-Spalte beleg.qualitaet
--    wird dafuer neu angelegt (abgeleitete Spalte, kein Datenverlust). Der
--    TS-Spiegel deriveQualitaet und die Ankerfaelle aendern sich gemeinsam;
--    scripts/qualitaet-paritaet.ts prueft die Paritaet im CI.
-- 5. strom_verifikation(stichtag): EINE mengenbasierte Funktion fuer Liste,
--    Detail, Filter, Export und Job. Abgeleitet, nichts gespeichert (E23):
--    verifiziert_am = letztes Ereignis geprueft/reverifiziert (nur solange der
--    Strom geprueft ist); verifiziert_bis = gueltig_bis der oberen vier
--    Belegtypen, sonst Kalendertag Berlin von verifiziert_am + Typ-Frist aus
--    parameter_wert() an diesem Tag. Zustaende: ungeprueft · in_pruefung ·
--    gueltig · abgelaufen · als_abgelaufen_markiert · pruefdatum_unbekannt
--    (geprueft ohne Pruefereignis, z. B. Altbestand, oder ohne Beleg — gilt
--    als faellig); laeuft_bald_ab folgt in PR b. Die alte E33-Gesamt-
--    faelligkeit (lib/verifizierung.ts) geht darin auf.
--
-- Reihenfolge: neue Enum-Werte werden in derselben Transaktion nicht als
-- Literal verwendet (Index-Praedikate ueber inbox_typ_text, Funktion ueber
-- ::text-Vergleiche); die Spalte abgelaufen_am entsteht VOR der Funktion,
-- die sie liest.
ALTER TYPE "public"."ereignis_art" ADD VALUE 'in_pruefung_gegeben';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'geprueft';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'zurueckgegeben';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'reaktiviert';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'zurueckgesetzt';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'als_abgelaufen_markiert';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'abgelaufen_aufgehoben';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'pruefauftrag';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'pruefung_erledigt';--> statement-breakpoint
ALTER TABLE "beleg" ADD COLUMN "abgelaufen_am" date;--> statement-breakpoint
ALTER TABLE "beleg" DROP COLUMN "qualitaet";--> statement-breakpoint
DROP FUNCTION qualitaetsstufe(beleg_typ, text, text);--> statement-breakpoint
-- E34-Matrix wie 0021, dazu D3: eine Markierung wertet eine Stufe ab.
-- search_path fest (Restore-Befund 0023).
CREATE FUNCTION qualitaetsstufe(
  p_typ beleg_typ,
  p_datei_key text,
  p_link_url text,
  p_abgelaufen_am date
) RETURNS qualitaets_stufe
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
WITH f AS (
  SELECT
    coalesce(btrim(p_datei_key), '') <> '' AS datei,
    (coalesce(btrim(p_datei_key), '') <> '' OR coalesce(btrim(p_link_url), '') <> '') AS datei_oder_link
), g AS (
  SELECT CASE p_typ::text
    WHEN 'betriebsdaten'      THEN CASE WHEN datei_oder_link THEN 'A' ELSE 'B' END
    WHEN 'vertrag'            THEN CASE WHEN datei            THEN 'A' ELSE 'B' END
    WHEN 'absichtserklaerung' THEN CASE WHEN datei            THEN 'B' ELSE 'C' END
    WHEN 'angebot'            THEN CASE WHEN datei_oder_link THEN 'B' ELSE 'C' END
    WHEN 'gespraech'          THEN 'C'
    WHEN 'dokument'           THEN CASE WHEN datei_oder_link THEN 'C' ELSE 'D' END
    WHEN 'webrecherche'       THEN 'D'
  END AS basis
  FROM f
)
SELECT (CASE
    WHEN p_abgelaufen_am IS NULL THEN basis
    WHEN basis = 'A' THEN 'B'
    WHEN basis = 'B' THEN 'C'
    ELSE 'D'
  END)::qualitaets_stufe
FROM g
$fn$;--> statement-breakpoint
ALTER TABLE "beleg" ADD COLUMN "qualitaet" "qualitaets_stufe" GENERATED ALWAYS AS (qualitaetsstufe(typ, datei_key, link_url, abgelaufen_am)) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_biomasse_pruefauftrag_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","biomassestrom_id") WHERE "inbox_eintrag"."zustand" = 'offen' and inbox_typ_text("inbox_eintrag"."typ") = 'pruefauftrag' and "inbox_eintrag"."biomassestrom_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_output_pruefauftrag_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","output_bedarf_id") WHERE "inbox_eintrag"."zustand" = 'offen' and inbox_typ_text("inbox_eintrag"."typ") = 'pruefauftrag' and "inbox_eintrag"."output_bedarf_id" is not null;--> statement-breakpoint
-- Verifikation, mengenbasiert. STABLE: liest Stroeme, Belege, Protokoll und
-- Parameter. Kein Standardwert: fehlt die Typ-Frist, wirft parameter_wert().
CREATE FUNCTION strom_verifikation(p_stichtag date)
RETURNS TABLE (
  art text,
  strom_id uuid,
  status datensatz_status,
  verifiziert_am timestamptz,
  verifiziert_bis date,
  zustand text
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $fn$
WITH s AS (
  SELECT 'biomasse'::text AS art, 'biomassestrom'::text AS entitaet_typ, b.id, b.status, b.beleg_id
    FROM biomassestrom b
  UNION ALL
  SELECT 'output'::text, 'output_bedarf'::text, o.id, o.status, o.beleg_id
    FROM output_bedarf o
), p AS (
  SELECT a.entitaet_typ, a.entitaet_id, max(a.zeitpunkt) AS verifiziert_am
    FROM aenderung a
   WHERE a.art::text IN ('geprueft', 'reverifiziert')
   GROUP BY a.entitaet_typ, a.entitaet_id
), k AS (
  SELECT s.art, s.id AS strom_id, s.status, bl.typ, bl.gueltig_bis, bl.abgelaufen_am,
         CASE WHEN s.status::text = 'geprueft' THEN p.verifiziert_am END AS verifiziert_am
    FROM s
    LEFT JOIN beleg bl ON bl.id = s.beleg_id
    LEFT JOIN p ON p.entitaet_typ = s.entitaet_typ AND p.entitaet_id = s.id
), v AS (
  SELECT k.*,
    CASE
      WHEN k.status::text <> 'geprueft' OR k.verifiziert_am IS NULL OR k.typ IS NULL THEN NULL
      WHEN k.typ::text IN ('betriebsdaten', 'vertrag', 'absichtserklaerung', 'angebot') THEN k.gueltig_bis
      ELSE ((k.verifiziert_am AT TIME ZONE 'Europe/Berlin')::date
            + make_interval(months => parameter_wert('verifikationsfrist.' || k.typ::text,
                                                      (k.verifiziert_am AT TIME ZONE 'Europe/Berlin')::date)))::date
    END AS verifiziert_bis
  FROM k
)
SELECT v.art, v.strom_id, v.status, v.verifiziert_am, v.verifiziert_bis,
  CASE
    WHEN v.status::text = 'in_pruefung' THEN 'in_pruefung'
    WHEN v.status::text <> 'geprueft' THEN 'ungeprueft'
    WHEN v.abgelaufen_am IS NOT NULL THEN 'als_abgelaufen_markiert'
    WHEN v.verifiziert_am IS NULL OR v.verifiziert_bis IS NULL THEN 'pruefdatum_unbekannt'
    WHEN v.verifiziert_bis < p_stichtag THEN 'abgelaufen'
    ELSE 'gueltig'
  END AS zustand
FROM v
$fn$;
