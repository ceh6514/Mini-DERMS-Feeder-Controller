import json
import time
from datetime import datetime, timezone
import random

import paho.mqtt.client as mqtt

BROKER_HOST = "localhost"
BROKER_PORT = 1883

# Simple set of devices (one PV, one battery, and multiple EVs)
DEVICES = [
    {"id": "pv-001", "type": "pv", "site_id": "house-01", "p_max_kw": 5.0},
    {"id": "bat-001", "type": "battery", "site_id": "house-01", "p_max_kw": 4.0},
    {"id": "ev-001", "type": "ev", "site_id": "house-01", "p_max_kw": 7.2, "priority": 3},
    {"id": "ev-002", "type": "ev", "site_id": "house-01", "p_max_kw": 11.0, "priority": 2},
    {"id": "ev-003", "type": "ev", "site_id": "house-02", "p_max_kw": 3.6, "priority": 1},
    {"id": "ev-004", "type": "ev", "site_id": "house-02", "p_max_kw": 6.6, "priority": 2},
]

# simple state for battery SOC and EV energy delivered
STATE = {
    "bat-001": {"soc": 0.5},
    # track nominal session progress per EV for future extensions
    "ev-001": {"energy_kwh": 0.0},
    "ev-002": {"energy_kwh": 0.0},
    "ev-003": {"energy_kwh": 0.0},
    "ev-004": {"energy_kwh": 0.0},
}

# Track commanded setpoints and last measured power to smooth EV ramping
SETPOINTS: dict[str, float] = {}
LAST_P_ACTUAL: dict[str, float] = {}


def on_connect(client, userdata, flags, reason_code, properties=None):
    print("[sim] connected to MQTT with result code", reason_code)
    # subscribe for control messages (not strictly required yet)
    client.subscribe("der/control/#")


def on_message(client, userdata, msg):
    topic = msg.topic
    payload = msg.payload.decode()
    if topic.startswith("der/control/"):
        device_id = topic.split("/")[2]
        try:
            data = json.loads(payload)
            setpoint = data.get("p_setpoint_kw")
            if isinstance(setpoint, (int, float)):
                SETPOINTS[device_id] = float(setpoint)
                print(f"[sim] control msg {device_id} setpoint -> {SETPOINTS[device_id]:.2f} kW")
        except json.JSONDecodeError:
            print("[sim] failed to parse control payload", payload)


def compute_ev_power(device_id: str, p_max: float):
    setpoint = SETPOINTS.get(device_id)
    if setpoint is None:
        # fall back to old random behavior if no commands yet
        p_actual = random.uniform(0.0, p_max)
        LAST_P_ACTUAL[device_id] = p_actual
        return p_actual

    setpoint = max(0.0, min(p_max, float(setpoint)))
    current = LAST_P_ACTUAL.get(device_id, setpoint)
    ramp = 1.0  # kW per step

    if current < setpoint:
        p_actual = min(current + ramp, setpoint)
    elif current > setpoint:
        p_actual = max(current - ramp, setpoint)
    else:
        p_actual = current

    # add a touch of noise
    p_actual += random.uniform(-0.2, 0.2)
    p_actual = max(0.0, min(p_actual, p_max))

    LAST_P_ACTUAL[device_id] = p_actual
    return p_actual


def main():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message

    client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
    client.loop_start()

    try:
        while True:
            now = datetime.now(timezone.utc).isoformat()

            for d in DEVICES:
                device_id = d["id"]
                dtype = d["type"]
                site_id = d["site_id"]
                p_max = d["p_max_kw"]

                # fake behavior
                if dtype == "pv":
                    # random-ish between 0 and p_max
                    p_actual = max(0.0, random.gauss(p_max * 0.6, p_max * 0.2))
                    p_actual = min(p_actual, p_max)
                    soc = None
                elif dtype == "battery":
                    soc = STATE["bat-001"]["soc"]
                    # small random charge/discharge around 0
                    p_actual = random.uniform(-p_max / 2, p_max / 2)
                    # update soc a bit
                    dt_hours = 5.0 / 3600.0  # 5 second step
                    delta_soc = (p_actual * dt_hours) / 10.0  # 10 kWh capacity
                    soc = min(max(soc + delta_soc, 0.1), 0.9)
                    STATE["bat-001"]["soc"] = soc
                elif dtype == "ev":
                    p_actual = compute_ev_power(device_id, p_max)
                    soc = None
                else:
                    p_actual = 0.0
                    soc = None

                payload = {
                    "deviceId": device_id,
                    "type": dtype,
                    "timestamp": now,
                    "p_actual_kw": p_actual,
                    "p_setpoint_kw": SETPOINTS.get(device_id),
                    "soc": soc,
                    "site_id": site_id,
                    "p_max_kw": p_max,
                    "priority": d.get("priority"),
                }

                topic = f"der/telemetry/{device_id}"
                client.publish(topic, json.dumps(payload))

            time.sleep(5.0)
    except KeyboardInterrupt:
        print("\n[sim] stopping...")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
