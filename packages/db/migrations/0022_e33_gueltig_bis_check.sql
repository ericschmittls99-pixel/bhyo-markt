-- E33 Schritt 3 (26.09.2026): gueltig_bis ist bei den oberen vier Belegtypen
-- Pflicht — Betriebsdaten, Vertrag, Absichtserklaerung, Angebot. Ein Formular
-- ist eine Bitte (Pflicht in der Oberflaeche seit 0021), ein CHECK ist eine
-- Zusicherung. Die unteren drei Typen (Gespraech, Dokument, Webrecherche)
-- tragen kein Enddatum; fuer sie gilt die Typ-Frist ab erstellt_am.
--
-- Diese Migration SCHREIBT KEINEN FACHWERT. Die Daten wurden vorher
-- nachgetragen: Production B-000001 durch Eric in der Anwendung (31.12.2027),
-- Preview per Re-Seed und in der Anwendung (B-000006, B-000127). Bleibt eine
-- Zeile ohne Datum, bricht die Migration mit der Liste der Belegnummern ab —
-- statt mit einem nackten Constraint-Fehler. Denselben Befund liefert vorab
-- der Schritt "Fristen-Vorpruefung" (beleg-frist-check) in deploy.yml und
-- migrate-production.yml, damit ein Deploy gar nicht erst in die Migration
-- laeuft.
DO $$
DECLARE
  fehlend text;
  n integer;
BEGIN
  SELECT count(*), string_agg(beleg_nr || ' (' || typ::text || ')', ', ' ORDER BY beleg_nr)
    INTO n, fehlend
    FROM "beleg"
   WHERE typ::text IN ('betriebsdaten', 'vertrag', 'absichtserklaerung', 'angebot')
     AND gueltig_bis IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'E33 CHECK gueltig_bis: % Beleg(e) der oberen vier Typen ohne Datum: %. Erst in der Anwendung nachtragen, dann migrieren — die Migration schreibt keinen Fachwert.', n, fehlend;
  END IF;
  RAISE NOTICE 'E33 gueltig_bis: keine Zeile ohne Datum — CHECK darf angelegt werden';
END $$;
--> statement-breakpoint
ALTER TABLE "beleg" ADD CONSTRAINT "beleg_gueltig_bis_check" CHECK ("beleg"."typ" NOT IN ('betriebsdaten', 'vertrag', 'absichtserklaerung', 'angebot') OR "beleg"."gueltig_bis" IS NOT NULL);
