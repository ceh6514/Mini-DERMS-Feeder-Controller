import json
import math
import os
import random
import time
import uuid
from datetime import datetime, timedelta

import paho.mqtt.client as mqtt

# Allow the broker address to be configured via environment variables so the
# simulator can easily point at the Docker Compose Mosquitto instance
# (BROKER_HOST=mosquitto) or a locally installed broker.
BROKER_HOST = os.getenv("BROKER_HOST", "localhost")
BROKER_PORT = int(os.getenv("BROKER_PORT", "1883"))
TOPIC_PREFIX = os.getenv("TOPIC_PREFIX", "der").rstrip("/")
DT_SECONDS = 5.0

SUNRISE_HOUR = 6
SUNSET_HOUR = 20
DAY_START_HOUR = 7
NIGHT_START_HOUR = 23

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
SIM_PROFILE_OVERRIDE: str | None = None
PROCESSED_SETPOINTS: set[str] = set()


def on_connect(client, userdata, flags, reason_code, properties=None):
    print("[sim] connected to MQTT with result code", reason_code)
    client.subscribe(f"{TOPIC_PREFIX}/setpoints/#", qos=1)
    client.subscribe(f"{TOPIC_PREFIX}/simulation/profile")


def on_message(client, userdata, msg):
    topic = msg.topic
    payload = msg.payload.decode()
    if topic.startswith(f"{TOPIC_PREFIX}/setpoints/"):
        parts = topic.split("/")
        device_id = parts[-1]
        try:
            data = json.loads(payload)
            if data.get("messageType") != "setpoint" or data.get("v") != 1:
                return
            message_id = data.get("messageId")
            if isinstance(message_id, str) and message_id in PROCESSED_SETPOINTS:
                print(f"[sim] duplicate setpoint ignored for {device_id}")
                return

            command = (data.get("payload") or {}).get("command", {})
            valid_until = command.get("validUntilMs")
            now_ms = int(time.time() * 1000)
            if isinstance(valid_until, (int, float)) and valid_until < now_ms:
                print(f"[sim] expired setpoint ignored for {device_id}")
                return

            setpoint = command.get("targetPowerKw")
            if isinstance(setpoint, (int, float)):
                SETPOINTS[device_id] = float(setpoint)
                if isinstance(message_id, str):
                    PROCESSED_SETPOINTS.add(message_id)
                print(f"[sim] setpoint {device_id} -> {SETPOINTS[device_id]:.2f} kW")
        except json.JSONDecodeError:
            print("[sim] failed to parse control payload", payload)
    elif topic == f"{TOPIC_PREFIX}/simulation/profile":
        try:
            data = json.loads(payload)
            profile = data.get("profile")
            if profile in ("day", "night"):
                global SIM_PROFILE_OVERRIDE
                SIM_PROFILE_OVERRIDE = profile
                print(f"[sim] simulation profile override -> {profile}")
        except json.JSONDecodeError:
            print("[sim] failed to parse simulation profile payload", payload)


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


def derive_profile(sim_time: datetime) -> str:
    hour = sim_time.hour + sim_time.minute / 60.0
    return "day" if DAY_START_HOUR <= hour < NIGHT_START_HOUR else "night"


def active_profile(sim_time: datetime) -> str:
    return SIM_PROFILE_OVERRIDE or derive_profile(sim_time)


def profile_load_multiplier(sim_time: datetime, profile: str) -> float:
    hour = sim_time.hour + sim_time.minute / 60.0

    if profile == "day":
        # Peak in the middle of the day with a smooth ramp up/down.
        day_fraction = max(0.0, min(1.0, (hour - DAY_START_HOUR) / (NIGHT_START_HOUR - DAY_START_HOUR)))
        solar_curve = 0.7 + 0.6 * math.sin(math.pi * day_fraction)
        baseline = 1.2  # ~20% higher than night
        return baseline * solar_curve

    # Nighttime: start with a sharp drop at 23:00 and gently rise toward dawn.
    night_window = 24 - NIGHT_START_HOUR + DAY_START_HOUR  # 8 hours
    if hour >= NIGHT_START_HOUR:
        night_progress = (hour - NIGHT_START_HOUR) / night_window
    else:
        night_progress = (hour + (24 - NIGHT_START_HOUR)) / night_window

    night_progress = max(0.0, min(1.0, night_progress))
    low = 0.55
    high = 0.95
    transition = low + (high - low) * (1 - math.cos(math.pi * night_progress)) / 2.0
    return transition


def compute_ev_power(device_id: str, p_max: float, load_multiplier: float):
    setpoint = SETPOINTS.get(device_id)
    if setpoint is None:
        target_center = p_max * 0.55 * load_multiplier
        jitter = random.gauss(0, p_max * 0.08)
        target = max(0.0, min(p_max, target_center + jitter))
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

            profile = active_profile(sim_time)
            load_multiplier = profile_load_multiplier(sim_time, profile)

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
                        target_p_kw = 1.2 * load_multiplier
                    elif soc < 0.45:
                        target_p_kw = -1.2 * load_multiplier
                    else:
                        target_p_kw = 0.2 * (load_multiplier - 1.0)

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
                    p_actual = compute_ev_power(device_id, p_max, load_multiplier)
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

                readings = {"powerKw": p_actual}
                if soc is not None:
                    readings["soc"] = soc

                envelope = {
                    "v": 1,
                    "messageType": "telemetry",
                    "messageId": str(uuid.uuid4()),
                    "deviceId": device_id,
                    "deviceType": dtype,
                    "timestampMs": int(sim_time.timestamp() * 1000),
                    "sentAtMs": int(time.time() * 1000),
                    "source": "simulator",
                    "payload": {
                        "readings": readings,
                        "status": {"online": True},
                        "capabilities": {
                            "maxChargeKw": p_max,
                            "maxDischargeKw": p_max,
                            "maxExportKw": p_max,
                            "maxImportKw": p_max,
                        },
                        "siteId": site_id,
                        "feederId": site_id,
                    },
                }

                topic = f"{TOPIC_PREFIX}/telemetry/{dtype}/{device_id}"
                client.publish(topic, json.dumps(envelope), qos=1, retain=False)

            if tick == 1 or tick % 12 == 0:
                print(
                    f"[sim] t={sim_time} profile={profile} mult={load_multiplier:.2f} pv={pv_kw:.1f}kW "
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
