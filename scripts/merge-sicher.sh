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
HIER="$(cd "$(dirname "$0")" && pwd)"

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
# CI-Diaet (Betriebs-PR 3, 08.10.2026): je Check-Namen zaehlt nur der JUENGSTE
# Lauf (hoechste id). Ein ueberholter PR-Lauf wird jetzt abgebrochen und
# hinterlaesst „cancelled"-Checks am selben Head — die duerfen den Merge
# nicht sperren, solange der juengere Lauf desselben Checks gruen ist.
# „Kein Ergebnis ist kein Ergebnis" bleibt: ohne Check-Lauf kein Merge.
checks=$(gh api "repos/$REPO/commits/$head/check-runs" --jq '.check_runs | group_by(.name) | map(max_by(.id // 0))')
laeufe=$(jq -r 'map("\(.name)=\(.status)/\(.conclusion)") | join(" ")' <<<"$checks")
anzahl=$(jq -r 'length' <<<"$checks")
echo "    $anzahl Lauf/Laeufe (je Name der juengste): $laeufe"
if (( anzahl == 0 )); then
  echo "ABBRUCH: kein Check-Lauf am Head — kein Ergebnis ist kein Ergebnis. Nicht gemergt." >&2; exit 1
fi
# Pflicht-Checks (Eric 08.10.2026, 1b): ist der juengste Lauf eines
# Pflicht-Checks cancelled, skipped oder fehlt er, ist er nicht gruen. Ein
# reiner Doku-PR (scripts/nur-doku-muster.txt — dasselbe Muster liest
# deploy.yml) laeuft ohne Wegwerf-DB und Deploy; dort sind nur ziel-wache und
# typen-und-tests Pflicht. Alle uebrigen Checks: nur success oder skipped.
# Folge-PR (Eric 08.10.2026): das Muster kommt von der BASIS des PR ueber die
# API — nicht aus dem lokalen Checkout (koennte veraltet sein) und nicht vom
# PR-Head (koennte sich selbst einstufen). Aendert der PR die Musterdatei
# selbst, ist er ein Code-PR. Ist das Muster nicht lesbar: Code-PR (fail closed).
basis=$(gh pr view "$PR" --json baseRefName --jq .baseRefName)
muster=$(gh api "repos/$REPO/contents/scripts/nur-doku-muster.txt?ref=$basis" --jq .content 2>/dev/null | base64 -d | grep -v '^#' | head -1 || true)
dateien=$(gh api --paginate "repos/$REPO/pulls/$PR/files" --jq '.[].filename')
anzahl_dateien=$(printf '%s\n' "$dateien" | grep -c . || true)
doku=0
[[ -n "$muster" ]] && doku=$(printf '%s\n' "$dateien" | grep -cE "$muster" || true)
musterdatei=$(printf '%s\n' "$dateien" | grep -cx 'scripts/nur-doku-muster.txt' || true)
pflicht="ziel-wache typen-und-tests wegwerf-db deploy"
if (( anzahl_dateien > 0 && doku == anzahl_dateien && musterdatei == 0 )); then
  pflicht="ziel-wache typen-und-tests"
  echo "    reiner Doku-PR ($anzahl_dateien Datei/en, Muster von $basis): Pflicht-Checks nur $pflicht"
elif (( musterdatei > 0 )); then
  echo "    PR aendert scripts/nur-doku-muster.txt — zaehlt als Code-PR"
fi
fehlend=""
for name in $pflicht; do
  stand=$(jq -r --arg n "$name" '[.[] | select(.name == $n)] | first | if . == null then "fehlt" else "\(.status)/\(.conclusion)" end' <<<"$checks")
  [[ "$stand" == "completed/success" ]] || fehlend="$fehlend $name=$stand"
done
if [[ -n "$fehlend" ]]; then
  echo "ABBRUCH: Pflicht-Checks nicht gruen:$fehlend. Nicht gemergt." >&2; exit 1
fi
offen=$(jq -r '[.[] | select(.status != "completed")] | length' <<<"$checks")
rot=$(jq -r '[.[] | select(.status == "completed" and (.conclusion != "success" and .conclusion != "skipped"))] | map(.name) | join(", ")' <<<"$checks")
if (( offen > 0 )); then
  echo "ABBRUCH: $offen Lauf/Laeufe noch nicht abgeschlossen. Nicht gemergt." >&2; exit 1
fi
if [[ -n "$rot" ]]; then
  echo "ABBRUCH: rote Checks am Head: $rot. Nicht gemergt." >&2; exit 1
fi

echo "==> Merge (squash, --match-head-commit ${head:0:7})"
# Ohne --delete-branch: Am 06.10.2026 (#181) scheiterte gh nach dem Merge am
# lokalen Loeschen (Branch in einem Worktree ausgecheckt), lieferte Exit 1 und
# freigabe.sh brach vor Migration und Deploy ab. Der Merge ist der Punkt ohne
# Wiederkehr — danach darf nichts mehr abbrechen, das Loeschen ist Aufraeumen.
branch=$(gh pr view "$PR" --json headRefName --jq .headRefName)
gh pr merge "$PR" --squash --match-head-commit "$head" --subject "$BETREFF"
echo "GEMERGT: PR #$PR bei ${head:0:7}"
gh api -X DELETE "repos/$REPO/git/refs/heads/$branch" >/dev/null 2>&1 \
  && echo "    Remote-Branch $branch geloescht" \
  || echo "    Hinweis: Remote-Branch $branch nicht geloescht (schon weg oder von GitHub automatisch geloescht)"
git branch -D "$branch" >/dev/null 2>&1 \
  && echo "    lokaler Branch $branch geloescht" \
  || echo "    Hinweis: lokaler Branch $branch nicht geloescht (nicht vorhanden oder in einem Worktree ausgecheckt)"
