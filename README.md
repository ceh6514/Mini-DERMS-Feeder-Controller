# ⚡ Mini-DERMS-Feeder-Controller

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
The fastest way to run the full stack (API, dashboard, database, MQTT, and simulator) is with Docker Compose. Copy the example env files, then bring everything up:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
docker compose --profile sim up --build
```

- Dashboard: http://localhost:5173
- API: http://localhost:3001
- Simulator containers are included when the `sim` profile is enabled. Stop everything with `npm run stop:stack` or `docker compose down` when you are done.

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
4. **Optional simulator (local Python)**:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r simulator/requirements.txt
   BROKER_HOST=localhost BROKER_PORT=1883 python simulator/simulator.py
   ```

The backend and frontend hot-reload when running locally or mounted into containers.

### Observability and hardening
- Structured logging defaults to JSON via Pino; tune `LOG_LEVEL`/`LOG_PRETTY` in `.env`. Prometheus metrics (DB, MQTT, control-loop health plus Node.js runtime stats) are available on `/metrics` when `PROMETHEUS_ENABLED=true`.
- To enable HTTPS for the API, set `TLS_ENABLED=true` and mount `TLS_KEY_PATH`/`TLS_CERT_PATH` in the container or Kubernetes pod. The included Kubernetes manifests wire TLS via Ingress and secret mounts.
- Runbooks for backups, failover, alerting, and secret/TLS management live in [`docs/operations.md`](docs/operations.md).

### Authentication and roles
API routes (except `/api/health` and `/api/auth/login`) are protected by a lightweight JWT-based guard with three roles:

- **viewer**: read-only dashboard access
- **operator**: can issue controls such as DR events, simulation overrides, and telemetry ingest
- **admin**: everything operators can do plus destructive operations (e.g., deleting DR programs)

Configure credentials and secrets through environment variables (see `.env.example` for defaults):

```bash
JWT_SECRET=change-me
JWT_TOKEN_TTL_HOURS=12
AUTH_USERS='[{"username":"admin","password":"admin123","role":"admin"},{"username":"operator","password":"operator123","role":"operator"},{"username":"viewer","password":"viewer123","role":"viewer"}]'
```

Use the configured username/password pairs to sign in via the dashboard login screen. The frontend automatically stores the JWT and attaches it to subsequent API calls. Update the `AUTH_USERS` array and `JWT_SECRET` before deploying anywhere non-local.

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

## Data lifecycle
On startup, the service initializes the `devices`, `telemetry`, `events`, and `dr_programs` tables (see `src/db.ts`). The control loop and MQTT ingest operate continuously once the server is running.
