#!/usr/bin/env bash
set -euo pipefail

# Run the same checks CI does. Docker is required for end-to-end tests.
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
cd "$ROOT_DIR"

npm run lint
npm run typecheck
npm test
npm run test:e2e
