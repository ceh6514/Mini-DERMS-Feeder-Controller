#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
cd "$ROOT_DIR"

ARTIFACT_DIR_INPUT=${1:-"artifacts/demo-run"}
ARTIFACT_DIR=$(mkdir -p "$ARTIFACT_DIR_INPUT" && realpath "$ARTIFACT_DIR_INPUT")
ARTIFACT_ROOT=$(dirname "$ARTIFACT_DIR")
rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"

TOPIC_PREFIX=${MQTT_TOPIC_PREFIX:-"derms-demo/$(date +%s)-$(cat /proc/sys/kernel/random/uuid)"}
SCENARIO_DURATION=${SCENARIO_DURATION:-120}
BACKEND_PORT=${PORT:-3001}
STARTED_AT=$(date -Iseconds)

export MQTT_TOPIC_PREFIX="$TOPIC_PREFIX"
export AUTH_USERS='[{"username":"demo-admin","password":"Adm1n!2345678","role":"admin"},{"username":"demo-operator","password":"Op3rator!23456","role":"operator"}]'
export JWT_SECRET=${JWT_SECRET:-"demo-scenario-secret-change-me-please"}
export PROMETHEUS_ENABLED=${PROMETHEUS_ENABLED:-true}
export LOG_PRETTY=${LOG_PRETTY:-false}
export CONTROL_INTERVAL_SECONDS=${CONTROL_INTERVAL_SECONDS:-5}
export FEEDER_DEFAULT_LIMIT_KW=${FEEDER_DEFAULT_LIMIT_KW:-50}
export CONTROL_GLOBAL_KW_LIMIT=${CONTROL_GLOBAL_KW_LIMIT:-50}

cleanup() {
  docker compose --profile sim down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

printf "[demo] Starting stack with topic prefix %s\n" "$TOPIC_PREFIX"
docker compose --profile sim up -d --build

printf "[demo] Waiting for backend to be ready on port %s...\n" "$BACKEND_PORT"
for i in {1..60}; do
  if curl -sf "http://localhost:${BACKEND_PORT}/api/health" >/dev/null; then
    break
  fi
  sleep 2
  if [[ $i -eq 60 ]]; then
    echo "Backend failed to become healthy" >&2
    exit 1
  fi
done

echo "[demo] Running scenario for ${SCENARIO_DURATION}s"
sleep "$SCENARIO_DURATION"

echo "[demo] Collecting diagnostics into ${ARTIFACT_DIR}"
mkdir -p "$ARTIFACT_DIR"

curl -sf "http://localhost:${BACKEND_PORT}/api/health" -o "$ARTIFACT_DIR/health.json" || true
curl -sf "http://localhost:${BACKEND_PORT}/metrics" -o "$ARTIFACT_DIR/metrics.txt" || true

# Logs
if command -v docker >/dev/null; then
  docker compose --profile sim logs backend >"${ARTIFACT_DIR}/backend.log" 2>&1 || true
  docker compose --profile sim logs simulator >"${ARTIFACT_DIR}/simulator.log" 2>&1 || true
  docker compose --profile sim logs mosquitto >"${ARTIFACT_DIR}/mqtt.log" 2>&1 || true
  docker compose --profile sim logs db >"${ARTIFACT_DIR}/db.log" 2>&1 || true
  docker compose --profile sim logs --no-color >"${ARTIFACT_DIR}/compose.log" 2>&1 || true
fi

# Runtime info
cat >"${ARTIFACT_DIR}/runtime.json" <<RUNTIME
{
  "startedAt": "${STARTED_AT}",
  "durationSec": ${SCENARIO_DURATION},
  "topicPrefix": "${TOPIC_PREFIX}",
  "gitSha": "$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")",
  "node": "$(node -v)",
  "docker": "$(docker --version 2>/dev/null || echo "unavailable")"
}
RUNTIME

node "$SCRIPT_DIR/demo_report.js" "$ARTIFACT_DIR"

tar -czf "${ARTIFACT_ROOT}/demo-run.tar.gz" -C "$ARTIFACT_ROOT" "$(basename "$ARTIFACT_DIR")"

echo "[demo] Demo scenario complete. Artifacts compressed at ${ARTIFACT_ROOT}/demo-run.tar.gz"
