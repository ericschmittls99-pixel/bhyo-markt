#!/usr/bin/env bash
#
# freigabe-test.sh — Waechter-Tests fuer scripts/freigabe.sh und
# scripts/merge-sicher.sh (Eric, 06.10.2026: „bash -n reicht fuer unser
# wichtigstes Sicherheitsnetz nicht").
#
# Jeder Fall baut ein frisches Bare-Repo mit Klon (Eltern-PR #10 auf main,
# gestapelter Kind-PR #11 auf dem Eltern-Branch), legt den GitHub-Zustand in
# $FAKE_GH_DIR ab und laesst freigabe.sh mit der gh-Attrappe
# (scripts/tests/fake-gh.sh) laufen. Geprueft wird das Verhalten, nicht die
# Ausgabe allein: Neustarts werden in calls.log gezaehlt, der Kind-Branch im
# Bare-Repo gemessen.
#
#   (e) Push-Deploy von main: genau EIN Neustart, nur bei von GitHub
#       abgebrochenem Lauf (Job cancelled); ein roter Check startet nichts neu.
#   CI-Diaet (Betriebs-PR 3, 08.10.2026):
#       Netzfehler bei gh nach dem Merge werden bis zu dreimal wiederholt
#       (GH_PAUSE=0 im Test); eine Migration im PR laesst (e) auf den
#       Dispatch-Lauf warten, den migrate-production ausloest (der Push-Lauf
#       bleibt erwartet rot); ein abgebrochener Lauf am Head wird nicht neu
#       gestartet, wenn ein juengerer gruen ist; merge-sicher.sh wertet je
#       Check-Namen nur den juengsten Lauf.
#   (1b) Pflicht-Checks (ziel-wache, typen-und-tests, wegwerf-db, deploy; bei
#       reinem Doku-PR nur die ersten beiden): juengster Lauf cancelled,
#       skipped oder fehlend = kein Merge.
#   (Folge) Das Doku-Muster kommt von der Basis des PR (API), nicht vom
#       lokalen Checkout; ein PR, der die Musterdatei aendert, ist ein
#       Code-PR; Muster nicht lesbar = Code-PR.
#   (f) Gestapelte PRs: in (a) auf main umgehaengt, danach angeglichen NUR
#       durch Merge des Squash (zwei Eltern: alter Head, Squash), Patch-ID
#       gegen den Basis-Baum gleich → Push. Abweichende Patch-ID oder nicht
#       belegbarer Basis-Baum → kein Push, Head bleibt.
#
# FREIGABE_SKRIPT_DIR zeigt auf die zu pruefenden Skripte (Vorgabe: scripts/).
# Der Rot-Nachweis laeuft mit dem Stand von main vor #183.
set -euo pipefail
# Die Attrappe committet den Squash im Bare-Repo, freigabe.sh merged im
# Wegwerf-Worktree: beides braucht eine Identitaet, die der CI-Runner nicht
# hat. Nur fuer diesen Prozess gesetzt, keine globale Konfiguration.
export GIT_AUTHOR_NAME=freigabe-test GIT_AUTHOR_EMAIL=freigabe-test@example.invalid
export GIT_COMMITTER_NAME=freigabe-test GIT_COMMITTER_EMAIL=freigabe-test@example.invalid
HIER="$(cd "$(dirname "$0")" && pwd)"
SKRIPTE="${FREIGABE_SKRIPT_DIR:-$HIER/..}"
SKRIPTE="$(cd "$SKRIPTE" && pwd)"
FEHLER=0; PRUEFUNGEN=0

erwarte() { # <beschreibung> <befehl...> — der Befehl ist die Behauptung
  local was="$1"; shift
  PRUEFUNGEN=$((PRUEFUNGEN + 1))
  if "$@"; then echo "    ok    $was"; else echo "    ROT   $was"; FEHLER=$((FEHLER + 1)); fi
}

