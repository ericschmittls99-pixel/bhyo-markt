#!/usr/bin/env bash
#
# fake-gh.sh — Attrappe fuer `gh`, nur fuer scripts/tests/freigabe-test.sh.
#
# freigabe.sh und merge-sicher.sh sprechen mit GitHub ausschliesslich ueber
# `gh`. Diese Attrappe beantwortet dieselben Aufrufe aus Dateien in
# $FAKE_GH_DIR und fuehrt den Squash-Merge echt in einem lokalen Bare-Repo
# aus — so laufen (c) bis (f) gegen echte Git-Objekte, ohne Production.
#
#   $FAKE_GH_DIR/remote      Pfad des Bare-Repos (origin der Testklone)
#   $FAKE_GH_DIR/prs.json    {"<nr>": {state, headRefOid, headRefName,
#                             baseRefName, mergeable, mergeStateStatus,
#                             mergeCommit, files}}
#   $FAKE_GH_DIR/runs.json   [{databaseId, workflow, commit, event,
#                             conclusion, jobs: [{name, conclusion}]}]
#   $FAKE_GH_DIR/checks.json {"<sha>": [{name, status, conclusion}]}
#   $FAKE_GH_DIR/szenario    key=value je Zeile:
#       deploy_main = gruen | cancelled_dann_gruen | cancelled_bleibt | rot
#                     Ausgang des Push-Deploys, den der Squash ausloest
#       squash_baum = head | abweichend
#                     abweichend: Squash-Baum ≠ Baum des PR-Heads (Basis-Beleg)
#   $FAKE_GH_DIR/calls.log   jeder Aufruf, eine Zeile — die Tests zaehlen darin
#                             z. B. die Neustarts.
set -euo pipefail
D="${FAKE_GH_DIR:?FAKE_GH_DIR fehlt}"
printf '%s\n' "$*" >> "$D/calls.log"
REMOTE=$(cat "$D/remote")

szenario() { grep "^$1=" "$D/szenario" 2>/dev/null | cut -d= -f2- || true; }

# Optionen mit Wert, Flags ohne Wert, Rest positional. Keine assoziativen
# Arrays: macOS liefert bash 3.2, die Tests sollen auch dort laufen.
O_JQ=""; O_WORKFLOW=""; O_COMMIT=""; O_BASE=""; O_MATCH=""; O_SUBJECT=""; O_X=""; O_F=""; F_LOG=""
POS=()
while (($#)); do
  case "$1" in
    --jq) O_JQ="$2"; shift 2 ;;
    --workflow) O_WORKFLOW="$2"; shift 2 ;;
    --commit) O_COMMIT="$2"; shift 2 ;;
    --base) O_BASE="$2"; shift 2 ;;
    --match-head-commit) O_MATCH="$2"; shift 2 ;;
    --subject) O_SUBJECT="$2"; shift 2 ;;
    -X) O_X="$2"; shift 2 ;;
    -f) O_F="$O_F${O_F:+ }$2"; shift 2 ;;
    --json|--limit|--state|--ref) shift 2 ;;
    --log) F_LOG=1; shift ;;
    -*) shift ;;
    *) POS+=("$1"); shift ;;
  esac
done
ausgabe() { if [[ -n "$O_JQ" ]]; then jq -r "$O_JQ"; else cat; fi; }
pr_json() { jq ".\"$1\"" "$D/prs.json"; }
pr_setzen() { # <nr> <jq-zuweisung>
  local neu; neu=$(jq ".\"$1\" |= ($2)" "$D/prs.json"); printf '%s\n' "$neu" > "$D/prs.json"
}
run_setzen() { # <id> <jq-zuweisung>
  local neu; neu=$(jq "map(if .databaseId == $1 then ($2) else . end)" "$D/runs.json"); printf '%s\n' "$neu" > "$D/runs.json"
}

