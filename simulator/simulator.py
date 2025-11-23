import json
import time
from datetime import datetime, timezone
import random

import paho.mqtt.client as mqtt

BROKER_HOST = "localhost"
BROKER_PORT = 1883

# Simple set of devices
DEVICES = [
    {"id": "pv-001", "type": "pv", "site_id": "house-01", "p_max_kw": 5.0},
    {"id": "bat-001", "type": "battery", "site_id": "house-01", "p_max_kw": 4.0},
    {"id": "ev-001", "type": "ev", "site_id": "house-01", "p_max_kw": 7.2},
]

# simple state for battery SOC and EV energy delivered
STATE = {
    "bat-001": {"soc": 0.5},
    "ev-001": {"energy_kwh": 0.0},
}


def on_connect(client, userdata, flags, reason_code, properties=None):
    print("[sim] connected to MQTT with result code", reason_code)
    # subscribe for control messages (not strictly required yet)
    client.subscribe("der/control/#")


def on_message(client, userdata, msg):
    # You can inspect control messages later if you want
    print("[sim] control msg:", msg.topic, msg.payload.decode())


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
                    # pretend EV is charging gently up to p_max
                    p_actual = random.uniform(0.0, p_max)
                    soc = None
                else:
                    p_actual = 0.0
                    soc = None

                payload = {
                    "deviceId": device_id,
                    "type": dtype,
                    "timestamp": now,
                    "p_actual_kw": p_actual,
                    "p_setpoint_kw": None,
                    "soc": soc,
                    "site_id": site_id,
                    "p_max_kw": p_max,
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