# Ein Fall: Bare-Repo + Klon + gh-Zustand. Setzt T, REMOTE, KLON, D, ELTERN,
# KIND, MAIN_VORHER. Zweites Argument: Commit auf dem Eltern-Branch NACH dem
# Abzweig des Kinds — "konflikt" aendert dieselbe Zeile wie der erste
# Eltern-Commit (Kind traegt sie noch), "neue_datei" legt eine Datei an, die
# das Kind nicht kennt (Patch-ID weicht dann ab).
fall_aufbauen() { # <name> [konflikt|neue_datei]
  T=$(mktemp -d); REMOTE="$T/remote.git"; KLON="$T/klon"; D="$T/gh"
  mkdir -p "$D"; : > "$D/calls.log"; : > "$D/szenario"; echo "$REMOTE" > "$D/remote"
  git init -q --bare -b main "$REMOTE"
  local w="$T/work"
  git init -q -b main "$w"
  git -C "$w" config user.email test@example.invalid; git -C "$w" config user.name Test
  mkdir -p "$w/docs" "$w/scripts"; echo start > "$w/docs/a.md"
  # Das Doku-Muster liegt in der Basis (main) des Wegwerf-Repos — merge-sicher.sh liest es von dort ueber die API.
  cp "$HIER/../nur-doku-muster.txt" "$w/scripts/nur-doku-muster.txt"
  git -C "$w" add -A; git -C "$w" commit -q -m "start"
  git -C "$w" remote add origin "$REMOTE"; git -C "$w" push -q -u origin main
  MAIN_VORHER=$(git -C "$w" rev-parse HEAD)
  git -C "$w" checkout -q -b eltern
  echo eltern > "$w/docs/eltern.md"; echo "A" > "$w/docs/a.md"
  git -C "$w" add -A; git -C "$w" commit -q -m "eltern"; git -C "$w" push -q origin eltern
  git -C "$w" checkout -q -b kind
  echo kind > "$w/docs/kind.md"
  git -C "$w" add -A; git -C "$w" commit -q -m "kind"; git -C "$w" push -q origin kind
  KIND=$(git -C "$w" rev-parse HEAD)
  case "${2:-}" in
    konflikt)
      git -C "$w" checkout -q eltern
      echo "B" > "$w/docs/a.md"; git -C "$w" commit -q -am "eltern 2"; git -C "$w" push -q origin eltern ;;
    neue_datei)
      git -C "$w" checkout -q eltern
      echo eltern2 > "$w/docs/eltern2.md"; git -C "$w" add -A; git -C "$w" commit -q -m "eltern 2"; git -C "$w" push -q origin eltern ;;
  esac
  ELTERN=$(git -C "$w" rev-parse eltern)
  git clone -q "$REMOTE" "$KLON"
  git -C "$KLON" config user.email test@example.invalid; git -C "$KLON" config user.name Test
  jq -n --arg e "$ELTERN" --arg k "$KIND" '{
    "10": {number: 10, state: "OPEN", isDraft: false, headRefOid: $e, headRefName: "eltern", baseRefName: "main",
           mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", mergeCommit: null,
           files: [{filename: "apps/web/lib/eltern.ts", status: "added"}, {filename: "docs/eltern.md", status: "added"}]},
    "11": {number: 11, state: "OPEN", isDraft: false, headRefOid: $k, headRefName: "kind", baseRefName: "eltern",
           mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", mergeCommit: null,
           files: [{filename: "docs/kind.md", status: "added"}]}}' > "$D/prs.json"
  jq -n --arg e "$ELTERN" '[{databaseId: 100, workflow: "deploy.yml", commit: $e, event: "pull_request", conclusion: "success", jobs: []}]' > "$D/runs.json"
  # Pflicht-Checks eines Code-PRs (1b, Eric 08.10.2026): alle vier gruen; schema-gate und lese-diagnose sind auf PRs uebersprungen.
  checks_setzen '[{id: 1, name: "ziel-wache", status: "completed", conclusion: "success"}, {id: 2, name: "typen-und-tests", status: "completed", conclusion: "success"},
                  {id: 3, name: "wegwerf-db", status: "completed", conclusion: "success"}, {id: 4, name: "deploy", status: "completed", conclusion: "success"},
                  {id: 5, name: "schema-gate", status: "completed", conclusion: "skipped"}, {id: 6, name: "lese-diagnose", status: "completed", conclusion: "skipped"}]' 
  echo "==> Fall: $1"
}

# Die Argumente sind jq-Ausdruecke (Schluessel ohne Anfuehrungszeichen), keine JSON-Texte.
checks_setzen() { jq -n --arg e "$ELTERN" "{(\$e): $1}" > "$D/checks.json"; }
# Folge-PR: ein anderes Muster in der Basis (main) des Wegwerf-Repos — neuer Commit auf main, PR-Branches bleiben.
basis_muster_setzen() {
  printf '%s\n' "$1" > "$T/work/scripts/nur-doku-muster.txt"
  git -C "$T/work" checkout -q main && git -C "$T/work" commit -q -am "muster" && git -C "$T/work" push -q origin main
  MAIN_VORHER=$(git -C "$T/work" rev-parse HEAD)
}
pr_dateien_setzen() { jq ".\"10\".files = $1" "$D/prs.json" > "$D/prs.neu" && mv "$D/prs.neu" "$D/prs.json"; }

