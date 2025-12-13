#!/usr/bin/env bash
set -euo pipefail

TEST_DIR="dist/tests/e2e"

skip_e2e() {
  echo "$1"
  exit 0
}

if [[ ! -d "$TEST_DIR" ]]; then
  skip_e2e "No e2e tests found; skipping."
fi

if [[ "${SKIP_E2E_DOCKER:-false}" == "true" ]]; then
  skip_e2e "SKIP_E2E_DOCKER=true; skipping e2e suite."
fi

if ! command -v docker >/dev/null 2>&1; then
  skip_e2e "Docker CLI not available; skipping e2e suite."
fi

if ! docker info >/dev/null 2>&1; then
  skip_e2e "Docker daemon unavailable; skipping e2e suite."
fi

mapfile -t TEST_FILES < <(find "$TEST_DIR" -type f \( -name "*.test.js" -o -name "*.spec.js" \) -print)

if [[ ${#TEST_FILES[@]} -eq 0 ]]; then
  skip_e2e "No e2e tests found; skipping."
fi

echo "Running e2e tests:"
for file in "${TEST_FILES[@]}"; do
  echo " - $file"
done

node --test "${TEST_FILES[@]}"
