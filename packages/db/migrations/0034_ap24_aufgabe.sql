-- AP2.4 PR c (E63, D5, Expand nach E21): Weitergeben als Aufgabe.
--
-- 1. Ereignisart weitergegeben: der Empfaenger eines Pruefauftrags oder
--    Ablauf-Hinweises gibt ihn als Aufgabe an eine Person weiter (Protokoll
--    mit Objektbezug Strom, betroffener Person und Aufgabentext).
-- 2. Inbox-Typ aufgabe: der Eintrag beim Empfaenger, mit dem Text in der
--    neuen Spalte inbox_eintrag.aufgabe.
-- 3. CHECK inbox_eintrag_aufgabe_check: Text NUR beim Typ aufgabe, dort
--    Pflicht — nicht leer (ohne Rand), hoechstens 500 Zeichen. Dieselbe
--    Regel steht serverseitig in lib/inbox/aufgabe.ts (Meldung); die DB ist
--    die letzte Grenze (Rot-Nachweis: leerer Text im Server und in der DB).
--
-- Neue Enum-Werte werden in derselben Transaktion nicht als Literal
-- verwendet: der CHECK vergleicht ueber inbox_typ_text (IMMUTABLE, 0028).
-- Enum-Werte werden nie umbenannt (E53, enum-rename-check).
ALTER TYPE "public"."ereignis_art" ADD VALUE 'weitergegeben';--> statement-breakpoint
ALTER TYPE "public"."inbox_typ" ADD VALUE 'aufgabe';--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD COLUMN "aufgabe" text;--> statement-breakpoint
ALTER TABLE "inbox_eintrag" ADD CONSTRAINT "inbox_eintrag_aufgabe_check" CHECK ((inbox_typ_text("inbox_eintrag"."typ") = 'aufgabe' and "inbox_eintrag"."aufgabe" is not null and length(btrim("inbox_eintrag"."aufgabe")) between 1 and 500) or (inbox_typ_text("inbox_eintrag"."typ") <> 'aufgabe' and "inbox_eintrag"."aufgabe" is null));--> statement-breakpoint
-- Zaehlbeweis im selben Lauf: Spalte und CHECK stehen; bestehende Zeilen
-- erfuellen den CHECK (aufgabe ist ueberall NULL) — sonst gilt die Migration
-- nicht als gelungen.
DO $$
DECLARE
  n_spalte integer;
  n_check integer;
  n_text integer;
BEGIN
  SELECT count(*) INTO n_spalte FROM information_schema.columns WHERE table_name = 'inbox_eintrag' AND column_name = 'aufgabe';
  SELECT count(*) INTO n_check FROM pg_constraint WHERE conname = 'inbox_eintrag_aufgabe_check';
  SELECT count(*) INTO n_text FROM inbox_eintrag WHERE aufgabe IS NOT NULL;
  RAISE NOTICE 'PR_C aufgabe_spalte=% aufgabe_check=% zeilen_mit_text=%', n_spalte, n_check, n_text;
  IF n_spalte <> 1 OR n_check <> 1 OR n_text <> 0 THEN
    RAISE EXCEPTION 'PR c nach Expand widerspruechlich (spalte=%, check=%, text=%)', n_spalte, n_check, n_text;
  END IF;
END $$;
