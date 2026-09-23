-- E23: Qualitaetsstufe existiert nur als Ableitung. Diese IMMUTABLE
-- SQL-Funktion ist der Spiegel von apps/web/lib/qualitaet.ts
-- (deriveQualitaet); der Paritaetstest im CI haelt beide deckungsgleich.
-- Handgeschrieben (drizzle-kit kennt keine Funktionen) — Snapshot bleibt
-- unangetastet, die Generated-Spalte darunter kommt aus dem Generator.
CREATE FUNCTION qualitaetsstufe(
  p_typ beleg_typ,
  p_extern boolean,
  p_datei_key text,
  p_link_url text,
  p_gueltig_bis date,
  p_metadata jsonb,
  p_erstellt_am timestamptz
) RETURNS qualitaets_stufe
LANGUAGE sql IMMUTABLE AS $fn$
WITH f AS (
  SELECT
    coalesce(btrim(p_metadata->>'quellenangabe'), '') <> '' AS quelle,
    p_erstellt_am IS NOT NULL AS erhebung,
    coalesce(btrim(p_datei_key), '') <> '' AS datei,
    (coalesce(btrim(p_datei_key), '') <> '' OR coalesce(btrim(p_link_url), '') <> '') AS datei_oder_link,
    p_gueltig_bis IS NOT NULL AS gueltig_bis_gesetzt,
    (coalesce(btrim(p_metadata->>'gespraechsdatum'), '') <> ''
      AND coalesce(btrim(p_metadata->>'gespraechspartner'), '') <> '') AS gespraech_felder,
    coalesce((p_metadata->>'amtlich')::boolean, false) AS amtlich
), v AS (
  SELECT
    quelle AND erhebung AND p_extern AND CASE p_typ
      WHEN 'betriebsdaten' THEN datei_oder_link
      WHEN 'dokument_link' THEN datei_oder_link
      WHEN 'vertrag' THEN datei
      WHEN 'absichtserklaerung' THEN datei
      WHEN 'angebot' THEN datei_oder_link AND gueltig_bis_gesetzt
      WHEN 'gespraech' THEN gespraech_felder
    END AS voll,
    amtlich
  FROM f
)
SELECT (CASE p_typ
    WHEN 'betriebsdaten' THEN CASE WHEN voll THEN 'A' ELSE 'B' END
    WHEN 'vertrag' THEN CASE WHEN voll THEN 'A' ELSE 'B' END
    WHEN 'absichtserklaerung' THEN CASE WHEN voll THEN 'B' ELSE 'C' END
    WHEN 'angebot' THEN CASE WHEN voll THEN 'C' ELSE 'D' END
    WHEN 'gespraech' THEN CASE WHEN voll THEN 'C' ELSE 'D' END
    WHEN 'dokument_link' THEN CASE WHEN NOT voll THEN 'D' WHEN amtlich THEN 'B' ELSE 'C' END
  END)::qualitaets_stufe
FROM v
$fn$;--> statement-breakpoint
ALTER TABLE "beleg" ADD COLUMN "qualitaet" "qualitaets_stufe" GENERATED ALWAYS AS (qualitaetsstufe(typ, extern_nachvollziehbar, datei_key, link_url, gueltig_bis, metadata, erstellt_am)) STORED;