case "${POS[0]:-} ${POS[1]:-}" in
  "repo view") echo '{"nameWithOwner":"test/bhyo"}' | ausgabe ;;

  "pr view") pr_json "${POS[2]}" | ausgabe ;;

  "pr list")
    jq --arg b "$O_BASE" '[.[] | select(.state == "OPEN" and ($b == "" or .baseRefName == $b)) | {number: (.number)}]' "$D/prs.json" | ausgabe ;;

  "pr merge")
    nr="${POS[2]}"
    head=$(pr_json "$nr" | jq -r .headRefOid)
    if [[ -n "$O_MATCH" && "$O_MATCH" != "$head" ]]; then
      echo "fake-gh: Head $head entspricht nicht --match-head-commit" >&2; exit 1
    fi
    main=$(git -C "$REMOTE" rev-parse refs/heads/main)
    if [[ "$(szenario squash_baum)" == "abweichend" ]]; then
      blob=$(echo "abweichung" | git -C "$REMOTE" hash-object -w --stdin)
      tree=$( { git -C "$REMOTE" ls-tree "$head"; printf '100644 blob %s\tabweichung.txt\n' "$blob"; } | git -C "$REMOTE" mktree)
    else
      tree=$(git -C "$REMOTE" rev-parse "$head^{tree}")
    fi
    squash=$(git -C "$REMOTE" commit-tree "$tree" -p "$main" -m "${O_SUBJECT:-squash}")
    git -C "$REMOTE" update-ref refs/heads/main "$squash"
    pr_setzen "$nr" ".state = \"MERGED\" | .mergeCommit = {oid: \"$squash\"}"
    case "$(szenario deploy_main)" in
      cancelled_dann_gruen|cancelled_bleibt) c=cancelled ;;
      rot) c=failure ;;
      *) c=success ;;
    esac
    neu=$(jq ". + [{databaseId: 9001, workflow: \"deploy.yml\", commit: \"$squash\", event: \"push\", conclusion: \"$c\", jobs: [{name: \"deploy\", conclusion: \"$c\"}]}]" "$D/runs.json")
    printf '%s\n' "$neu" > "$D/runs.json"
    echo "✓ Squashed and merged pull request #$nr" ;;

  "api "*)
    pfad="${POS[1]}"
    case "${O_X:-GET} $pfad" in
      "DELETE "*) exit 0 ;;
      "PATCH repos/"*/pulls/*)
        nr="${pfad##*/}"; base="${O_F#base=}"
        pr_setzen "$nr" ".baseRefName = \"$base\""; echo '{}' ;;
      "GET "*/branches/main)
        printf '{"commit":{"sha":"%s"}}\n' "$(git -C "$REMOTE" rev-parse refs/heads/main)" | ausgabe ;;
      "GET "*/pulls/*/files)
        nr=$(sed -E 's#.*/pulls/([0-9]+)/files#\1#' <<<"$pfad"); pr_json "$nr" | jq .files | ausgabe ;;
      "GET "*/commits/*/check-runs)
        sha=$(sed -E 's#.*/commits/([0-9a-f]+)/check-runs#\1#' <<<"$pfad")
        jq "{check_runs: (.\"$sha\" // [])}" "$D/checks.json" | ausgabe ;;
      *) echo "fake-gh: unbekannter api-Aufruf: $*" >&2; exit 1 ;;
    esac ;;

  "run list")
    jq --arg wf "$O_WORKFLOW" --arg c "$O_COMMIT" \
      '[.[] | select(($wf == "" or .workflow == $wf) and ($c == "" or .commit == $c))]' "$D/runs.json" | ausgabe ;;

  "run watch")
    c=$(jq -r ".[] | select(.databaseId == ${POS[2]}) | .conclusion" "$D/runs.json")
    [[ "$c" == "success" ]] ;;

  "run rerun")
    # Der Neustart aendert den Ausgang nur, wenn das Szenario es vorsieht.
    if [[ "$(szenario deploy_main)" == "cancelled_dann_gruen" ]]; then
      run_setzen "${POS[2]}" '.conclusion = "success" | .jobs = [{name: "deploy", conclusion: "success"}]'
    fi ;;

  "run view")
    if [[ -n "$F_LOG" ]]; then
      printf 'deploy\tlese-diagnose\t2026-10-06T00:00:00Z Leseweg OK (Attrappe)\n'
    else
      jq ".[] | select(.databaseId == ${POS[2]})" "$D/runs.json" | ausgabe
    fi ;;

  "workflow run") exit 0 ;;

  *) echo "fake-gh: unbekannter Aufruf: $*" >&2; exit 1 ;;
esac
