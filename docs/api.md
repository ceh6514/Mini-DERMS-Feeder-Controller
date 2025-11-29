# API

The backend exposes a small REST API for monitoring the feeder, browsing devices, and creating events. The examples below assume the server is running locally on port `3001`.

- Interactive docs (Swagger UI): http://localhost:3001/api/docs
- Raw OpenAPI JSON: http://localhost:3001/api/openapi.json

## Health
- **GET** `/api/health`
- **Response:** `{ "status": "ok" }`
- **Example:**
  ```bash
  curl http://localhost:3001/api/health
  ```

## Feeder summary
- **GET** `/api/feeder/summary`
- **Response schema:**
  - `totalKw` *(number)*: Sum of `p_actual_kw` across latest telemetry per device.
  - `limitKw` *(number)*: Active feeder limit (current event or default).
  - `deviceCount` *(integer)*: Number of devices included in the total.
  - `byType` *(object)*: Device-type breakdown with `{ count, totalKw }` per type.
- **Example:**
  ```bash
  curl http://localhost:3001/api/feeder/summary
  ```

## Feeder history
- **GET** `/api/feeder/history`
- **Query parameters:**
  - `minutes` *(integer, default: 30)* — Minutes to look back from now.
  - `bucketSeconds` *(integer, default: 60)* — Aggregation bucket size in seconds.
- **Response schema:**
  - `limitKw` *(number)*: Feeder limit applied across the requested window.
  - `points` *(array)*: Downsampled totals ordered oldest-first, each `{ ts, totalKw }` where `ts` is ISO-8601.
- **Example:**
  ```bash
  curl "http://localhost:3001/api/feeder/history?minutes=60&bucketSeconds=120"
  ```

## Devices
- **GET** `/api/devices`
- **Response schema:** Array of devices, each with:
  - `id` *(string)*, `type` *(string)*, `siteId` *(string)*, `pMaxKw` *(number)*, `priority` *(number|null)*
  - `latestTelemetry` *(object|null)*: Latest telemetry row for the device (includes `device_id`, `ts`, `type`, `p_actual_kw`, optional `p_setpoint_kw`, `soc`, and `site_id`).
- **Example:**
  ```bash
  curl http://localhost:3001/api/devices
  ```

## Device telemetry
- **GET** `/api/telemetry/{deviceId}`
- **Path parameters:**
  - `deviceId` *(string)* — Device identifier.
- **Response schema:** Array of telemetry rows ordered newest-first with fields `id`, `device_id`, `ts` (ISO-8601), `type`, `p_actual_kw`, optional `p_setpoint_kw`, `soc`, and `site_id`.
- **Example:**
  ```bash
  curl http://localhost:3001/api/telemetry/pv-001
  ```

## Events
- **POST** `/api/events`
- **Request body:**
  ```json
  {
    "tsStart": "2024-01-01T12:00:00Z",
    "tsEnd": "2024-01-01T14:00:00Z",
    "limitKw": 150,
    "type": "curtailment"
  }
  ```
- **Response schema:** Created event with fields `id`, `ts_start`, `ts_end`, `limit_kw`, `type`.
- **Example:**
  ```bash
  curl -X POST http://localhost:3001/api/events \
    -H "Content-Type: application/json" \
    -d '{"tsStart":"2024-01-01T12:00:00Z","tsEnd":"2024-01-01T14:00:00Z","limitKw":150,"type":"curtailment"}'
  ```
