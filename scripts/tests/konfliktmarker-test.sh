#!/usr/bin/env bash
#
# konfliktmarker-test.sh — Rot-Nachweis fuer scripts/konfliktmarker-check.sh
# (AP2.7 PR g): ein Wegwerf-Repo mit einer sauberen Datei ist gruen; dieselbe
# Datei mit einem Konfliktblock macht den Check rot und nennt Datei und
# Zeile; ein „=======" mitten in einer Zeile oder eine Markdown-Trennlinie
# „---" sind keine Treffer; eine nicht versionierte Datei zaehlt nicht.
set -euo pipefail
export GIT_AUTHOR_NAME=kmtest GIT_AUTHOR_EMAIL=kmtest@example.invalid
export GIT_COMMITTER_NAME=kmtest GIT_COMMITTER_EMAIL=kmtest@example.invalid
HIER="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HIER/../konfliktmarker-check.sh"
FEHLER=0; PRUEFUNGEN=0
erwarte() { local was="$1"; shift; PRUEFUNGEN=$((PRUEFUNGEN + 1)); if "$@"; then echo "    ok    $was"; else echo "    ROT   $was"; FEHLER=$((FEHLER + 1)); fi; }

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
git -C "$T" init -q
printf 'Titel\n\n---\n\nText mit a == b und x ======= y mitten in der Zeile.\n' > "$T/doku.md"
git -C "$T" add -A && git -C "$T" commit -q -m "sauber"

echo "Fall 1: sauber"
AUS="$(KONFLIKT_WURZEL="$T" "$CHECK")"; RC=$?
erwarte "Exit 0" test "$RC" -eq 0
erwarte "meldet OK" bash -c "echo \"\$1\" | grep -q 'konfliktmarker-check OK'" _ "$AUS"

echo "Fall 2: Konfliktblock committet"
printf 'Titel\n<<<<<<< HEAD\nunsere Zeile\n=======\nihre Zeile\n>>>>>>> origin/main\n' > "$T/doku.md"
git -C "$T" commit -qam "mit marker"
set +e; AUS="$(KONFLIKT_WURZEL="$T" "$CHECK")"; RC=$?; set -e
erwarte "Exit 1" test "$RC" -eq 1
erwarte "nennt Datei und Zeile 2" bash -c "echo \"\$1\" | grep -q 'KONFLIKTMARKER doku.md:2:<<<<<<< HEAD'" _ "$AUS"
erwarte "nennt die Trennzeile 4" bash -c "echo \"\$1\" | grep -q 'KONFLIKTMARKER doku.md:4:======='" _ "$AUS"
erwarte "zaehlt drei Marker" bash -c "echo \"\$1\" | grep -q '3 Konfliktmarker'" _ "$AUS"

echo "Fall 3: Marker nur in einer nicht versionierten Datei"
git -C "$T" checkout -q HEAD~1 -- doku.md && git -C "$T" commit -qam "wieder sauber"
printf '<<<<<<< HEAD\n' > "$T/notiz.txt"
set +e; KONFLIKT_WURZEL="$T" "$CHECK" > /dev/null; RC=$?; set -e
erwarte "unversioniert zaehlt nicht (Exit 0)" test "$RC" -eq 0

echo "$PRUEFUNGEN Pruefungen, $FEHLER rot"
[ "$FEHLER" -eq 0 ]
