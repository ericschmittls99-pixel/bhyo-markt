#!/usr/bin/env bash
#
# freigabe.sh — der Freigabe-Ablauf als EIN Skript (Betriebs-PR, Eric 05.10.2026),
# nach der Befehlskette vom selben Tag, die nach einem gescheiterten Merge
# trotzdem migrate-production und Deploy ausgeloest hatte (Semikolon statt &&).
#
#   scripts/freigabe.sh <pr-nummer> <freigegebener-head-sha> "<merge-betreff>"
#
#   a) Pruefen: PR offen, Head = genannte SHA, MERGEABLE/CLEAN, alle Checks am
#      Head gruen. Ein abgebrochener (cancelled) Deploy-Lauf am Head wird EINMAL
#      neu gestartet und abgewartet. Offene PRs, deren Base dieser Branch ist,
#      werden auf main umgehaengt (sonst schliesst sie das Loeschen des
#      Branches). Pruefung und Merge macht merge-sicher.sh.
#   b) Merge (squash, --match-head-commit).
#   c) main steht auf dem Squash-Commit des PR.
#   d) Nur wenn der PR eine neue Migration enthaelt: migrate-production.yml
#      starten, abwarten, Zaehlbeweis (NOTICE-Zeilen) und Stand ausgeben.
#   e) Den Push-Deploy von main abwarten (sein schema-gate wartet auf d),
#      Jobs und Leseweg ausgeben, Links drucken. Bricht GitHub den Lauf ab
#      (Job „cancelled", z. B. kein Runner zugeteilt, 05.10.2026), wird er
#      EINMAL neu gestartet — wie in (a).
#   f) Die in (a) umgehaengten gestapelten PRs angleichen: main (Squash)
#      hineinmergen, Patch-ID des PR-Diffs vorher (gegen den Basis-Baum =
#      main-Baum, belegt) und nachher (main...HEAD) vergleichen. Gleich →
#      pushen und neuen Head ausgeben; ungleich oder Basis nicht belegbar →
#      melden, nicht pushen (Erics Ausnahme vom 06.10.2026).
#
# set -e: Jeder Fehlschlag bricht sofort ab, ohne Folgeschritte. Rot gezeigt:
# ein Abbruch in (a) startet keine Migration (Lauf im PR dokumentiert).
set -euo pipefail
PR="${1:-}"; SHA="${2:-}"; BETREFF="${3:-}"
if [[ -z "$PR" || -z "$SHA" || -z "$BETREFF" ]]; then
  echo "Nutzung: $0 <pr-nummer> <freigegebener-head-sha> \"<merge-betreff>\"" >&2
  exit 2
fi
HIER="$(cd "$(dirname "$0")" && pwd)"
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
URL="https://github.com/$REPO"

echo "==> (a) PR #$PR: Zustand und Head"
read -r state head < <(gh pr view "$PR" --json state,headRefOid --jq '"\(.state) \(.headRefOid)"')
if [[ "$state" != "OPEN" ]]; then
  echo "ABBRUCH: PR #$PR ist $state, nicht OPEN. Nichts gemergt, nichts migriert." >&2; exit 1
fi
if [[ "$head" != "$SHA"* ]]; then
  echo "ABBRUCH: Head ist ${head:0:7}, freigegeben wurde ${SHA:0:7}. Nichts gemergt, nichts migriert." >&2; exit 1
fi

# Abgebrochene Deploy-Laeufe am Head: einmal neu starten und abwarten.
abgebrochen=$(gh run list --commit "$head" --workflow deploy.yml --json databaseId,conclusion --jq '[.[] | select(.conclusion == "cancelled") | .databaseId] | join(" ")')
if [[ -n "$abgebrochen" ]]; then
  for lauf in $abgebrochen; do
    echo "    abgebrochener Lauf $lauf am Head — einmal neu starten: $URL/actions/runs/$lauf"
    gh run rerun "$lauf"
    gh run watch "$lauf" --exit-status >/dev/null || { echo "ABBRUCH: Neustart von Lauf $lauf nicht gruen. Nichts gemergt." >&2; exit 1; }
    echo "    Lauf $lauf nach Neustart gruen"
  done
