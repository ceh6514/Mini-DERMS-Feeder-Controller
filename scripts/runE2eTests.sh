#!/usr/bin/env bash
set -euo pipefail

TEST_DIR="dist/tests/e2e"

if [[ ! -d "$TEST_DIR" ]]; then
  echo "No e2e tests found; skipping."
  exit 0
fi

mapfile -t TEST_FILES < <(find "$TEST_DIR" -type f \( -name "*.test.js" -o -name "*.spec.js" \) -print)

if [[ ${#TEST_FILES[@]} -eq 0 ]]; then
  echo "No e2e tests found; skipping."
  exit 0
fi

echo "Running e2e tests:"
for file in "${TEST_FILES[@]}"; do
  echo " - $file"
done

node --test "${TEST_FILES[@]}"
