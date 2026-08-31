#!/usr/bin/env bash
#
# Restore-Test: spielt einen pg_dump-Custom-Dump gegen eine Ziel-Datenbank zurueck
# und verifiziert PostGIS + die drei Enums.
#
# Die Ziel-DB kommt aus der Umgebungsvariable TARGET_DATABASE_URL. Bewusst NICHT
# gegen Production laufen lassen — gedacht fuer einen kurzlebigen Neon-Scratch-Branch.
#
# Voraussetzung: pg_restore/psql (PostgreSQL-17-Client) lokal vorhanden.
#
# Nutzung:
#   TARGET_DATABASE_URL="postgres://.../scratch?sslmode=require" \
#     ./scripts/restore-test.sh pfad/zum/backup.dump

set -euo pipefail

DUMP_FILE="${1:-}"

if [[ -z "${TARGET_DATABASE_URL:-}" ]]; then
  echo "Fehler: TARGET_DATABASE_URL ist nicht gesetzt." >&2
  echo "Nutzung: TARGET_DATABASE_URL=... $0 <dump-datei>" >&2
  exit 1
fi

if [[ -z "$DUMP_FILE" || ! -f "$DUMP_FILE" ]]; then
  echo "Fehler: Dump-Datei fehlt oder wurde nicht gefunden: '${DUMP_FILE:-<leer>}'" >&2
  echo "Nutzung: TARGET_DATABASE_URL=... $0 <dump-datei>" >&2
  exit 1
fi

# Sicherung gegen versehentliches Zielen auf Production.
if [[ "$TARGET_DATABASE_URL" == *"$(printf 'prod')"* ]]; then
  echo "Abbruch: TARGET_DATABASE_URL enthaelt 'prod' — dieser Test darf nie gegen Production laufen." >&2
  exit 1
fi

echo "==> Restore von '$DUMP_FILE' in die Ziel-Datenbank ..."
# --clean --if-exists macht den Restore wiederholbar; --no-owner/--no-privileges
# vermeidet Rollen-/Rechtefehler gegen einen frischen Scratch-Branch.
pg_restore \
  --dbname "$TARGET_DATABASE_URL" \
  --clean --if-exists \
  --no-owner --no-privileges \
  "$DUMP_FILE"

echo "==> Verifikation: PostGIS-Extension und die drei Enums"
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
\echo '-- PostGIS --'
SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis';

\echo '-- Enums --'
SELECT t.typname AS enum,
       string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS werte
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('datensatz_status', 'beleg_typ', 'bereitschaft_stufe')
GROUP BY t.typname
ORDER BY t.typname;
SQL

echo "==> Restore-Test abgeschlossen."
