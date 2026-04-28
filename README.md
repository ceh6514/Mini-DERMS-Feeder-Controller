# Mini-DERMS Feeder Controller
[![CI](../../actions/workflows/ci.yml/badge.svg?branch=main)](../../actions/workflows/ci.yml)

Mini-DERMS Feeder Controller is a small end-to-end demo of a feeder-level DERMS.

It takes telemetry from distributed energy resources, stores that telemetry in PostgreSQL, runs a feeder control loop, and publishes setpoints back over MQTT. The repo also includes a React dashboard, a Python simulator, and a Raspberry Pi agent for testing physical devices against the same control flow.

This project is meant to be a learning and prototyping system. It is useful for experimenting with feeder-aware DER coordination, demand response behavior, and operator workflows. It is not a full production DERMS or a full grid model.

## What this project is for

Right now, this project is built to:

- ingest telemetry from simulated or physical DER devices
- group devices by feeder
- enforce feeder limits with a periodic control loop
- track device behavior over time in PostgreSQL
- let an operator watch the system in a dashboard
- support demand response events and DR programs

The main device types in the codebase are:

- PV
- battery
- EV

## What is in the stack

- Backend: Node.js, TypeScript, Express
- Frontend: React, TypeScript, Vite
- Database: PostgreSQL
- Messaging: MQTT
- Simulator and Pi agent: Python

## Quick setup with Docker Compose

If you just want to see the whole system run, this is the easiest path.

### Prerequisites

- Docker
- Docker Compose

### Steps

1. Copy the backend env file:

   ```bash
   cp .env.example .env
   ```

2. Open `.env` and set `DB_PASSWORD`.

   This matters because the Postgres container uses that value on first startup, and the backend uses the same value to connect.

3. Start the stack, including the simulator:

   ```bash
   docker compose --profile sim up --build
   ```

4. Once the containers finish installing dependencies and booting, open:

- Dashboard: `http://localhost:5173`
- API: `http://localhost:3001`
- API docs: `http://localhost:3001/api/docs`
- Health check: `http://localhost:3001/api/health`

5. Sign in from the dashboard.

Stop the stack with:

```bash
docker compose down
```

If you copied `.env.example` without changing `AUTH_USERS`, the local sample accounts are:

- `admin` / `Adm1n!2345678`
- `operator` / `Op3rator!23456`
- `viewer` / `View3r!23456`

Those are fine for local development. Replace them before using this anywhere shared.

### What starts in Compose mode

- `db`: PostgreSQL
- `mosquitto`: MQTT broker
- `backend`: API and control loop
- `frontend`: dashboard
- `simulator`: sample DER telemetry publisher

In Compose mode, the backend talks to `db` and `mosquitto` through Docker networking, even though `.env.example` defaults to `localhost` for manual development.

## Manual local setup

If you want to work on the app itself, running the pieces separately is usually easier.

### Prerequisites

- Node.js 18+
- npm
- PostgreSQL
- MQTT broker, such as Mosquitto
- Python 3.9+ if you want the simulator or Pi agent

### Backend

1. Copy the backend env file:

   ```bash
   cp .env.example .env
   ```

2. Update the database and MQTT settings in `.env` so they match your local services.

3. Install and run the backend:

   ```bash
   npm install
   npm run dev
   ```

The backend starts on port `3001` by default and initializes the database schema on startup.

### Frontend

1. Copy the frontend env file:

   ```bash
   cp frontend/.env.example frontend/.env
   ```

2. Install and run the frontend:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

The frontend runs on port `5173` by default and expects the API at `http://localhost:3001`.

### Optional simulator

If you want live sample telemetry without Docker Compose:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r simulator/requirements.txt
BROKER_HOST=localhost BROKER_PORT=1883 python simulator/simulator.py
```

## How to use the program

Once the stack is running, the usual flow is pretty simple:

1. Open the dashboard and sign in.
2. Let the simulator or a real device publish telemetry.
3. Watch the feeder summary, device list, and charts update.
4. Use an operator or admin account if you want to create DR events, manage DR programs, or change the simulation mode.

The API is protected by JWT auth, except for:

- `/api/health`
- `/api/docs`
- `/api/openapi.json`
- `/api/auth/login`

### Roles

- `viewer`: read-only access
- `operator`: can issue control-related actions, including DR events and simulation changes
- `admin`: everything an operator can do, plus destructive actions like deleting DR programs

### Main API routes

- `POST /api/auth/login`
- `GET /api/feeder/summary`
- `GET /api/feeder/history`
- `GET /api/feeder/metrics`
- `GET /api/feeder/feeders`
- `GET /api/devices`
- `GET /api/telemetry/:deviceId`
- `POST /api/events`
- `GET /api/dr-programs`
- `POST /api/dr-programs`
- `POST /api/simulation/mode`

## MQTT topics and message flow

The MQTT contract in this repo is versioned and strict. By default, the topic prefix is `der`.

- Telemetry: `<prefix>/telemetry/<deviceType>/<deviceId>`
- Setpoints: `<prefix>/setpoints/<deviceType>/<deviceId>`
- Simulation profile: `<prefix>/simulation/profile`

The backend subscribes to telemetry, stores it, and publishes setpoints back out. The simulator and Pi agent both follow this contract.

For the full message format, see [`CONTRACT.md`](CONTRACT.md).

## Running the Raspberry Pi DER agent

If you want to connect a physical device path into the same system:

1. Copy the sample config:

   ```bash
   cp config.json config.pi.json
   ```

2. Edit `config.pi.json` with your device and broker details.

The main fields are:

- `broker_host`
- `broker_port`
- `device_id`
- `device_type`
- `site_id`
- `p_max_kw`
- `publish_interval_seconds`
- `topic_prefix` if you are not using the default `der`

3. Install the Python dependency:

   ```bash
   python3 -m pip install --upgrade pip
   python3 -m pip install paho-mqtt
   ```

4. Start the agent:

   ```bash
   python3 pi_der_agent.py --config config.pi.json
   ```

The agent publishes telemetry on `<prefix>/telemetry/<deviceType>/<deviceId>` and listens for setpoints on `<prefix>/setpoints/<deviceType>/<deviceId>`.

## Tests

- Backend test suite: `npm test`
- End-to-end tests: `npm run test:e2e`
- Full local CI pass: `npm run ci`

## Future plans so far

Based on the pieces that are already in the repo, the direction so far looks like this:

- keep improving feeder-aware control across multiple feeders, not just a single flat fleet
- keep physical Pi-based agents in the loop alongside simulated devices
- push the SOC-aware and priority-aware control logic further, including the optimizer-backed path that already has hooks in the code
- make solar behavior more weather-aware through the weather and irradiance pieces that are already started
- keep hardening the system around auth, observability, TLS, and deployment workflows

In other words, the goal is not just to make a simulator look busy. The goal is to turn this into a cleaner, more believable DERMS-style control sandbox.

## More documentation

- API reference: [`docs/api.md`](docs/api.md)
- Operations and deployment notes: [`docs/operations.md`](docs/operations.md)
- MQTT contract: [`CONTRACT.md`](CONTRACT.md)
- Design notes: [`docs/design.txt`](docs/design.txt)
