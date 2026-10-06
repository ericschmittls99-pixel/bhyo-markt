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
  mkdir -p "$w/docs"; echo start > "$w/docs/a.md"
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
    "10": {number: 10, state: "OPEN", headRefOid: $e, headRefName: "eltern", baseRefName: "main",
           mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", mergeCommit: null,
           files: [{filename: "docs/eltern.md", status: "added"}]},
    "11": {number: 11, state: "OPEN", headRefOid: $k, headRefName: "kind", baseRefName: "eltern",
           mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", mergeCommit: null,
           files: [{filename: "docs/kind.md", status: "added"}]}}' > "$D/prs.json"
  jq -n --arg e "$ELTERN" '[{databaseId: 100, workflow: "deploy.yml", commit: $e, event: "pull_request", conclusion: "success", jobs: []}]' > "$D/runs.json"
  jq -n --arg e "$ELTERN" '{($e): [{name: "typen-und-tests", status: "completed", conclusion: "success"}]}' > "$D/checks.json"
  echo "==> Fall: $1"
}

freigabe_laufen() { # fuehrt freigabe.sh im Klon aus; RC und AUSGABE
  set +e
  mkdir -p "$T/bin" && ln -sf "$HIER/fake-gh.sh" "$T/bin/gh"
  AUSGABE=$(cd "$KLON" && PATH="$T/bin:$PATH" FAKE_GH_DIR="$D" "$SKRIPTE/freigabe.sh" 10 "$ELTERN" "Eltern-Merge" 2>&1)
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
erwarte "rote Checks genannt" grep -q '^ABBRUCH: rote Checks am Head' <<<"$AUSGABE"
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
