# ops — manuell ausgeführte Eingriffe

Hier liegen SQL-Blöcke, die **von Hand** ausgeführt wurden, zur
Nachvollziehbarkeit: Wortlaut, Datum, Ausführender, Ergebnis im
Kopfkommentar. **Kein Workflow und kein Skript führt diese Dateien aus.**
Ausführung nur durch Eric im Neon SQL Editor, nach Vorprüfung im selben
Block; Löschungen auf Production bleiben Menschenhand (Leitplanke „Keine
manuellen Eingriffe in die Datenbank" gilt für Schemaänderungen und
Fachdaten — hier ging es um Testreste vor dem Go-live, ausdrücklich
freigegeben).

- `go-live/2026-09-28-block-b.sql` — Testdaten auf Production entfernt
  (Archiv `archiv_testdaten`, Vorprüfung 1/1/0/0, Ergebnis im Kopf).
- `go-live/2026-09-28-block-c.sql` — Belegnummern-Sequenz zurückgesetzt,
  nur bei leerer `beleg` (Ergebnis `1 | false`).

Vormerkung: `archiv_testdaten` per Migration entfernen, Ablaufdatum
28.10.2026 (E37).
