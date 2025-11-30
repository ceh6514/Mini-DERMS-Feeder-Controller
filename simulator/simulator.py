import json
import math
import os
import random
import time
from datetime import datetime, timedelta

import paho.mqtt.client as mqtt

# Allow the broker address to be configured via environment variables so the
# simulator can easily point at the Docker Compose Mosquitto instance
# (BROKER_HOST=mosquitto) or a locally installed broker.
BROKER_HOST = os.getenv("BROKER_HOST", "localhost")
BROKER_PORT = int(os.getenv("BROKER_PORT", "1883"))
DT_SECONDS = 5.0

SUNRISE_HOUR = 6
SUNSET_HOUR = 20

BATTERY_KWH = 20.0
BATTERY_MIN_SOC = 0.1
BATTERY_MAX_SOC = 0.9

EV_CAPACITIES = {
    "ev-001": 60.0,
    "ev-002": 75.0,
    "ev-003": 40.0,
    "ev-004": 50.0,
}

# Simple set of devices (one PV, one battery, and multiple EVs)
DEVICES = [
    {"id": "pv-001", "type": "pv", "site_id": "house-01", "p_max_kw": 5.0},
    {"id": "bat-001", "type": "battery", "site_id": "house-01", "p_max_kw": 4.0},
    {"id": "ev-001", "type": "ev", "site_id": "house-01", "p_max_kw": 7.2, "priority": 3},
    {"id": "ev-002", "type": "ev", "site_id": "house-01", "p_max_kw": 11.0, "priority": 2},
    {"id": "ev-003", "type": "ev", "site_id": "house-02", "p_max_kw": 3.6, "priority": 1},
    {"id": "ev-004", "type": "ev", "site_id": "house-02", "p_max_kw": 6.6, "priority": 2},
]

BATTERY_STATE = {"soc": 0.5, "p_actual_kw": 0.0}

EV_STATE: dict[str, dict[str, float | None]] = {}
for device in DEVICES:
    if device["type"] == "ev":
        EV_STATE[device["id"]] = {
            "soc": random.uniform(0.2, 0.8),
            "p_actual_kw": 0.0,
            "p_setpoint_kw": None,
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


def pv_power_kw(sim_time: datetime, p_max_kw: float) -> float:
    hour = sim_time.hour + sim_time.minute / 60.0
    if hour <= SUNRISE_HOUR or hour >= SUNSET_HOUR:
        return 0.0

    day_fraction = (hour - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR)
    shape = math.sin(math.pi * day_fraction)
    shape = max(shape, 0.0)

    noise = random.uniform(-0.05, 0.05)
    level = max(0.0, min(1.1, shape + noise))

    return level * p_max_kw


def ramp_power(
    current: float, target: float, ramp_rate: float, p_max: float, p_min: float = 0.0
) -> float:
    if current < target:
        next_power = min(current + ramp_rate, target)
    elif current > target:
        next_power = max(current - ramp_rate, target)
    else:
        next_power = current

    next_power += random.uniform(-0.2, 0.2)
    return max(p_min, min(next_power, p_max))


def compute_ev_power(device_id: str, p_max: float):
    setpoint = SETPOINTS.get(device_id)
    if setpoint is None:
        target = random.uniform(0.0, p_max)
    else:
        target = max(0.0, min(p_max, float(setpoint)))

    current = LAST_P_ACTUAL.get(device_id, target)
    p_actual = ramp_power(current, target, ramp_rate=1.0, p_max=p_max)

    LAST_P_ACTUAL[device_id] = p_actual
    return p_actual


def main():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message

    client.connect(BROKER_HOST, BROKER_PORT, keepalive=60)
    client.loop_start()

    sim_time = datetime.now()
    tick = 0

    try:
        while True:
            sim_time += timedelta(seconds=DT_SECONDS)
            tick += 1

            pv_kw = 0.0

            for d in DEVICES:
                device_id = d["id"]
                dtype = d["type"]
                site_id = d["site_id"]
                p_max = d["p_max_kw"]

                # fake behavior
                if dtype == "pv":
                    p_actual = pv_power_kw(sim_time, p_max)
                    pv_kw = p_actual
                    soc = None
                elif dtype == "battery":
                    soc = BATTERY_STATE["soc"]
                    if soc > 0.55:
                        target_p_kw = 1.5
                    elif soc < 0.45:
                        target_p_kw = -1.5
                    else:
                        target_p_kw = 0.0

                    p_actual = ramp_power(
                        BATTERY_STATE["p_actual_kw"],
                        target_p_kw,
                        ramp_rate=0.5,
                        p_max=p_max,
                        p_min=-p_max,
                    )
                    dt_hours = DT_SECONDS / 3600.0
                    energy_delta_kwh = p_actual * dt_hours
                    soc_delta = energy_delta_kwh / BATTERY_KWH
                    soc = max(
                        BATTERY_MIN_SOC,
                        min(BATTERY_MAX_SOC, soc + soc_delta),
                    )
                    BATTERY_STATE["p_actual_kw"] = p_actual
                    BATTERY_STATE["soc"] = soc
                elif dtype == "ev":
                    ev = EV_STATE[device_id]
                    p_actual = compute_ev_power(device_id, p_max)
                    dt_hours = DT_SECONDS / 3600.0
                    energy_delta_kwh = p_actual * dt_hours
                    capacity = EV_CAPACITIES[device_id]
                    soc_delta = energy_delta_kwh / capacity
                    soc = max(0.0, min(1.0, ev["soc"] + soc_delta))
                    if soc >= 0.98:
                        p_actual = 0.0
                        LAST_P_ACTUAL[device_id] = p_actual

                    ev["soc"] = soc
                    ev["p_actual_kw"] = p_actual
                    ev["p_setpoint_kw"] = SETPOINTS.get(device_id)
                else:
                    p_actual = 0.0
                    soc = None

                payload = {
                    "deviceId": device_id,
                    "type": dtype,
                    "timestamp": sim_time.isoformat(),
                    "p_actual_kw": p_actual,
                    "p_setpoint_kw": SETPOINTS.get(device_id),
                    "soc": soc,
                    "site_id": site_id,
                    "p_max_kw": p_max,
                    "priority": d.get("priority"),
                    "sim_ts": sim_time.isoformat(),
                    "battery_kwh": (
                        BATTERY_KWH
                        if dtype == "battery"
                        else EV_CAPACITIES.get(device_id)
                        if dtype == "ev"
                        else None
                    ),
                }

                topic = f"der/telemetry/{device_id}"
                client.publish(topic, json.dumps(payload))

            if tick == 1 or tick % 12 == 0:
                print(
                    f"[sim] t={sim_time} pv={pv_kw:.1f}kW "
                    f"bat={BATTERY_STATE['p_actual_kw']:.1f}kW soc={BATTERY_STATE['soc']:.2f} "
                    f"ev-001={EV_STATE['ev-001']['p_actual_kw']:.1f}kW soc={EV_STATE['ev-001']['soc']:.2f}"
                )

            time.sleep(DT_SECONDS)
    except KeyboardInterrupt:
        print("\n[sim] stopping...")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
