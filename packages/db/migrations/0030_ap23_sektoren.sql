-- AP2.3 PR b (E59, Expand nach E21): Sektorliste pflegbar. Der Admin legt
-- Sektoren an, benennt sie um, deaktiviert und reaktiviert sie (Aktionen
-- sektor.*, protokolliert mit den vier neuen Ereignisarten). Geloescht wird
-- nicht: aktiv = false nimmt den Sektor aus der Auswahl, Akteure behalten
-- ihn. `id` ist der Objektbezug fuers Protokoll (aenderung.entitaet_id ist
-- uuid); der Code bleibt Schluessel und Ziel des Fremdschluessels.
-- Bezeichnung einmal, Schreibweise und Randleerraum egal (Index auf
-- lower(btrim(label)); Dubletten vor der Migration: keine — acht Werte aus
-- 0020). Codes wie Enum-Werte: snake_case ohne Umlaute; 'ohne_sektor' (der
-- Filterwert fuer NULL) und 'abnehmer' (eine Rolle, 0020) nie als Sektor.
-- Bestehende Zeilen bekommen id und aktiv = true ueber die Defaults.
ALTER TYPE "public"."ereignis_art" ADD VALUE 'sektor_angelegt';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'sektor_umbenannt';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'sektor_deaktiviert';--> statement-breakpoint
ALTER TYPE "public"."ereignis_art" ADD VALUE 'sektor_reaktiviert';--> statement-breakpoint
ALTER TABLE "sektor" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "sektor" ADD COLUMN "aktiv" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sektor_label_lower_idx" ON "sektor" USING btree (lower(btrim("label")));--> statement-breakpoint
ALTER TABLE "sektor" ADD CONSTRAINT "sektor_id_unique" UNIQUE("id");--> statement-breakpoint
ALTER TABLE "sektor" ADD CONSTRAINT "sektor_code_check" CHECK ("sektor"."code" ~ '^[a-z0-9_]+$' and "sektor"."code" not in ('ohne_sektor', 'abnehmer'));--> statement-breakpoint
ALTER TABLE "sektor" ADD CONSTRAINT "sektor_label_check" CHECK (length(btrim("sektor"."label")) > 0);