freigabe_laufen() { # fuehrt freigabe.sh im Klon aus; RC und AUSGABE
  set +e
  mkdir -p "$T/bin" && ln -sf "$HIER/fake-gh.sh" "$T/bin/gh"
  AUSGABE=$(cd "$KLON" && PATH="$T/bin:$PATH" FAKE_GH_DIR="$D" GH_PAUSE=0 "$SKRIPTE/freigabe.sh" 10 "$ELTERN" "Eltern-Merge" 2>&1)
  RC=$?
  set -e
  sed 's/^/      | /' <<<"$AUSGABE"
}
neustarts() { grep -c '^run rerun ' "$D/calls.log" || true; }
remote_ref() { git -C "$REMOTE" rev-parse "refs/heads/$1"; }
squash_sha() { jq -r '."10".mergeCommit.oid' "$D/prs.json"; }
aufraeumen() { rm -rf "$T"; }

# ---------------------------------------------------------------- (e)
fall_aufbauen "(e) Deploy gruen: kein Neustart, FERTIG"
echo "deploy_main=gruen" > "$D/szenario"
freigabe_laufen
erwarte "Exit 0" [ "$RC" -eq 0 ]
erwarte "kein Neustart" [ "$(neustarts)" -eq 0 ]
erwarte "FERTIG gemeldet" grep -q '^FERTIG: PR #10 gemergt' <<<"$AUSGABE"
# #183-Nachlese: Der Leseweg-Auszug nimmt nur den Job lese-diagnose, nicht die
# Attrappen-Zeilen des Testschritts im selben Deploy-Log.
erwarte "Leseweg-Auszug genau einmal, nicht aus dem Testschritt" [ "$(grep -c 'Leseweg OK' <<<"$AUSGABE")" -eq 1 ]
aufraeumen

fall_aufbauen "(e) Deploy von GitHub abgebrochen, Neustart gruen: genau ein Neustart"
echo "deploy_main=cancelled_dann_gruen" > "$D/szenario"
freigabe_laufen
erwarte "Exit 0" [ "$RC" -eq 0 ]
erwarte "genau ein Neustart" [ "$(neustarts)" -eq 1 ]
erwarte "Neustart mit --failed am Push-Lauf" grep -qx 'run rerun 9001 --failed' "$D/calls.log"
erwarte "FERTIG gemeldet" grep -q '^FERTIG: PR #10 gemergt' <<<"$AUSGABE"
aufraeumen

fall_aufbauen "(e) Deploy abgebrochen, Neustart wieder abgebrochen: kein zweiter Neustart, Abbruch"
echo "deploy_main=cancelled_bleibt" > "$D/szenario"
freigabe_laufen
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "genau ein Neustart, kein zweiter" [ "$(neustarts)" -eq 1 ]
erwarte "ABBRUCH nach Neustart gemeldet" grep -q '^ABBRUCH: Deploy nach Neustart rot' <<<"$AUSGABE"
erwarte "Kind-Branch nicht angefasst" [ "$(remote_ref kind)" = "$KIND" ]
aufraeumen

fall_aufbauen "(e) Deploy rot (Job failure, nicht cancelled): kein Neustart, Abbruch"
echo "deploy_main=rot" > "$D/szenario"
freigabe_laufen
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "kein Neustart" [ "$(neustarts)" -eq 0 ]
erwarte "ABBRUCH Deploy rot gemeldet" grep -q '^ABBRUCH: Deploy rot' <<<"$AUSGABE"
aufraeumen

fall_aufbauen "(a/b) roter Check am Head: nichts gemergt, nichts neu gestartet"
echo "deploy_main=gruen" > "$D/szenario"
jq --arg e "$ELTERN" '.[$e][0].conclusion = "failure"' "$D/checks.json" > "$D/checks.neu" && mv "$D/checks.neu" "$D/checks.json"
freigabe_laufen
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "kein Merge" bash -c "! grep -q '^pr merge ' '$D/calls.log'"
erwarte "kein Neustart" [ "$(neustarts)" -eq 0 ]
erwarte "main unveraendert" [ "$(remote_ref main)" = "$MAIN_VORHER" ]
erwarte "roter Pflicht-Check genannt" grep -q '^ABBRUCH: Pflicht-Checks nicht gruen: ziel-wache=completed/failure' <<<"$AUSGABE"
aufraeumen

