# Mini-DERMS-Feeder-Controller

Controls a fleet of simulated DERs (solar/battery/EV chargers). Uses messaging (MQTT), a time-series database, and a backend service that makes control decisions. Has a small dashboard showing what the system is doing.

## Prerequisites
- Docker and Docker Compose (for the one-command stack)
- Node.js 18+ and npm
- PostgreSQL reachable with a database you can write to (defaults: `postgres/postgres` on `localhost:5432` with database `mini_derms`)
- An MQTT broker (defaults: `localhost:1883`; e.g., run [Eclipse Mosquitto](https://mosquitto.org/))
- (Optional) Python 3.9+ if you want to run the included device simulator

## Docker Compose quickstart
Run the whole stack (PostgreSQL + Mosquitto + backend + frontend) with two commands:

1. Copy the sample env files:
   ```bash
   cp .env.example .env
   cp frontend/.env.example frontend/.env
   ```
2. Start the stack (builds images if needed and streams logs):
   ```bash
   npm run dev:stack
   ```
   The backend and frontend hot-reload because the repo is mounted into the containers.

Open the dashboard at http://localhost:5173 (API at http://localhost:3001). Stop the stack with:

```bash
npm run stop:stack
```

To include the Python device simulator inside Docker, add the `sim` profile:

```bash
docker compose --profile sim up --build
```

Defaults inside Docker:
- PostgreSQL: `postgres/postgres` on `localhost:5432` using database `mini_derms`
- MQTT broker: `localhost:1883` (anonymous connections enabled for local use)
- Backend API: `localhost:3001`
- Frontend: `localhost:5173`

### Verify everything is talking
Use these quick checks while the stack is running:

```bash
# Backend + DB + MQTT status
curl -s http://localhost:3001/api/health | jq

# Confirm devices are flowing in from the simulator
curl -s http://localhost:3001/api/devices | jq 'length'
```
The first command shows whether the database and MQTT client are connected. The second should return a non-zero device count once the simulator is publishing.

## Environment
The server reads settings from environment variables via a `.env` file (see `.env.example` for defaults geared toward Docker Compose):

```
PORT=3001
DB_HOST=db
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=mini_derms
MQTT_HOST=mosquitto
MQTT_PORT=1883
CONTROL_INTERVAL_SECONDS=60
FEEDER_DEFAULT_LIMIT_KW=250
```

`src/config.ts` applies the same defaults shown above if variables are omitted. The database tables are created automatically on startup.

The frontend can target a different API URL by setting `VITE_API_URL` in `frontend/.env` (see `frontend/.env.example`).

## Install dependencies
```
npm install
```

## Run the backend
- **Development (with TypeScript + auto-reload):**
  ```
  npm run dev
  ```
- **Build + start compiled server:**
  ```
  npm run build
  npm start
  ```

The server listens on `PORT` (default `3001`) and exposes a simple health check at `/api/health`. Ensure PostgreSQL and your MQTT broker are running before starting; the server will continue without MQTT if it cannot connect.

## Run the frontend
The React dashboard lives in `frontend/` and targets the backend API at `VITE_API_URL` (default `http://localhost:3001`). Copy `frontend/.env.example` to `frontend/.env` if you need to override the API URL.

- Install dependencies (from `frontend/`):
  ```
  npm install
  ```
- Start the development server for local work (serves at http://localhost:5173):
  ```
  npm run dev
  ```
- Build a production bundle and serve it locally for QA (preview runs on http://localhost:4173):
  ```
  npm run build
  npm run preview
  ```

The dashboard polls the backend for device telemetry and control status. If the API runs on a different host or port, set `VITE_API_URL` in `frontend/.env` before starting the dev server or preview.

## API documentation
- Browse interactive docs at http://localhost:3001/api/docs (driven by the OpenAPI spec at `/api/openapi.json`).
- A concise endpoint reference with example `curl` commands lives in [docs/api.md](docs/api.md).

## Run the device simulator (optional)
The Python simulator publishes telemetry for a PV array, battery, and EV charger over MQTT.

**Easiest path (inside Docker):**
```bash
docker compose --profile sim up --build
```
The simulator container is placed on the same network as Mosquitto and the backend so devices should appear within a few seconds.

**Run locally against Docker Compose services:**
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r simulator/requirements.txt
BROKER_HOST=localhost BROKER_PORT=1883 python simulator/simulator.py
```
Keep the simulator running; telemetry will flow into the stack through Mosquitto and devices will populate automatically via the `/api/devices` endpoint.

Telemetry is published every ~5 seconds on topics like `der/telemetry/pv-001`. Control messages to `der/control/#` will be printed to the simulator console.

## Data lifecycle
On startup, the service initializes the `devices`, `telemetry`, and `events` tables (see `src/db.ts`). The control loop and MQTT ingest operate continuously once the server is running.