fi

# Gestapelte PRs (Base = der Branch dieses PR) wuerden beim Loeschen des
# Branches geschlossen (#160 und #169 am 05.10.2026). Vor dem Merge auf main
# umhaengen und melden — der Branch faellt erst danach.
branch=$(gh pr view "$PR" --json headRefName --jq .headRefName)
main_vorher=$(gh api "repos/$REPO/branches/main" --jq .commit.sha)
gestapelt=$(gh pr list --base "$branch" --state open --json number --jq 'map(.number) | join(" ")')
if [[ -n "$gestapelt" ]]; then
  for kind in $gestapelt; do
    gh api -X PATCH "repos/$REPO/pulls/$kind" -f base=main >/dev/null
    echo "    gestapelter PR #$kind: Base $branch -> main umgehaengt"
  done
else
  echo "    keine gestapelten PRs auf $branch"
fi

echo "==> (b) Merge ueber merge-sicher.sh"
"$HIER/merge-sicher.sh" "$PR" "$head" "$BETREFF"

echo "==> (c) main steht auf dem Squash-Commit"
squash=$(gh pr view "$PR" --json mergeCommit --jq .mergeCommit.oid)
main=$(gh api "repos/$REPO/branches/main" --jq .commit.sha)
if [[ -z "$squash" || "$main" != "$squash" ]]; then
  echo "ABBRUCH: main steht auf ${main:0:7}, Squash-Commit des PR ist ${squash:0:7}. Keine Migration, kein Deploy ausgeloest." >&2; exit 1
fi
echo "    main = $squash"

# Einen Lauf eines Workflows am Commit finden (wartet bis zu 2 Minuten).
lauf_am_commit() { # <workflow-datei> <sha> [event]
  local wf="$1" sha="$2" ev="${3:-}" id="" i
  for i in $(seq 1 24); do
    id=$(gh run list --workflow "$wf" --commit "$sha" --limit 5 --json databaseId,event --jq "[.[] | select(\"$ev\" == \"\" or .event == \"$ev\") | .databaseId] | first // empty")
    [[ -n "$id" ]] && { echo "$id"; return 0; }
    sleep 5
  done
  return 1
}

echo "==> (d) Migration?"
migrationen=$(gh api --paginate "repos/$REPO/pulls/$PR/files" --jq '[.[] | select(.status == "added" and (.filename | test("^packages/db/migrations/[0-9]{4}_.*\\.sql$"))) | .filename] | join(" ")')
if [[ -n "$migrationen" ]]; then
  echo "    neue Migration(en): $migrationen"
  gh workflow run migrate-production.yml --ref main -f bestaetigung=production
  mig=$(lauf_am_commit migrate-production.yml "$squash") || { echo "ABBRUCH: migrate-production-Lauf nicht gefunden." >&2; exit 1; }
  echo "    migrate-production: $URL/actions/runs/$mig"
  gh run watch "$mig" --exit-status >/dev/null || { echo "ABBRUCH: migrate-production rot: $URL/actions/runs/$mig" >&2; exit 1; }
  echo "    Zaehlbeweis:"
  gh run view "$mig" --log | grep -a "message: '\|Angewendet:\|VOR_DROP\|Vor-DROP" | sed 's/.*\t//' | sed 's/^/      /' || true
else
  echo "    keine neue Migration im PR — migrate-production entfaellt"
fi

echo "==> (e) Deploy von main (Push-Lauf) und Leseweg"
dep=$(lauf_am_commit deploy.yml "$squash" push) || { echo "ABBRUCH: Push-Deploy fuer $squash nicht gefunden." >&2; exit 1; }
echo "    deploy: $URL/actions/runs/$dep"
if ! gh run watch "$dep" --exit-status >/dev/null; then
  # Von GitHub abgebrochen (Runner nicht zugeteilt, Actions-Stoerung) ist kein
  # Codefehler: einmal neu starten, dann erst urteilen.
  abgebrochen=$(gh run view "$dep" --json jobs --jq '[.jobs[] | select(.conclusion == "cancelled")] | length')
  if (( abgebrochen > 0 )); then
    echo "    Lauf $dep von GitHub abgebrochen ($abgebrochen Job/s) — einmal neu starten"
    gh run rerun "$dep" --failed
    sleep 20
    gh run watch "$dep" --exit-status >/dev/null || { echo "ABBRUCH: Deploy nach Neustart rot: $URL/actions/runs/$dep" >&2; exit 1; }
    echo "    Lauf $dep nach Neustart gruen"
  else
    echo "ABBRUCH: Deploy rot: $URL/actions/runs/$dep" >&2; exit 1
  fi