fall_aufbauen "(a) PR ist Entwurf: Abbruch vor dem Umhaengen, nichts gemergt"
echo "deploy_main=gruen" > "$D/szenario"
jq '."10".isDraft = true' "$D/prs.json" > "$D/prs.neu" && mv "$D/prs.neu" "$D/prs.json"
freigabe_laufen
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "Entwurf gemeldet" grep -q '^ABBRUCH: PR #10 ist ein Entwurf' <<<"$AUSGABE"
erwarte "Kind NICHT umgehaengt (kein PATCH)" bash -c "! grep -q '^api -X PATCH ' '$D/calls.log'"
erwarte "Kind-Base noch eltern" [ "$(jq -r '."11".baseRefName' "$D/prs.json")" = "eltern" ]
erwarte "kein Merge" bash -c "! grep -q '^pr merge ' '$D/calls.log'"
erwarte "main unveraendert" [ "$(remote_ref main)" = "$MAIN_VORHER" ]
aufraeumen

# ---------------------------------------------------------------- CI-Diaet
fall_aufbauen "(e) Netzfehler bei gh nach dem Merge: zweimal wiederholt, dann FERTIG"
printf 'deploy_main=gruen\nnetzfehler=2\n' > "$D/szenario"
freigabe_laufen
erwarte "Exit 0" [ "$RC" -eq 0 ]
erwarte "zwei Wiederholungen gemeldet" [ "$(grep -c 'Netzfehler bei gh run list' <<<"$AUSGABE")" -eq 2 ]
erwarte "Attrappe hat genau zweimal gescheitert" [ "$(cat "$D/netz.zaehler")" -eq 2 ]
erwarte "kein Neustart" [ "$(neustarts)" -eq 0 ]
erwarte "FERTIG gemeldet" grep -q '^FERTIG: PR #10 gemergt' <<<"$AUSGABE"
aufraeumen

fall_aufbauen "(d/e) Migration im PR: migrate-production ausgeloest, Push-Lauf rot ist erwartet, Dispatch-Lauf traegt (e)"
# Der Push-Lauf von main bleibt im Gate rot (Migration ausstehend) — das darf
# die Freigabe nicht abbrechen; sie wartet auf den Dispatch-Lauf (9101).
echo "deploy_main=rot" > "$D/szenario"
jq '."10".files += [{filename: "packages/db/migrations/0099_test.sql", status: "added"}]' "$D/prs.json" > "$D/prs.neu" && mv "$D/prs.neu" "$D/prs.json"
freigabe_laufen
erwarte "Exit 0" [ "$RC" -eq 0 ]
erwarte "migrate-production ausgeloest" grep -qx 'workflow run migrate-production.yml --ref main -f bestaetigung=production' "$D/calls.log"
erwarte "Push-Lauf als erwartet rot gemeldet" grep -q '^    Push-Lauf von main bleibt erwartet rot' <<<"$AUSGABE"
erwarte "Dispatch-Lauf abgewartet (9101), nicht der Push-Lauf (9001)" bash -c "grep -qx 'run watch 9101 --exit-status' '$D/calls.log' && ! grep -q '^run watch 9001 ' '$D/calls.log'"
erwarte "kein Neustart des roten Push-Laufs" [ "$(neustarts)" -eq 0 ]
erwarte "FERTIG gemeldet" grep -q '^FERTIG: PR #10 gemergt' <<<"$AUSGABE"
aufraeumen

fall_aufbauen "(d/e) Migration im PR ohne Dispatch-Lauf: Abbruch, kein Neustart"
echo "deploy_main=rot" > "$D/szenario"
jq '."10".files += [{filename: "packages/db/migrations/0099_test.sql", status: "added"}]' "$D/prs.json" > "$D/prs.neu" && mv "$D/prs.neu" "$D/prs.json"
# Die Attrappe legt den Dispatch-Lauf nur auf `workflow run` an; hier wird er
# danach entfernt — wie ein Dispatch, der nie ankam. lauf_am_commit sucht bis
# zu 2 Minuten (24 x 5 s), deshalb hier nur zwei Versuche ohne Pause.
freigabe_laufen_ohne_dispatch() {
  set +e
  mkdir -p "$T/bin" && ln -sf "$HIER/fake-gh.sh" "$T/bin/gh"
  AUSGABE=$(cd "$KLON" && PATH="$T/bin:$PATH" FAKE_GH_DIR="$D" GH_PAUSE=0 LAUF_SUCHE_VERSUCHE=2 LAUF_SUCHE_PAUSE=0 FAKE_GH_KEIN_DISPATCH=1 "$SKRIPTE/freigabe.sh" 10 "$ELTERN" "Eltern-Merge" 2>&1)
  RC=$?
  set -e
  sed 's/^/      | /' <<<"$AUSGABE"
}
freigabe_laufen_ohne_dispatch
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "ABBRUCH Dispatch-Deploy nicht gefunden" grep -q '^ABBRUCH: Dispatch-Deploy fuer .* nicht gefunden' <<<"$AUSGABE"
erwarte "kein Neustart" [ "$(neustarts)" -eq 0 ]
aufraeumen

