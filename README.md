# ⚡ Mini-DERMS-Feeder-Controller
[![CI](../../actions/workflows/ci.yml/badge.svg?branch=main)](../../actions/workflows/ci.yml)

Controls a fleet of simulated DERs (solar/battery/EV chargers). Uses messaging (MQTT), a time-series database, and a backend service that makes control decisions. Has a small dashboard showing what the system is doing.

## What changed in this upgrade
- The control loop is now SOC-aware and priority-based, considering Pi-based DER agents (`pi-*`) alongside simulated EV/battery devices. It respects a global feeder limit, min SOC reserve, and a target SOC horizon, allocating headroom to higher-priority/low-SOC assets first.
- A new tracking-error metric computes the rolling average of `p_actual_kw - p_setpoint_kw` per device and is exposed at `GET /api/metrics/tracking-error`.
- The dashboard has been rebuilt into a responsive, animated control center with device origin filters, physical Pi badges, SOC/track-error charts, and smoother day/night theming.

## 🧰 Prerequisites
- Docker and Docker Compose (for the one-command stack)
- Node.js 18+ and npm
- PostgreSQL reachable with a database you can write to (defaults: `postgres/postgres` on `localhost:5432` with database `mini_derms`)
- An MQTT broker (defaults: `localhost:1883`; e.g., run [Eclipse Mosquitto](https://mosquitto.org/))
- (Optional) Python 3.9+ if you want to run the included device simulator

## 🐳 Docker Compose (one terminal)
For the quickest “everything running” experience (API, dashboard, Postgres, Mosquitto, and the simulator), use Docker Compose:

```bash
# 1) Copy defaults you can safely edit
cp .env.example .env
cp frontend/.env.example frontend/.env

# 2) Set your database credentials (recommended)
#    These drive both Docker Compose and local dev. You can also change DB_USER.
sed -i 's/^DB_USER=.*/DB_USER=postgres/' .env
sed -i 's/^DB_PASSWORD=.*/DB_PASSWORD=replace-me-strong-password/' .env

# 3) Start the stack with the simulator profile enabled
docker compose --profile sim up --build
```

- Dashboard: http://localhost:5173
- API: http://localhost:3001
- Simulator: auto-starts with the `sim` profile to publish sample telemetry.
- Stop everything with `docker compose down` (or `npm run stop:stack`).
- Need different creds? Change `DB_USER`/`DB_PASSWORD` in `.env` and rerun the compose command (the Postgres container will use them on first create).

The rebuilt dashboard highlights Pi-based DERs with a "Physical" badge, lets you filter by origin, and visualizes SOC distribution, tracking error, and setpoint-vs-actual curves. Select a device row to drive the animated charts.

## 🏗️ Run manually (separate terminals)
If you prefer to run pieces yourself:

1. **Database and MQTT**: provision PostgreSQL and an MQTT broker (defaults match `.env.example`). Ensure the DB user can create tables.
2. **Backend (root)**:
   ```bash
   npm install
   npm run dev
   ```
3. **Frontend (`frontend/`)**:
   ```bash
   npm install
   npm run dev
   ```
   For a production-like preview, build once and serve the optimized bundle:
   ```bash
   npm run build && npm run preview -- --host --port 4173
   ```
4. **Optional simulator (local Python)**:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r simulator/requirements.txt
   BROKER_HOST=localhost BROKER_PORT=1883 python simulator/simulator.py
   ```

The backend and frontend hot-reload when running locally or mounted into containers.

### Observability and hardening
- Structured logging defaults to JSON via Pino; tune `LOG_LEVEL`/`LOG_PRETTY` in `.env`. Prometheus metrics (DB, MQTT, control-loop health, timing, telemetry freshness, allocation outcomes, and publish latency) are available on `/metrics` when `PROMETHEUS_ENABLED=true`. Control-cycle decision records emit one JSON line per iteration; set `DECISION_LOG_LEVEL=debug` to include per-device allocations inline.
- Import the Grafana dashboard at [`docs/observability/control-loop-dashboard.json`](docs/observability/control-loop-dashboard.json) to visualize cycle lag/duration, stale device ratios, headroom usage, and publish success. Prometheus alert examples live in [`docs/prometheus/alerts.yml`](docs/prometheus/alerts.yml) covering stalled loops, lag, stale fleets, and publish failures.
- To enable HTTPS for the API, set `TLS_ENABLED=true` and mount `TLS_KEY_PATH`/`TLS_CERT_PATH` in the container or Kubernetes pod. The included Kubernetes manifests wire TLS via Ingress and secret mounts.
- Runbooks for backups, failover, alerting, and secret/TLS management live in [`docs/operations.md`](docs/operations.md).

### Safety policy & failure handling
The control loop now enforces a safety-first policy when telemetry, MQTT, or the database misbehave. Key environment variables (all have safe defaults):

- `TELEMETRY_STALE_MS` (default `30000`): maximum telemetry age before being considered stale.
- `TELEMETRY_MISSING_BEHAVIOR` (`SAFE_ZERO` | `HOLD_LAST` | `EXCLUDE_DEVICE`, default `SAFE_ZERO`): how to treat stale/missing telemetry.
- `HOLD_LAST_MAX_MS` (default `120000`): maximum time to reuse the last setpoint when using `HOLD_LAST`.
- `MQTT_PUBLISH_TIMEOUT_MS` (default `2000`), `MQTT_MAX_RETRIES` (default `3`), `MQTT_RETRY_BACKOFF_MS` (default `200`): time-bounded MQTT publishes with exponential backoff.
- `DB_QUERY_TIMEOUT_MS` (default `2000`) and `DB_ERROR_BEHAVIOR` (`SAFE_ZERO_ALL` | `HOLD_LAST` | `STOP_LOOP`, default `SAFE_ZERO_ALL`): time-bound DB calls and what to do when they fail.
- `MAX_CONSECUTIVE_FAILURES` (default `5`): after this many failed control cycles the loop enters stop-controlling mode and surfaces `derms_control_stopped` with the reason label.
- `RESTART_BEHAVIOR` (`SAFE_ZERO` | `HOLD_LAST`, default `SAFE_ZERO`): what to publish on cold start before fresh telemetry arrives.

Failure modes increment Prometheus metrics such as `derms_stale_telemetry_total`, `derms_missing_telemetry_total`, `derms_mqtt_publish_fail_total`, `derms_db_error_total`, `derms_control_degraded`, and `derms_control_stopped`, and log structured warnings with device IDs and reasons. When in doubt, devices are driven toward a conservative `0 kW` setpoint.

### Authentication and roles
API routes (except `/api/health` and `/api/auth/login`) are protected by a lightweight JWT-based guard with three roles:

- **viewer**: read-only dashboard access
- **operator**: can issue controls such as DR events, simulation overrides, and telemetry ingest
- **admin**: everything operators can do plus destructive operations (e.g., deleting DR programs)

Secrets must be injected via environment variables or a secret manager (see `.env.example` for required keys). Provide a JSON array for `AUTH_USERS` (12+ character passwords with upper/lowercase, numbers, and symbols) and a 32+ character `JWT_SECRET`. Rotate both at least every 90 days. The frontend stores the JWT and attaches it to subsequent API calls after a successful login.

#### Secure deployment checklist (dashboard/API)
- Terminate TLS at your ingress or load balancer and mount certificates into the backend when enabling `TLS_ENABLED=true`.
- Source `JWT_SECRET`, `AUTH_USERS`, and database credentials from your vault/secret store; never bake them into images.
- Rotate JWT signing secrets on a 90-day cadence and redeploy to pick up the new key; invalidate old tokens during rotations as needed.
- Run `npm run lint:env` before publishing changes to ensure `.env.example` does not contain weak placeholder credentials.

## 🐍 Run the Raspberry Pi DER agent
To connect a physical Pi-based device, use the provided MQTT agent:

1. Copy the example config and edit it with your device metadata:
   ```bash
   cp config.json config.pi.json
   ```
   Update `config.pi.json` with your device details:
   - `broker_host` / `broker_port`: point to the controller's MQTT broker (e.g., the Mosquitto instance from Docker Compose).
   - `device_id`, `device_type` (`pv`, `battery`, or `ev`), `site_id`, `p_max_kw`: identifiers and capabilities for this device.
   - `publish_interval_seconds`: how often the agent publishes telemetry.
2. On the Raspberry Pi, install Python dependencies (use a venv if preferred):
   ```bash
   python3 -m pip install --upgrade pip
   python3 -m pip install paho-mqtt
   ```
3. Launch the agent and point it at your config:
   ```bash
   python3 pi_der_agent.py --config config.pi.json
   ```

The agent subscribes to `der/control/<deviceId>` for setpoints and publishes telemetry to `der/telemetry/<deviceId>`. Ensure `broker_host` resolves to the MQTT broker used by the feeder controller so control messages reach the device.

### How control works
The feeder controller uses a weighted allocator in [`src/controllers/controlLoop.ts`](src/controllers/controlLoop.ts). Each device weight multiplies its priority with its SOC gap from reserve, accumulating a per-tick deficit bucket. At each control cycle, deficits are sorted and filled first to satisfy the most under-served devices, and any remaining feeder headroom is spread proportionally by weight.

## Tests

- **Unit tests**: `npm test` (build + Node.js test runner)
- **End-to-end control path**: `npm run test:e2e`
  - Place e2e specs under `tests/e2e/` and name them `*.test.ts` or `*.spec.ts` so they compile to `dist/tests/e2e/*.test.js`/`*.spec.js`.
  - The runner builds first, discovers compiled e2e files with `scripts/runE2eTests.sh`, and skips cleanly with a message when no specs exist or when Docker is unavailable (or `SKIP_E2E_DOCKER=true`).

### Local CI checks
- Lint env and configuration: `npm run lint`
- TypeScript type safety: `npm run typecheck`
- Full unit suite: `npm test`
- Everything end-to-end (requires Docker): `npm run ci`

## CI & Demo Scenario

- Run `npm run ci` (or `./scripts/ci_local.sh`) to execute linting, type-checking, unit/integration tests, and Docker-backed end-to-end tests locally. Docker is required for the e2e stage because it provisions Postgres and Mosquitto containers.
- A reproducible demo can be launched with `npm run demo:scenario`, which uses the Docker Compose `sim` profile to start Postgres, Mosquitto, the backend, and the simulator with a unique MQTT topic prefix. After ~2 minutes it collects backend/simulator/broker logs, `/metrics`, `/api/health`, and a summary report into `artifacts/demo-run/` and compresses everything into `artifacts/demo-run.tar.gz`.
- CI workflows mirror these commands and upload artifacts (logs, coverage/junit if present, and demo summaries) on failure to aid debugging.
  - Requires Docker with access to pull `postgres:16-alpine` and `eclipse-mosquitto:2`.
  - The suite launches ephemeral containers and a broker topic prefix like `derms-test/<timestamp>-<uuid>` so parallel runs do not clash.
  - You can override the MQTT topic prefix via `MQTT_TOPIC_PREFIX` and telemetry freshness threshold via `STALE_TELEMETRY_THRESHOLD_SECONDS` if needed.

## Performance notes
- Dashboard polling now uses a longer, jittered interval with visibility-aware backoff to avoid hogging CPU when the tab is hidden.
- Telemetry charts and device widgets use memoization and smaller data windows to reduce unnecessary re-renders.
- Frontend API calls support abort signals to prevent overlapping requests when switching devices quickly.

## Data lifecycle
On startup, the service initializes the `devices`, `telemetry`, `events`, and `dr_programs` tables (see `src/db.ts`). The control loop and MQTT ingest operate continuously once the server is running.
