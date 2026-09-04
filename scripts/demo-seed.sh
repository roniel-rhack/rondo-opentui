#!/usr/bin/env bash
# Fills a throwaway RonDO profile with believable data for the VHS demo.
#
#   RONDO_HOME=/tmp/rondo-demo scripts/demo-seed.sh
#
# Dates are relative to today so the demo always shows a mix of overdue,
# due-today and upcoming tasks.
set -euo pipefail

BIN="${RONDO_BIN:-./dist/rondo-opentui}"
: "${RONDO_HOME:?set RONDO_HOME to a throwaway directory}"

if [ -d "$RONDO_HOME" ] && [ -n "$(find "$RONDO_HOME" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "Use an empty throwaway RONDO_HOME directory" >&2
  exit 1
fi
mkdir -p "$RONDO_HOME"

# BSD (macOS) and GNU date take different flags for relative days.
day() {
  if date -v+1d >/dev/null 2>&1; then
    date -v"$1"d +%Y-%m-%d
  else
    date -d "$1 days" +%Y-%m-%d
  fi
}

add() { "$BIN" --quiet add "$@"; }

id_fix=$(add "Fix login timeout bug" --priority urgent --due "$(day -3)" \
  --tags bug,auth --desc "Sessions expire after **5 minutes** instead of 30.

- Reproduced on staging
- Suspect \`refreshToken\` clock skew")
id_landing=$(add "Build the landing page" --priority high --due "$(day +0)" \
  --tags frontend,design --desc "Marketing site for the 2.0 launch.")
id_search=$(add "Implement search" --priority high --due "$(day +2)" --tags feature)
id_docs=$(add "Write the API documentation" --due "$(day +9)" --tags docs)
id_review=$(add "Weekly review" --recur weekly --tags planning)
id_deps=$(add "Update dependencies" --tags maintenance)
id_ci=$(add "Set up CI/CD pipeline" --priority medium --due "$(day -8)" --tags devops)

"$BIN" --quiet subtask add "$id_fix" "Reproduce on staging" >/dev/null
"$BIN" --quiet subtask add "$id_fix" "Patch the token TTL" >/dev/null
"$BIN" --quiet subtask add "$id_fix" "Add a regression test" >/dev/null
"$BIN" --quiet subtask done "$id_fix" 1 >/dev/null

"$BIN" --quiet subtask add "$id_landing" "Wireframes" >/dev/null
"$BIN" --quiet subtask add "$id_landing" "Responsive grid" >/dev/null
"$BIN" --quiet subtask add "$id_landing" "Dark mode" >/dev/null
"$BIN" --quiet subtask done "$id_landing" 4 >/dev/null
"$BIN" --quiet subtask done "$id_landing" 5 >/dev/null

"$BIN" --quiet subtask add "$id_search" "Index the tasks table" >/dev/null
"$BIN" --quiet subtask add "$id_search" "Fuzzy matcher" >/dev/null

"$BIN" --quiet note add "$id_fix" "Ops confirmed the TTL is wrong in the prod config." >/dev/null
"$BIN" --quiet timelog add "$id_fix" 1h30m --note "debugging" >/dev/null
"$BIN" --quiet timelog add "$id_landing" 45m --note "wireframes" >/dev/null

"$BIN" --quiet status "$id_fix" active >/dev/null
"$BIN" --quiet status "$id_search" active >/dev/null
"$BIN" --quiet done "$id_deps" >/dev/null

"$BIN" --quiet focus start --task-id "$id_fix" --duration 25m >/dev/null

"$BIN" --quiet journal add --date "$(day -1)" \
  "Paired on the auth bug. The token TTL is coming from the wrong config key." >/dev/null
"$BIN" --quiet journal add "Landing page wireframes are done — starting the responsive grid." >/dev/null

echo "Seeded $RONDO_HOME"