fall_aufbauen "(a) abgebrochener Lauf am Head, juengerer gruen: kein Neustart, Checks je Name nur der juengste, Merge"
echo "deploy_main=gruen" > "$D/szenario"
jq --arg e "$ELTERN" '. + [{databaseId: 99, workflow: "deploy.yml", commit: $e, event: "pull_request", conclusion: "cancelled", jobs: []}]' "$D/runs.json" > "$D/runs.neu" && mv "$D/runs.neu" "$D/runs.json"
checks_setzen '[{id: 1, name: "ziel-wache", status: "completed", conclusion: "success"}, {id: 2, name: "typen-und-tests", status: "completed", conclusion: "cancelled"},
                {id: 3, name: "wegwerf-db", status: "completed", conclusion: "success"}, {id: 4, name: "deploy", status: "completed", conclusion: "success"},
                {id: 7, name: "typen-und-tests", status: "completed", conclusion: "success"}]'
freigabe_laufen
erwarte "Exit 0" [ "$RC" -eq 0 ]
erwarte "ueberholter Lauf gemeldet, kein Neustart" grep -q '^    abgebrochene Laeufe am Head (99) — ueberholt' <<<"$AUSGABE"
erwarte "kein Neustart" [ "$(neustarts)" -eq 0 ]
erwarte "gemergt" grep -q '^pr merge ' "$D/calls.log"
erwarte "je Name nur der juengste Check gewertet (4 Namen, typen-und-tests gruen)" bash -c "grep -q '^    4 Lauf/Laeufe (je Name der juengste): ' <<<\"\$1\" && grep -q 'typen-und-tests=completed/success' <<<\"\$1\" && ! grep -q 'typen-und-tests=completed/cancelled' <<<\"\$1\"" _ "$AUSGABE"
aufraeumen

fall_aufbauen "(a/b) Rot-Nachweis: juengster Check rot, aelterer gruen: kein Merge"
echo "deploy_main=gruen" > "$D/szenario"
checks_setzen '[{id: 1, name: "ziel-wache", status: "completed", conclusion: "success"}, {id: 2, name: "typen-und-tests", status: "completed", conclusion: "success"},
                {id: 3, name: "wegwerf-db", status: "completed", conclusion: "success"}, {id: 4, name: "deploy", status: "completed", conclusion: "success"},
                {id: 7, name: "typen-und-tests", status: "completed", conclusion: "failure"}]'
freigabe_laufen
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "kein Merge" bash -c "! grep -q '^pr merge ' '$D/calls.log'"
erwarte "roter Pflicht-Check genannt" grep -q '^ABBRUCH: Pflicht-Checks nicht gruen: typen-und-tests=completed/failure' <<<"$AUSGABE"
aufraeumen

# 1b (Eric 08.10.2026): Pflicht-Checks — juengster Lauf cancelled, skipped oder fehlend = nicht gruen.
fall_aufbauen "(1b) juengster Lauf von deploy cancelled: kein Merge"
echo "deploy_main=gruen" > "$D/szenario"
checks_setzen '[{id: 1, name: "ziel-wache", status: "completed", conclusion: "success"}, {id: 2, name: "typen-und-tests", status: "completed", conclusion: "success"},
                {id: 3, name: "wegwerf-db", status: "completed", conclusion: "success"}, {id: 4, name: "deploy", status: "completed", conclusion: "success"},
                {id: 8, name: "deploy", status: "completed", conclusion: "cancelled"}]'
freigabe_laufen
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "kein Merge" bash -c "! grep -q '^pr merge ' '$D/calls.log'"
erwarte "deploy=cancelled genannt" grep -q '^ABBRUCH: Pflicht-Checks nicht gruen: deploy=completed/cancelled' <<<"$AUSGABE"
aufraeumen

