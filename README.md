# ⚡ Mini-DERMS-Feeder-Controller

Controls a fleet of simulated DERs (solar/battery/EV chargers). Uses messaging (MQTT), a time-series database, and a backend service that makes control decisions. Has a small dashboard showing what the system is doing.

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
