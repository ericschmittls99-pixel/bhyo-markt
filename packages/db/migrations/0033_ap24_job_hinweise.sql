-- AP2.4 PR b (E63, Expand nach E21): taeglicher Job, Ablauf-Hinweise,
-- erneut verifizieren, Beleg-Pflicht beim Pruefen.
--
-- 1. Ereignisart reverifiziert: neuer Prueftag ohne Statuswechsel —
--    strom_verifikation() zaehlt die Typ-Frist ab dem letzten Ereignis
--    geprueft/reverifiziert (so schon in 0032 angelegt).
-- 2. Inbox-Typen verifikation_laeuft_ab und verifikation_abgelaufen: die
--    zustandsbasierten Hinweise des taeglichen Jobs (lib/inbox/hinweise.ts).
--    Sie haben keinen Urheber und kein Ereignis — ausloeser_id und
--    ereignis_id werden NULL-faehig; der CHECK inbox_eintrag_urheber_check
--    verlangt beides weiterhin fuer jeden anderen Typ. Idempotenz ueber das
--    Bezugsdatum (= verifiziert_bis am Lauftag): je Empfaenger, Typ, Strom
--    und Bezugsdatum genau ein Eintrag, ueber alle Zustaende — ein zweiter
--    Lauf erzeugt nichts, eine neue Verifikation ergibt ein neues
--    Bezugsdatum. NULLS NOT DISTINCT, damit das leere Bezugsdatum
--    (Pruefdatum unbekannt) je Empfaenger und Strom nur einmal zustellt;
--    der Schema-Builder kennt die Klausel nicht, diese Datei ist massgeblich.
-- 3. job_lauf: je Job und Stichtag (Kalendertag Berlin) genau ein Lauf,
--    UNIQUE(job, stichtag) macht den Start idempotent (Cron 03:00 und 04:00
--    UTC, weiter nur um 05:00 Berlin). Die Job-Wache (GitHub, 06:00 Berlin,
--    nur lesend) ist rot, wenn fuer heute kein Lauf mit ergebnis = ok steht.
-- 4. Parameter verifikation.vorlauf_tage = 7 (Startwert seit Einfuehrung,
--    Entscheidung E63): so viele Tage vor verifiziert_bis gilt ein Strom als
--    „laeuft bald ab" und der Job stellt den Hinweis vorab zu.
-- 5. strom_verifikation(stichtag) ersetzt (gleiche Signatur): neuer Zustand
--    ohne_beleg (geprueft ohne Beleg — Altbestand, seit PR b nicht mehr
--    erzeugbar, keine Frist, keine Hinweise; Entscheidung Eric 01.10.2026)
--    und laeuft_bald_ab (verifiziert_bis − Vorlauf ≤ Stichtag ≤
--    verifiziert_bis). Die uebrigen Zustaende unveraendert; „abgelaufen"
--    bleibt ab dem Folgetag von verifiziert_bis (0032, abgenommen).
--
-- Reihenfolge: neue Enum-Werte werden in derselben Transaktion nicht als
-- Literal verwendet (Index-Praedikate und CHECK ueber inbox_typ_text,
-- Funktion ueber ::text-Vergleiche); der Parameter steht VOR der Funktion,
-- die ihn liest.
ALTER TYPE "public"."ereignis_art" ADD VALUE 'reverifiziert';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'verifikation_laeuft_ab';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'verifikation_abgelaufen';--> statement-breakpoint
CREATE TABLE "job_lauf" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"stichtag" date NOT NULL,
	"gestartet_am" timestamp with time zone DEFAULT now() NOT NULL,
	"beendet_am" timestamp with time zone,
	"ergebnis" text DEFAULT 'laeuft' NOT NULL,
	"anzahl" integer,
	"fehler" text,
	CONSTRAINT "job_lauf_job_stichtag_unique" UNIQUE("job","stichtag"),
	CONSTRAINT "job_lauf_ergebnis_check" CHECK ("job_lauf"."ergebnis" in ('laeuft', 'ok', 'fehler'))
);
--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ALTER COLUMN "ausloeser_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ALTER COLUMN "ereignis_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD COLUMN "bezugsdatum" date;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_biomasse_hinweis_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","typ","biomassestrom_id","bezugsdatum") NULLS NOT DISTINCT WHERE inbox_typ_text("inbox_eintrag"."typ") in ('verifikation_laeuft_ab', 'verifikation_abgelaufen') and "inbox_eintrag"."biomassestrom_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_eintrag_output_hinweis_uidx" ON "inbox_eintrag" USING btree ("empfaenger_id","typ","output_bedarf_id","bezugsdatum") NULLS NOT DISTINCT WHERE inbox_typ_text("inbox_eintrag"."typ") in ('verifikation_laeuft_ab', 'verifikation_abgelaufen') and "inbox_eintrag"."output_bedarf_id" is not null;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_urheber_check" CHECK (inbox_typ_text("inbox_eintrag"."typ") in ('verifikation_laeuft_ab', 'verifikation_abgelaufen') or ("inbox_eintrag"."ausloeser_id" is not null and "inbox_eintrag"."ereignis_id" is not null));--> statement-breakpoint
INSERT INTO parameter_definition (schluessel, bezeichnung, einheit, min, max, beschreibung) VALUES
  ('verifikation.vorlauf_tage', 'Vorlauf Ablauf-Hinweis', 'tage', 1, 90, 'So viele Tage vor verifiziert_bis gilt ein geprüfter Strom als „läuft bald ab" und der tägliche Job stellt den Hinweis vorab zu (E63).');--> statement-breakpoint