fall_aufbauen "(1b) wegwerf-db auf einem Code-PR uebersprungen: kein Merge"
echo "deploy_main=gruen" > "$D/szenario"
checks_setzen '[{id: 1, name: "ziel-wache", status: "completed", conclusion: "success"}, {id: 2, name: "typen-und-tests", status: "completed", conclusion: "success"},
                {id: 3, name: "wegwerf-db", status: "completed", conclusion: "skipped"}, {id: 4, name: "deploy", status: "completed", conclusion: "success"}]'
freigabe_laufen
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "kein Merge" bash -c "! grep -q '^pr merge ' '$D/calls.log'"
erwarte "wegwerf-db=skipped genannt" grep -q '^ABBRUCH: Pflicht-Checks nicht gruen: wegwerf-db=completed/skipped' <<<"$AUSGABE"
aufraeumen

fall_aufbauen "(1b) Pflicht-Check deploy fehlt am Head: kein Merge"
echo "deploy_main=gruen" > "$D/szenario"
checks_setzen '[{id: 1, name: "ziel-wache", status: "completed", conclusion: "success"}, {id: 2, name: "typen-und-tests", status: "completed", conclusion: "success"},
                {id: 3, name: "wegwerf-db", status: "completed", conclusion: "success"}]'
freigabe_laufen
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "kein Merge" bash -c "! grep -q '^pr merge ' '$D/calls.log'"
erwarte "deploy=fehlt genannt" grep -q '^ABBRUCH: Pflicht-Checks nicht gruen: deploy=fehlt' <<<"$AUSGABE"
aufraeumen

fall_aufbauen "(1b) reiner Doku-PR: Wegwerf-DB und Deploy uebersprungen sind erlaubt, Merge"
echo "deploy_main=gruen" > "$D/szenario"
pr_dateien_setzen '[{filename: "docs/eltern.md", status: "added"}, {filename: "docs/screenshots/x/01-light.png", status: "added"}, {filename: "README.md", status: "modified"}]'
checks_setzen '[{id: 1, name: "ziel-wache", status: "completed", conclusion: "success"}, {id: 2, name: "typen-und-tests", status: "completed", conclusion: "success"},
                {id: 3, name: "wegwerf-db", status: "completed", conclusion: "skipped"}, {id: 4, name: "deploy", status: "completed", conclusion: "skipped"}]'
freigabe_laufen
erwarte "Exit 0" [ "$RC" -eq 0 ]
erwarte "Doku-PR erkannt (3 Dateien, Muster von main)" grep -q '^    reiner Doku-PR (3 Datei/en, Muster von main): Pflicht-Checks nur ziel-wache typen-und-tests' <<<"$AUSGABE"
erwarte "gemergt" grep -q '^pr merge ' "$D/calls.log"
aufraeumen

# Folge-PR (Eric 08.10.2026): Muster von der Basis, nicht vom lokalen Checkout und nicht vom PR-Head.
# Lokal (Skriptverzeichnis) gilt das volle Muster mit Bild-Endungen; die Basis kennt nur docs/ und *.md —
# ein Bild ausserhalb von docs/ ist dann Code. Ein Skript, das die lokale Datei liest, wuerde mergen.
fall_aufbauen "(Folge) Muster kommt von der Basis: Basis ohne Bild-Endungen, PR nur mit Bild ausserhalb docs/ -> Code-PR, uebersprungene Wegwerf-DB sperrt"
echo "deploy_main=gruen" > "$D/szenario"
basis_muster_setzen '^docs/|\.md$'
pr_dateien_setzen '[{filename: "apps/web/public/bild.png", status: "added"}]'
checks_setzen '[{id: 1, name: "ziel-wache", status: "completed", conclusion: "success"}, {id: 2, name: "typen-und-tests", status: "completed", conclusion: "success"},
                {id: 3, name: "wegwerf-db", status: "completed", conclusion: "skipped"}, {id: 4, name: "deploy", status: "completed", conclusion: "skipped"}]'
freigabe_laufen
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "kein Merge" bash -c "! grep -q '^pr merge ' '$D/calls.log'"
erwarte "Muster per API von der Basis gelesen" grep -q '^api repos/test/bhyo/contents/scripts/nur-doku-muster.txt?ref=main' "$D/calls.log"
erwarte "wegwerf-db=skipped genannt" grep -q '^ABBRUCH: Pflicht-Checks nicht gruen: wegwerf-db=completed/skipped' <<<"$AUSGABE"
aufraeumen

