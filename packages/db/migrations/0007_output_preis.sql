-- E13-Nachtrag: 0007 wurde nach dem ersten Preview-Lauf um preis_herkunft
-- erweitert (PR #24 war noch nicht gemerged, Production nie migriert). Die
-- Preview-DB traegt preis + preis_einheit bereits — deshalb idempotent per
-- IF NOT EXISTS, damit derselbe Stand auf Preview (Nachzuegler-Spalte) und
-- Production (alle drei Spalten) entsteht.
ALTER TABLE "output_bedarf" ADD COLUMN IF NOT EXISTS "preis" numeric;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD COLUMN IF NOT EXISTS "preis_einheit" text;--> statement-breakpoint
ALTER TABLE "output_bedarf" ADD COLUMN IF NOT EXISTS "preis_herkunft" "preis_herkunft";
