# AP0c – Handoff: Backup und Restore

Letzter Baustein von AP0, nach `docs/ap0a-worker-skeleton.md` und
`docs/ap0b-handoff-datenbank-grundgeruest.md`. Erfüllt das formale Fertig-Kriterium
des Pakets: eine Sicherungskopie erfolgreich zurückgespielt. Noch keine Fachtabellen
vorhanden – der Restore-Test prüft den Mechanismus, nicht echte Daten.

## Ziel und Definition of Done

Ein täglicher automatischer Dump der Production-Datenbank landet in R2, unabhängig
von Neon selbst.

Fertig, wenn:

- ein GitHub-Actions-Workflow täglich `pg_dump` gegen Production fährt und das
  Ergebnis in einen R2-Bucket lädt
- ein Restore einmal durchgeführt und dokumentiert wurde (Schema + PostGIS + Enums
  nach dem Restore vorhanden)
- alte Backups automatisch ablaufen (R2-Lifecycle-Regel), keine unbegrenzt
  wachsende Ablage

## Architektur

`pg_dump` (Custom-Format, komprimiert) → R2 über die S3-kompatible API. Bewusst
nicht Neons eigenes Point-in-Time-Recovery: R2 ist unabhängig von Neon, portabel,
und deckt auch den Fall „Neon-Account/Projekt weg" ab, nicht nur „falsche Zeile
gelöscht".

## Vorbedingung (Eric, Cloudflare-Dashboard)

1. R2-Bucket `bhyogenics-backups`, kein öffentlicher Zugriff
2. R2-API-Token, Scope nur dieser Bucket, „Object Read & Write" – Access Key ID +
   Secret Access Key, getrennt vom Workers-Deploy-Token
3. Lifecycle-Regel am Bucket: Objekte nach 30 Tagen löschen

## Secrets

Repo-Secrets `DATABASE_URL_PRODUCTION`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` – gesetzt über `gh secret set`, nie im Klartext im Repo.
`DATABASE_URL_PRODUCTION` ist neu gegenüber AP0b: bisher nur manuell im Terminal
verwendet, jetzt dauerhaft für den automatisierten Job gespeichert.

## CI

- `.github/workflows/backup.yml`, Cron täglich (z. B. 02:00 UTC)
- `pg_dump --format=custom` gegen `DATABASE_URL_PRODUCTION`
- Upload nach R2 via S3-kompatibler API, Endpoint
  `https://<account-id>.r2.cloudflarestorage.com`, authentifiziert mit den beiden
  R2-Secrets
- Dateiname mit Datum, z. B. `bhyogenics-YYYY-MM-DD.dump`
- `pg_dump`/`aws-cli` im Runner sicherstellen (ggf. per `apt-get` nachinstallieren),
  nicht ungeprüft als vorhanden annehmen

## Restore-Test (einmalig, manuell, dokumentiert)

1. Neuesten Dump aus R2 herunterladen
2. Scratch-Branch in Neon anlegen, Auto-delete an (z. B. nach 1 Tag)
3. `pg_restore` gegen den Scratch-Branch
4. Verifizieren: PostGIS-Extension und die drei Enums vorhanden
5. Ergebnis hier ergänzen, Scratch-Branch danach löschen oder auslaufen lassen

## Ergebnis (31.08.2026)

Zwei Infra-Stolpersteine, beide gegen einen Branch getestet, ohne Production
anzufassen:

- Neon läuft auf Postgres 18.6 – Runner-Default-`pg_dump` (16) brach mit
  „server version mismatch" ab, behoben mit `postgresql-client-18`
- R2-Bucket hat Jurisdiction „European Union" – braucht den eigenen Endpoint
  `https://<account-id>.eu.r2.cloudflarestorage.com`, Standard-Endpoint gab
  irreführend „AccessDenied"

Backup verifiziert: Dump liegt in `s3://bhyogenics-backups/`. Restore-Test gegen
Neon-Scratch-Branch erfolgreich: PostGIS 3.6.0 und alle drei Enums mit korrekten
Werten wiederhergestellt. DoD erfüllt, AP0 damit insgesamt abgeschlossen.

## Nicht in diesem Paket

Automatisierter Restore-Test, Wiederherstellung einzelner Tabellen/Zeilen, Backup
der Preview-Datenbank.

## Go-live-Nachweis (26.09.2026)

**Was der Backup-Workflow tatsächlich sichert:** täglich 02:00 UTC ein
`pg_dump --format=custom --no-owner --no-privileges` der **gesamten
Production-Datenbank** (alle Schemata, also auch `drizzle.__drizzle_migrations`,
PostGIS-Geometrien inklusive) nach `s3://bhyogenics-backups/bhyogenics-<JJJJ-MM-TT>.dump`.
Zusätzlich manuell per `workflow_dispatch`. **Nicht gesichert:** der R2-Bucket
`bhyogenics-belege` mit den hochgeladenen Beleg-Dateien — die Datenbank kennt
nur die Schlüssel. Ob die Lifecycle-Regel (30 Tage) am Bucket gesetzt ist,
lässt sich aus dem Repo nicht ablesen; der Restore-Workflow listet den
Bucket-Inhalt, daran sieht man die Aufbewahrung.

**Restore-Nachweis als Workflow** (`.github/workflows/restore-test.yml`,
manuell): holt den neuesten Dump aus R2, spielt ihn mit `scripts/restore-test.sh`
in einen Neon-Scratch-Branch (Secret `RESTORE_DATABASE_URL` im Environment
`production-lesend`; Production und Preview als Ziel werden abgewiesen) und
zählt mit `packages/db/src/restore-zaehlung.ts` **jede Tabelle** aus
`information_schema` gegen Production über die Leserolle, dazu
Migrationsstand, PostGIS und Enum-Werte. Fehlende Tabellen oder abweichender
Migrationsstand brechen ab; abweichende Zeilenzahlen werden ausgewiesen (der
Dump ist von 02:00 UTC). Vorbedingung: Eric legt den Branch an und setzt das
Secret. Ergebnis kommt hierher.

**Ergebnis 28.09.2026:** Lauf 36403513802 — Dump `bhyogenics-2026-09-28.dump`
in eine frische Datenbank auf dem Scratch-Branch, 17 Tabellen, 0
Abweichungen, Migrationsstand 24, PostGIS und Enums gleich. Vorher
notwendig: Migration 0023 (`search_path` der Funktion), siehe E37 im
Entscheidungslog. Wöchentlich ab jetzt über `restore-woechentlich.yml`.