fall_aufbauen "(Folge) PR aendert die Musterdatei selbst: Code-PR, auch wenn das Basis-Muster alles als Doku faesst"
echo "deploy_main=gruen" > "$D/szenario"
basis_muster_setzen '.*'
pr_dateien_setzen '[{filename: "docs/eltern.md", status: "added"}, {filename: "scripts/nur-doku-muster.txt", status: "modified"}]'
checks_setzen '[{id: 1, name: "ziel-wache", status: "completed", conclusion: "success"}, {id: 2, name: "typen-und-tests", status: "completed", conclusion: "success"},
                {id: 3, name: "wegwerf-db", status: "completed", conclusion: "skipped"}, {id: 4, name: "deploy", status: "completed", conclusion: "skipped"}]'
freigabe_laufen
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "kein Merge" bash -c "! grep -q '^pr merge ' '$D/calls.log'"
erwarte "Musterdatei-Aenderung gemeldet" grep -q '^    PR aendert scripts/nur-doku-muster.txt — zaehlt als Code-PR' <<<"$AUSGABE"
aufraeumen

fall_aufbauen "(Folge) Muster in der Basis nicht lesbar: Code-PR (fail closed)"
echo "deploy_main=gruen" > "$D/szenario"
git -C "$T/work" checkout -q main && git -C "$T/work" rm -q scripts/nur-doku-muster.txt && git -C "$T/work" commit -q -m "ohne muster" && git -C "$T/work" push -q origin main
pr_dateien_setzen '[{filename: "docs/eltern.md", status: "added"}]'
checks_setzen '[{id: 1, name: "ziel-wache", status: "completed", conclusion: "success"}, {id: 2, name: "typen-und-tests", status: "completed", conclusion: "success"},
                {id: 3, name: "wegwerf-db", status: "completed", conclusion: "skipped"}, {id: 4, name: "deploy", status: "completed", conclusion: "skipped"}]'
freigabe_laufen
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "kein Merge" bash -c "! grep -q '^pr merge ' '$D/calls.log'"
aufraeumen

fall_aufbauen "(1b) Rot: Doku-PR mit einer Code-Datei ist kein Doku-PR — uebersprungene Wegwerf-DB sperrt"
echo "deploy_main=gruen" > "$D/szenario"
pr_dateien_setzen '[{filename: "docs/eltern.md", status: "added"}, {filename: "apps/web/lib/x.ts", status: "modified"}]'
checks_setzen '[{id: 1, name: "ziel-wache", status: "completed", conclusion: "success"}, {id: 2, name: "typen-und-tests", status: "completed", conclusion: "success"},
                {id: 3, name: "wegwerf-db", status: "completed", conclusion: "skipped"}, {id: 4, name: "deploy", status: "completed", conclusion: "success"}]'
freigabe_laufen
erwarte "Exit 1" [ "$RC" -eq 1 ]
erwarte "kein Merge" bash -c "! grep -q '^pr merge ' '$D/calls.log'"
erwarte "wegwerf-db=skipped genannt" grep -q '^ABBRUCH: Pflicht-Checks nicht gruen: wegwerf-db=completed/skipped' <<<"$AUSGABE"
aufraeumen

# ---------------------------------------------------------------- (f)
fall_aufbauen "(f) gestapelter PR: umgehaengt, nur Squash hineingemergt, Patch-ID gleich, gepusht"
echo "deploy_main=gruen" > "$D/szenario"
# Patch-ID vorher unabhaengig vom Skript gemessen: PR-Diff gegen den Baum des
# Eltern-Heads (= Basis-Baum, den der Squash uebernimmt).
vorher=$(git -C "$KLON" diff "origin/eltern" "origin/kind" | git patch-id --stable | cut -d' ' -f1)
freigabe_laufen
squash=$(squash_sha); neu=$(remote_ref kind)
erwarte "Exit 0" [ "$RC" -eq 0 ]
erwarte "Kind in (a) auf main umgehaengt (API-Aufruf)" grep -qx 'api -X PATCH repos/test/bhyo/pulls/11 -f base=main' "$D/calls.log"
erwarte "Umhaengen gemeldet" grep -q '^    gestapelter PR #11: Base eltern -> main umgehaengt' <<<"$AUSGABE"
erwarte "Kind-Head hat sich bewegt" [ "$neu" != "$KIND" ]
erwarte "neuer Head ist ein Merge mit genau zwei Eltern" bash -c "git -C '$REMOTE' rev-parse -q --verify '$neu^2' >/dev/null && ! git -C '$REMOTE' rev-parse -q --verify '$neu^3' >/dev/null"
erwarte "Elter 1 = alter Kind-Head" [ "$(git -C "$REMOTE" rev-parse "$neu^1")" = "$KIND" ]
erwarte "Elter 2 = Squash-Commit (nur main hineingemergt)" [ "$(git -C "$REMOTE" rev-parse "$neu^2")" = "$squash" ]
erwarte "kein weiterer Commit ausser dem Merge" [ "$(git -C "$REMOTE" rev-list --count "$neu" --not "$KIND" "$squash")" -eq 1 ]
nachher=$(git -C "$REMOTE" diff "$squash" "$neu" | git patch-id --stable | cut -d' ' -f1)
erwarte "Patch-ID vorher = nachher (eigene Messung)" [ "$vorher" = "$nachher" ]
erwarte "Skript meldet dieselbe Patch-ID" grep -q "^    #11 angeglichen: Patch-ID gleich ($vorher)" <<<"$AUSGABE"
erwarte "alter und neuer Head ausgegeben" bash -c "grep -q 'Head vorher  $KIND' <<<\"\$1\" && grep -q 'Head nachher $neu' <<<\"\$1\"" _ "$AUSGABE"
aufraeumen

