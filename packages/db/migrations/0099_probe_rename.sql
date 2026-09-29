-- PROBE (Wegwerf): muss enum-rename-check rot machen. Kein Journal-Eintrag, wird nie angewendet.
ALTER TYPE "public"."inbox_typ" RENAME VALUE 'zugriffsanfrage' TO 'anfrage';
