# Mini-DERMS-Feeder-Controller

Controls a fleet of simulated DERs (solar/battery/EV chargers). Uses messaging (MQTT), a time-series database, and a backend service that makes control decisions. Has a small dashboard showing what the system is doing.

## Prerequisites
- Docker and Docker Compose (for the one-command stack)
- Node.js 18+ and npm
- PostgreSQL reachable with a database you can write to (defaults: `postgres/postgres` on `localhost:5432` with database `mini_derms`)
- An MQTT broker (defaults: `localhost:1883`; e.g., run [Eclipse Mosquitto](https://mosquitto.org/))
- (Optional) Python 3.9+ if you want to run the included device simulator

## Docker Compose (one terminal)
```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
npm run dev:stack
# when done
npm run stop:stack
```
- Dashboard: http://localhost:5173
- API: http://localhost:3001

## Run manually (separate terminals)
1. Database and MQTT: use local PostgreSQL and an MQTT broker (defaults match `.env.example`).
2. Backend (root):
   ```bash
   npm install
   npm run dev
   ```
3. Frontend (`frontend/`):
   ```
   npm install
   npm run dev
   ```
5. Optional simulator:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r simulator/requirements.txt
   BROKER_HOST=localhost BROKER_PORT=1883 python simulator/simulator.py
   The backend and frontend hot-reload because the repo is mounted into the containers.
   ```

## Data lifecycle
On startup, the service initializes the `devices`, `telemetry`, and `events` tables (see `src/db.ts`). The control loop and MQTT ingest operate continuously once the server is running.
