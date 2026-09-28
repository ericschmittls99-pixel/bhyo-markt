#!/usr/bin/env bash
#
# merge-sicher.sh — der einzige Weg, einen PR zu mergen (Regel Eric, 28.09.2026,
# nach dem Merge von #101 bei mergeStateStatus UNKNOWN).
#
#   scripts/merge-sicher.sh <pr-nummer> <gepruefter-head-sha> "<merge-betreff>"
#
# 1. Wartet, bis GitHub mergeable=MERGEABLE und mergeStateStatus=CLEAN meldet:
#    alle 10 s, hoechstens 5 Minuten. CONFLICTING, BLOCKED, DIRTY oder
#    Zeitueberschreitung brechen ab — es wird nie gemergt.
# 2. Unmittelbar vor dem Merge: Head-SHA ist noch der geprueft uebergebene, und
#    dort existiert mindestens ein Check-Lauf, alle abgeschlossen, keiner rot.
#    "Kein Lauf" ist kein Ergebnis.
# 3. Merge (squash, Branch loeschen) mit --match-head-commit <sha>: Ein Push
#    zwischen Pruefung und Merge laesst den Merge scheitern.
set -euo pipefail

PR="${1:-}"; SHA="${2:-}"; BETREFF="${3:-}"
if [[ -z "$PR" || -z "$SHA" || -z "$BETREFF" ]]; then
  echo "Nutzung: $0 <pr-nummer> <gepruefter-head-sha> \"<merge-betreff>\"" >&2
  exit 2
fi
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

echo "==> PR #$PR: warte auf MERGEABLE/CLEAN (alle 10 s, max. 5 min)"
deadline=$((SECONDS + 300))
while :; do
  read -r mergeable status head < <(gh pr view "$PR" --json mergeable,mergeStateStatus,headRefOid --jq '"\(.mergeable) \(.mergeStateStatus) \(.headRefOid)"')
  echo "    mergeable=$mergeable status=$status head=${head:0:7}"
  case "$mergeable/$status" in
    MERGEABLE/CLEAN) break ;;
    # UNSTABLE = mindestens ein Check rot: sofort zur Check-Pruefung, die
    # den roten Lauf beim Namen nennt und abbricht.
    MERGEABLE/UNSTABLE) echo "    Checks nicht gruen (UNSTABLE) — pruefe die Laeufe"; break ;;
    CONFLICTING/*|*/BLOCKED|*/DIRTY)
      echo "ABBRUCH: PR #$PR ist $mergeable/$status — nicht gemergt." >&2; exit 1 ;;
  esac
  if (( SECONDS >= deadline )); then
    echo "ABBRUCH: PR #$PR nach 5 Minuten nicht MERGEABLE/CLEAN (zuletzt $mergeable/$status) — nicht gemergt." >&2; exit 1
  fi
  sleep 10
done

echo "==> Head-SHA pruefen"
head=$(gh pr view "$PR" --json headRefOid --jq .headRefOid)
if [[ "$head" != "$SHA"* ]]; then
  echo "ABBRUCH: Head ist ${head:0:7}, geprueft wurde ${SHA:0:7} — zwischenzeitlicher Push. Nicht gemergt." >&2; exit 1
fi

echo "==> Check-Laeufe am Head $head"
laeufe=$(gh api "repos/$REPO/commits/$head/check-runs" --jq '.check_runs | map("\(.name)=\(.status)/\(.conclusion)") | join(" ")')
anzahl=$(gh api "repos/$REPO/commits/$head/check-runs" --jq '.check_runs | length')
echo "    $anzahl Lauf/Laeufe: $laeufe"
if (( anzahl == 0 )); then
  echo "ABBRUCH: kein Check-Lauf am Head — kein Ergebnis ist kein Ergebnis. Nicht gemergt." >&2; exit 1
fi
offen=$(gh api "repos/$REPO/commits/$head/check-runs" --jq '[.check_runs[] | select(.status != "completed")] | length')
rot=$(gh api "repos/$REPO/commits/$head/check-runs" --jq '[.check_runs[] | select(.status == "completed" and (.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral"))] | map(.name) | join(", ")')
if (( offen > 0 )); then
  echo "ABBRUCH: $offen Lauf/Laeufe noch nicht abgeschlossen. Nicht gemergt." >&2; exit 1
fi
if [[ -n "$rot" ]]; then
  echo "ABBRUCH: rote Checks am Head: $rot. Nicht gemergt." >&2; exit 1
fi

echo "==> Merge (squash, --match-head-commit ${head:0:7})"
gh pr merge "$PR" --squash --delete-branch --match-head-commit "$head" --subject "$BETREFF"
echo "GEMERGT: PR #$PR bei ${head:0:7}"
