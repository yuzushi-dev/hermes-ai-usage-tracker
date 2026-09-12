#!/usr/bin/env bash
# Readiness report for the ai-usage-tracker catalog PR. Reports only — never opens it.
#
# The catalog requires the pinned release to be >= 2 weeks old at pin time, so this
# exists to prove eligibility (and that the staged fork branch is intact) before a
# human or agent opens the PR.
set -uo pipefail

UPSTREAM="NousResearch/hermes-agent"
FORK="lvabarajithan/hermes-agent"
BRANCH="add-ai-usage-tracker"
ENTRY_PATH="plugin-catalog/ai-usage-tracker.yaml"
PIN_SHA="98010ea3fb2ce037cc5889bc4787e0152da69745"
PIN_DATE="2026-09-12T17:53:20Z"   # v1.0.1 commit time (UTC)

echo "== pin =="
echo "sha:          $PIN_SHA"
echo "committed:    $PIN_DATE"
AGE=$(python3 - "$PIN_DATE" <<'PY'
import datetime, sys
d = datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00"))
print(f"{(datetime.datetime.now(datetime.timezone.utc) - d).total_seconds() / 86400:.2f}")
PY
)
echo "age (days):   $AGE"
if python3 -c "import sys; sys.exit(0 if float('$AGE') >= 14 else 1)"; then
  echo "PIN_MATURITY: OK (>= 14 days)"
else
  echo "PIN_MATURITY: NOT YET (needs 14 days)"
fi

echo
echo "== existing PR =="
if EXISTING=$(gh pr list --repo "$UPSTREAM" --head "lvabarajithan:$BRANCH" --state all \
      --json url,state --jq '.[] | "\(.state)\t\(.url)"' 2>/dev/null) && [ -n "$EXISTING" ]; then
  echo "$EXISTING"
else
  echo "none"
fi

echo
echo "== staged branch =="
echo -n "branch exists:  "
gh api "repos/$FORK/branches/$BRANCH" --jq '.name' 2>/dev/null || echo "MISSING"
echo -n "entry on branch: "
gh api "repos/$FORK/contents/$ENTRY_PATH?ref=$BRANCH" --jq '.sha' 2>/dev/null || echo "MISSING"
echo -n "entry pins:     "
gh api "repos/$FORK/contents/$ENTRY_PATH?ref=$BRANCH" --jq '.content' 2>/dev/null \
  | base64 -d | grep '^sha:' || echo "unknown"
echo -n "vs upstream:    "
gh api "repos/$FORK/compare/main...$BRANCH" \
  --jq '"ahead=\(.ahead_by) behind=\(.behind_by) files=\([.files[].filename] | join(","))"' 2>/dev/null \
  || echo "compare unavailable"

echo
echo "== gh auth =="
gh auth status 2>&1 | grep -E "Logged in|account" | head -2 || echo "not authenticated"