# Konflikt: Eltern aendert dieselbe Zeile nach dem Abzweig noch einmal. Die
# Branch-Seite gewinnt mechanisch; der PR-Diff gegen den Basis-Baum enthielt
# diese Rueckaenderung schon vorher — Patch-ID gleich, Push, Konflikt gemeldet.
fall_aufbauen "(f) Konflikt mechanisch (Branch-Seite) aufgeloest, Patch-ID gleich: gepusht und gemeldet" konflikt
echo "deploy_main=gruen" > "$D/szenario"
vorher=$(git -C "$KLON" diff "origin/eltern" "origin/kind" | git patch-id --stable | cut -d' ' -f1)
freigabe_laufen
squash=$(squash_sha); neu=$(remote_ref kind)
erwarte "Exit 0" [ "$RC" -eq 0 ]
erwarte "Konflikt gemeldet" grep -q '^    #11: Konflikte mechanisch aufgeloest (Branch-Seite)' <<<"$AUSGABE"
erwarte "gepusht, Elter 2 = Squash" [ "$(git -C "$REMOTE" rev-parse "$neu^2")" = "$squash" ]
erwarte "Branch-Seite behalten (a.md = A)" [ "$(git -C "$REMOTE" show "$neu:docs/a.md")" = "A" ]
erwarte "Patch-ID vorher = nachher (eigene Messung)" [ "$vorher" = "$(git -C "$REMOTE" diff "$squash" "$neu" | git patch-id --stable | cut -d' ' -f1)" ]
aufraeumen

# Abweichung: Eltern legt nach dem Abzweig eine Datei an, die das Kind nicht
# kennt. Vorher enthaelt der PR-Diff deren Entfernung, nach dem sauberen Merge
# nicht mehr — Patch-ID ungleich, kein Push, Head bleibt.
fall_aufbauen "(f) Patch-ID weicht ab (Eltern-Commit mit neuer Datei nach dem Abzweig): kein Push, Head bleibt" neue_datei
echo "deploy_main=gruen" > "$D/szenario"
freigabe_laufen
erwarte "Exit 0 (Meldung, kein Abbruch)" [ "$RC" -eq 0 ]
erwarte "Kind-Head unveraendert" [ "$(remote_ref kind)" = "$KIND" ]
erwarte "NICHT gepusht gemeldet, Head genannt" grep -q "^    #11 NICHT gepusht: Patch-ID weicht ab .* Head bleibt $KIND" <<<"$AUSGABE"
aufraeumen

fall_aufbauen "(f) Basis-Baum entspricht main nicht (Squash-Baum weicht ab): kein Push"
printf 'deploy_main=gruen\nsquash_baum=abweichend\n' > "$D/szenario"
freigabe_laufen
erwarte "Exit 0 (Meldung, kein Abbruch)" [ "$RC" -eq 0 ]
erwarte "Kind-Head unveraendert" [ "$(remote_ref kind)" = "$KIND" ]
erwarte "Basis nicht belegbar gemeldet" grep -q '^    #11: Basis-Baum entspricht main nicht' <<<"$AUSGABE"
aufraeumen

echo
if (( FEHLER > 0 )); then
  echo "ROT: $FEHLER von $PRUEFUNGEN Pruefungen fehlgeschlagen ($SKRIPTE)"; exit 1
fi
echo "GRUEN: $PRUEFUNGEN Pruefungen bestanden ($SKRIPTE)"