fi
gh run view "$dep" --json jobs --jq '.jobs[] | "    \(.name): \(.conclusion)"'
# Das Log ist nach dem Ende des Laufs nicht sofort abrufbar — kurz nachfassen.
for i in $(seq 1 6); do
  if leseweg=$(gh run view "$dep" --log 2>/dev/null | grep -a "Leseweg OK\|AKTEUR {\|JOB_LAUF"); then
    printf '%s\n' "$leseweg" | sed 's/.*\t//' | sed 's/^/      /'; break
  fi
  sleep 10
done
echo "FERTIG: PR #$PR gemergt ($squash), migriert=$([[ -n "$migrationen" ]] && echo ja || echo nein), Deploy $URL/actions/runs/$dep"

# (f) Gestapelte PRs angleichen — nach dem Squash konfliktieren sie auf GitHub,
# weil Squash und Branch dieselben Zeilen aendern. Nachweis je PR: Patch-ID
# des PR-Diffs gegen den Basis-Baum (= Baum des gemergten Heads auf dem
# main-Stand vor dem Merge; muss dem neuen main-Baum entsprechen) vorher und
# gegen main...HEAD nachher. Konflikte nur mechanisch (-X ours = Branch-Seite),
# die Patch-ID belegt die Unversehrtheit. Alles in einem Wegwerf-Worktree.
if [[ -n "$gestapelt" ]]; then
  echo "==> (f) Gestapelte PRs angleichen (Patch-ID)"
  git fetch -q origin
  for kind in $gestapelt; do
    read -r khead kbranch < <(gh pr view "$kind" --json headRefOid,headRefName --jq '"\(.headRefOid) \(.headRefName)"')
    git fetch -q origin "$kbranch"
    if ! basis=$(git merge-tree --write-tree "$main_vorher" "$head" 2>/dev/null); then
      echo "    #$kind: Basis-Baum nicht konfliktfrei herleitbar — nicht angeglichen, von Hand pruefen"; continue
    fi
    if [[ -n "$(git diff --stat "$basis" "$squash")" ]]; then
      echo "    #$kind: Basis-Baum entspricht main nicht — nicht angeglichen, von Hand pruefen"; continue
    fi
    vorher=$(git diff "$basis" "$khead" | git patch-id --stable | cut -d' ' -f1)
    tmp=$(mktemp -d)
    git worktree add -q "$tmp" "$khead"
    if ! git -C "$tmp" merge --no-edit "$squash" >/dev/null 2>&1; then
      git -C "$tmp" merge --abort >/dev/null 2>&1 || true
      git -C "$tmp" merge --no-edit -X ours "$squash" >/dev/null 2>&1 || { echo "    #$kind: Merge auch mit -X ours nicht moeglich — von Hand pruefen"; git worktree remove --force "$tmp"; continue; }
      echo "    #$kind: Konflikte mechanisch aufgeloest (Branch-Seite)"
    fi
    neu=$(git -C "$tmp" rev-parse HEAD)
    nachher=$(git -C "$tmp" diff "$squash...HEAD" | git patch-id --stable | cut -d' ' -f1)
    if [[ "$vorher" == "$nachher" ]]; then
      git -C "$tmp" push -q origin "HEAD:refs/heads/$kbranch"
      echo "    #$kind angeglichen: Patch-ID gleich ($vorher)"
      echo "      Head vorher  $khead"
      echo "      Head nachher $neu"
    else
      echo "    #$kind NICHT gepusht: Patch-ID weicht ab (vorher $vorher, nachher $nachher) — von Hand pruefen, Head bleibt $khead"
    fi
    git worktree remove --force "$tmp"
  done
fi
