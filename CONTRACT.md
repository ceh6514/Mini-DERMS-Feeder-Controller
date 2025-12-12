# MQTT Message Contract (v1)

This repository uses a strict, versioned message envelope for all MQTT traffic. The
contract is enforced in the backend, simulator, and Raspberry Pi agent.

## Topic conventions
- Telemetry: `<prefix>/telemetry/<deviceType>/<deviceId>`
- Setpoints: `<prefix>/setpoints/<deviceType>/<deviceId>`
- Simulation profile: `<prefix>/simulation/profile`
- Prefix defaults to `der` and is configurable via environment variable/topicPrefix settings.

## Envelope (all messages)
```json
{
  "v": 1,
  "messageType": "telemetry" | "setpoint" | "ack",
  "messageId": "uuid",
  "deviceId": "string",
  "deviceType": "pv" | "battery" | "ev",
  "timestampMs": 1730000000000,
  "sentAtMs": 1730000001000,
  "correlationId": "optional",
  "source": "simulator" | "pi-agent" | "backend" | "unknown",
  "payload": { ... }
}
```
Unknown versions are rejected and counted via `derms_contract_version_reject_total`.

## Telemetry payload (v1)
```json
{
  "readings": {
    "powerKw": 3.2,
    "energyKwh": 12.5,
    "soc": 0.55,
    "voltageV": 240,
    "currentA": 15.2
  },
  "status": { "online": true, "faultCode": "" },
  "capabilities": {
    "maxChargeKw": 7,
    "maxDischargeKw": 7,
    "maxExportKw": 7,
    "maxImportKw": 7
  },
  "siteId": "site-1",
  "feederId": "feeder-1"
}
```
- All inbound telemetry is validated before persistence; invalid payloads are dropped and
  counted via `derms_contract_validation_fail_total`.
- Telemetry QoS: 1, retain=false.
- Dedupe keys: `messageId` (primary) and `(deviceId, timestampMs, messageType)` in the DB.
- Out-of-order samples are stored but do not overwrite latest control state; they increment
  `derms_out_of_order_total`.

## Setpoint payload (v1)
```json
{
  "command": {
    "targetPowerKw": 1.5,
    "mode": "charge" | "discharge" | "idle" | "import" | "export" | "limit",
    "validUntilMs": 1730000005000
  },
  "constraints": { "rampRateKwPerS": 0.5 },
  "reason": { "allocator": "feeder-controller", "notes": "optional" }
}
```
- All outbound setpoints are built from the schema and include `validUntilMs` TTL for safety.
- Setpoint QoS: 1, retain=true so reconnecting devices receive the latest safe command.
- Devices must ignore expired or duplicate `messageId` setpoints.

## Idempotency and replay
- Database enforces `UNIQUE (message_id)` and `UNIQUE (device_id, ts, message_type)` on telemetry.
- Backend deduplicates in memory and only updates heartbeat/control state for the latest
  `timestampMs` per device (ties resolved by `sentAtMs`).
- On restart, retained setpoints are safe because of TTL; telemetry is re-subscribed and
  last-known state is warmed from the DB.

## Versioning and forward compatibility
- Current version: `v=1` (`contractVersion` constant in code).
- Unknown higher versions are rejected by default; lenient mode can be enabled in code paths
  to ignore unknown fields but still require the v1 envelope.

## Examples
See `simulator/simulator.py` and `pi_der_agent.py` for reference publishers/consumers updated to
this contract. Tests in `tests/contracts.test.ts` enforce validation, dedupe, and out-of-order
handling.
