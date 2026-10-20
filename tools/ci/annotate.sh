#!/usr/bin/env bash
# Runs a test command; if it fails, repeats the failing lines as GitHub annotations, so they show
# on the run's summary page (the full log isn't always at hand).
#   tools/ci/annotate.sh npm run test:ops
log=$(mktemp)
"$@" 2>&1 | tee "$log"; code=${PIPESTATUS[0]}
if [ "$code" != 0 ]; then
  grep -E "not ok |✗ FAIL|TEST CRASH|AssertionError|Error:|expected|actual:|FAILED" "$log" | grep -vE "^\s*at |node_modules" | head -20 | while IFS= read -r l; do echo "::error::${l//%/%25}"; done
fi
exit "$code"
