#!/usr/bin/env bash
# Runs a test command; if it fails, repeats the failing lines as one GitHub annotation, so they show
# on the run's summary page (the full log isn't always at hand, and GitHub shows at most 10 annotations).
#   tools/ci/annotate.sh npm run test:ops
log=$(mktemp)
"$@" 2>&1 | tee "$log"; code=${PIPESTATUS[0]}
if [ "$code" != 0 ]; then
  lines=$(grep -E "not ok |✗ FAIL|TEST CRASH|AssertionError|Error:|PERMISSION_DENIED|evaluation error|for '(create|update|delete)'|expected|actual:|FAILED" "$log" | grep -vE "^\s*at |node_modules" | head -80)
  msg=$(printf '%s\n' "$lines" | sed 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}')
  echo "::error title=Failing tests::${msg}"
  printf '%s\n' "$lines" | tail -8 | while IFS= read -r l; do echo "::error::${l//%/%25}"; done
fi
exit "$code"
