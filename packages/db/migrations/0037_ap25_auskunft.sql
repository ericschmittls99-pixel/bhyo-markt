-- AP2.5 PR b (Art. 15 DSGVO, Entscheidung Eric 01.10.2026): Ereignisart
-- auskunft_erstellt — die Aktion „Auskunft erstellen" (nur Admin) schreibt
-- es mit Objektbezug Kontaktperson (nur IDs); die Druckansicht ist nur ueber
-- dieses Ereignis erreichbar. Neuer Enum-Wert unter dem Rename-Verbot (E53).
ALTER TYPE "public"."ereignis_art" ADD VALUE 'auskunft_erstellt';