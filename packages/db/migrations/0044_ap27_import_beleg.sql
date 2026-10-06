-- AP2.7 Excel-Import, PR b (E67): Belegdaten des Lauf-Belegs am Import-Lauf.
-- Ein Beleg je Lauf und Belegtyp (E48); Erhebungsdatum und — bei den oberen
-- vier Typen (E33) — Gueltig-bis fragt der Probelauf ab, weil E67 sie nicht
-- festlegt und nichts geraten wird. Additiv, Verbraucher in demselben PR
-- (lib/import-actions.ts importBelegDatenSetzen, importProbelauf).
ALTER TABLE "import_lauf" ADD COLUMN "beleg_erhebungsdatum" date;--> statement-breakpoint
ALTER TABLE "import_lauf" ADD COLUMN "beleg_gueltig_bis" date;