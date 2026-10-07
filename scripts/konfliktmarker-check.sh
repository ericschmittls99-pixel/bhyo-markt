#!/usr/bin/env bash
#
# konfliktmarker-check.sh — Waechter gegen Konfliktmarker in versionierten
# Dateien (AP2.7 PR g, Eric 07.10.2026). Anlass: beim Angleichen von E68 PR 1
# an main blieben <<<<<<< / ======= / >>>>>>> in zwei Doku-Dateien stehen und
# wurden committet; aufgefallen ist es erst beim naechsten Merge.
#
# Geprueft werden alle von git versionierten Dateien des Arbeitsbaums
# (git ls-files), zeilenweise mit dem Muster am Zeilenanfang:
#   <<<<<<< <text>   |   =======   |   >>>>>>> <text>
# Ausgenommen sind nur Binaerdateien (grep -I) und dieses Skript samt seinem
# Test (die nennen die Muster absichtlich). Jeder Treffer wird mit Datei und
# Zeile gedruckt, der Lauf endet rot (Exit 1). Kein Treffer: Exit 0.
#
# bash 3.2 (macOS) genuegt: keine Arrays mit declare -A, kein mapfile.
set -euo pipefail
WURZEL="${KONFLIKT_WURZEL:-$(git rev-parse --show-toplevel)}"
cd "$WURZEL"
MUSTER='^(<<<<<<< |=======$|>>>>>>> )'
TREFFER=0
# NUL-getrennt, damit Leerzeichen in Dateinamen nichts zerreissen.
while IFS= read -r -d '' datei; do
  case "$datei" in
    scripts/konfliktmarker-check.sh|scripts/tests/konfliktmarker-test.sh) continue ;;
  esac
  [ -f "$datei" ] || continue
  if ausgabe="$(grep -nIE "$MUSTER" -- "$datei" 2>/dev/null)"; then
    while IFS= read -r zeile; do
      echo "KONFLIKTMARKER $datei:$zeile"
      TREFFER=$((TREFFER + 1))
    done <<< "$ausgabe"
  fi
done < <(git ls-files -z)
if [ "$TREFFER" -gt 0 ]; then
  echo "::error::konfliktmarker-check: $TREFFER Konfliktmarker in versionierten Dateien — Merge unvollstaendig aufgeloest."
  exit 1
fi
echo "konfliktmarker-check OK — keine Konfliktmarker in $(git ls-files | wc -l | tr -d ' ') versionierten Dateien."
