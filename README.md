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

## Data lifecycle
On startup, the service initializes the `devices`, `telemetry`, `events`, and `dr_programs` tables (see `src/db.ts`). The control loop and MQTT ingest operate continuously once the server is running.