INSERT INTO parameter_wert (schluessel, wert, gueltig_ab, begruendung) VALUES
  ('verifikation.vorlauf_tage', 7, '-infinity', 'Startwert seit Einführung: Entscheidung E63 (AP2.4 PR b)');--> statement-breakpoint
CREATE OR REPLACE FUNCTION strom_verifikation(p_stichtag date)
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
    WHEN v.typ IS NULL THEN 'ohne_beleg'
    WHEN v.abgelaufen_am IS NOT NULL THEN 'als_abgelaufen_markiert'
    WHEN v.verifiziert_am IS NULL OR v.verifiziert_bis IS NULL THEN 'pruefdatum_unbekannt'
    WHEN v.verifiziert_bis < p_stichtag THEN 'abgelaufen'
    WHEN v.verifiziert_bis - parameter_wert('verifikation.vorlauf_tage', p_stichtag) <= p_stichtag THEN 'laeuft_bald_ab'
    ELSE 'gueltig'
  END AS zustand
FROM v
$fn$;--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: Parameter aufloesbar (7), job_lauf steht, beide
-- Hinweis-Indizes mit NULLS NOT DISTINCT, der Urheber-CHECK, die Funktion
-- liefert nur benannte Zustaende — sonst gilt die Migration nicht als gelungen.
DO $$
DECLARE
  v integer;
  n_tab integer;
  n_idx integer;
  n_chk integer;
  n_fremd integer;
BEGIN
  v := parameter_wert('verifikation.vorlauf_tage', current_date);
  SELECT count(*) INTO n_tab FROM information_schema.tables WHERE table_name = 'job_lauf';
  SELECT count(*) INTO n_idx FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname IN ('inbox_eintrag_biomasse_hinweis_uidx', 'inbox_eintrag_output_hinweis_uidx')
     AND i.indisunique AND i.indnullsnotdistinct;
  SELECT count(*) INTO n_chk FROM pg_constraint WHERE conname = 'inbox_eintrag_urheber_check';
  SELECT count(*) INTO n_fremd FROM strom_verifikation(current_date)
   WHERE zustand NOT IN ('ungeprueft', 'in_pruefung', 'gueltig', 'laeuft_bald_ab', 'abgelaufen', 'als_abgelaufen_markiert', 'pruefdatum_unbekannt', 'ohne_beleg');
  RAISE NOTICE 'PR_B vorlauf=% job_lauf=% hinweis_indizes=% urheber_check=% fremde_zustaende=%', v, n_tab, n_idx, n_chk, n_fremd;
  IF v <> 7 OR n_tab <> 1 OR n_idx <> 2 OR n_chk <> 1 OR n_fremd <> 0 THEN
    RAISE EXCEPTION 'PR b nach Expand widerspruechlich (vorlauf=%, job_lauf=%, indizes=%, check=%, fremd=%)', v, n_tab, n_idx, n_chk, n_fremd;
  END IF;
END $$;
