# Mini-DERMS-Feeder-Controller

Controls a fleet of simulated DERs (solar/battery/EV chargers). Uses messaging (MQTT), a time-series database, and a backend service that makes control decisions. Has a small dashboard showing what the system is doing.

## Prerequisites
- Node.js 18+ and npm
- PostgreSQL reachable with a database you can write to (defaults: `postgres/postgres` on `localhost:5432` with database `mini_derms`)
- An MQTT broker (defaults: `localhost:1883`; e.g., run [Eclipse Mosquitto](https://mosquitto.org/))
- (Optional) Python 3.9+ if you want to run the included device simulator

## Environment
The server reads settings from environment variables via a `.env` file:

```
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=mini_derms
MQTT_HOST=localhost
MQTT_PORT=1883
CONTROL_INTERVAL_SECONDS=60
FEEDER_DEFAULT_LIMIT_KW=250
```

`src/config.ts` applies the same defaults shown above if variables are omitted. The database tables are created automatically on startup.

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

## Run the device simulator (optional)
The Python simulator publishes telemetry for a PV array, battery, and EV charger over MQTT.

1. Create a virtual environment and install requirements:
   ```
   python -m venv .venv
   source .venv/bin/activate
   pip install -r simulator/requirements.txt
   ```
2. Start the simulator (MQTT broker must be reachable on `MQTT_HOST:MQTT_PORT`):
   ```
   python simulator/simulator.py
   ```

Telemetry is published every ~5 seconds on topics like `der/telemetry/pv-001`. Control messages to `der/control/#` will be printed to the simulator console.

## Data lifecycle
On startup, the service initializes the `devices`, `telemetry`, and `events` tables (see `src/db.ts`). The control loop and MQTT ingest operate continuously once the server is running.
