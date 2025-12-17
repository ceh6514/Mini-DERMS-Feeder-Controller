"""
Raspberry Pi DER agent for Mini-DERMS feeder controller.
Usage:
    python pi_der_agent.py --config config.json

This script connects to an MQTT broker, subscribes to der/control/<deviceId>,
and periodically publishes telemetry on der/telemetry/<deviceId>.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import random
import signal
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
import uuid

import paho.mqtt.client as mqtt


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)


@dataclass
class AgentConfig:
    broker_host: str
    broker_port: int
    device_id: str
    device_type: str
    site_id: str
    p_max_kw: float
    publish_interval_seconds: int
    topic_prefix: str = "der"

    @classmethod
    def load(cls, path: Path) -> "AgentConfig":
        with path.open() as f:
            data = json.load(f)
        cls._validate_fields(data)
        return cls(**data)

    @staticmethod
    def _validate_fields(data: Dict[str, Any]) -> None:
        required = {
            "broker_host": str,
            "broker_port": int,
            "device_id": str,
            "device_type": str,
            "site_id": str,
            "p_max_kw": (int, float),
            "publish_interval_seconds": int,
        }
        missing = [key for key in required if key not in data]
        if missing:
            raise ValueError(f"Missing required config fields: {', '.join(missing)}")
        for key, expected_type in required.items():
            if not isinstance(data[key], expected_type):
                raise TypeError(f"{key} must be of type {expected_type}")
        topic_prefix = data.get("topic_prefix", "der")
        if not isinstance(topic_prefix, str):
            raise TypeError("topic_prefix must be of type <class 'str'>")
        data["topic_prefix"] = topic_prefix
        if data["device_type"] not in {"pv", "battery", "ev"}:
            raise ValueError("device_type must be one of ['pv', 'battery', 'ev']")


@dataclass
class DERState:
    config: AgentConfig
    p_actual_kw: float = 0.0
    p_setpoint_kw: Optional[float] = None
    soc: Optional[float] = field(default=50.0)
    processed_setpoints: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        if self.config.device_type == "pv":
            self.soc = None  # PV does not track SOC

    def update_from_control(self, payload: Dict[str, Any]) -> None:
        if payload.get("messageType") != "setpoint" or payload.get("v") != 1:
            logging.warning("Ignoring non-setpoint payload: %s", payload)
            return

        message_id = payload.get("messageId")
        if isinstance(message_id, str) and message_id in self.processed_setpoints:
            logging.info("Duplicate setpoint ignored: %s", message_id)
            return

        command = (payload.get("payload") or {}).get("command", {})
        valid_until = command.get("validUntilMs")
        now_ms = int(time.time() * 1000)
        if isinstance(valid_until, (int, float)) and valid_until < now_ms:
            logging.warning("Expired setpoint ignored; valid_until=%s", valid_until)
            return

        new_setpoint = command.get("targetPowerKw")
        if new_setpoint is None:
            logging.warning("Control payload missing targetPowerKw; ignoring")
            return
        if not isinstance(new_setpoint, (int, float)):
            logging.warning("Invalid targetPowerKw type; ignoring control message")
            return
        self.p_setpoint_kw = float(new_setpoint)
        if isinstance(message_id, str):
            self.processed_setpoints.add(message_id)
        logging.info("Setpoint updated to %.2f kW", self.p_setpoint_kw)

    def compute_pv_power(self) -> float:
        # Simple sine-based daylight curve between 6:00 and 18:00 with noise
        now = datetime.now()
        hour = now.hour + now.minute / 60
        daylight_fraction = max(0.0, min(1.0, (hour - 6) / 12))
        power = self.config.p_max_kw * math.sin(math.pi * daylight_fraction)
        noise = random.uniform(-0.05, 0.05) * self.config.p_max_kw
        return max(0.0, power + noise)

    def step(self, dt_seconds: float) -> None:
        if self.config.device_type == "pv":
            pv_power = self.compute_pv_power()
            if self.p_setpoint_kw is not None:
                logging.info("PV ignoring setpoint %.2f kW (read-only)", self.p_setpoint_kw)
            self.p_actual_kw = pv_power
            return

        target = self.p_setpoint_kw if self.p_setpoint_kw is not None else 0.0
        target = max(-self.config.p_max_kw, min(self.config.p_max_kw, target))
        ramp = 0.4  # smoothing factor per step
        self.p_actual_kw += (target - self.p_actual_kw) * ramp

        dt_hours = dt_seconds / 3600
        if self.soc is not None and self.config.p_max_kw > 0:
            delta_soc = -(self.p_actual_kw / self.config.p_max_kw) * 100 * dt_hours
            self.soc = max(0.0, min(100.0, self.soc + delta_soc))

    def telemetry(self) -> Dict[str, Any]:
        readings: Dict[str, Any] = {
            "powerKw": round(self.p_actual_kw, 3),
        }
        if self.soc is not None:
            readings["soc"] = round(self.soc, 2)

        return {
            "v": 1,
            "messageType": "telemetry",
            "messageId": str(uuid.uuid4()),
            "deviceId": self.config.device_id,
            "deviceType": self.config.device_type,
            "timestampMs": int(time.time() * 1000),
            "sentAtMs": int(time.time() * 1000),
            "source": "pi-agent",
            "payload": {
                "readings": readings,
                "status": {"online": True},
                "capabilities": {
                    "maxChargeKw": self.config.p_max_kw,
                    "maxDischargeKw": self.config.p_max_kw,
                    "maxExportKw": self.config.p_max_kw,
                    "maxImportKw": self.config.p_max_kw,
                },
                "siteId": self.config.site_id,
                "feederId": self.config.site_id,
            },
        }


def create_mqtt_client(config: AgentConfig, state: DERState) -> mqtt.Client:
    client = mqtt.Client(client_id=config.device_id, clean_session=True)
    topic_prefix = config.topic_prefix.rstrip("/")

    def on_connect(client: mqtt.Client, userdata: Any, flags: Dict[str, Any], rc: int, properties: Any | None = None) -> None:
        if rc == 0:
            logging.info("Connected to MQTT broker")
            control_topic = f"{topic_prefix}/setpoints/{config.device_type}/{config.device_id}"
            client.subscribe(control_topic, qos=1)
            logging.info("Subscribed to %s", control_topic)
        else:
            logging.error("MQTT connection failed with code %s", rc)

    def on_message(client: mqtt.Client, userdata: Any, msg: mqtt.MQTTMessage) -> None:
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
            logging.info("Control message received: %s", payload)
            state.update_from_control(payload)
        except json.JSONDecodeError:
            logging.warning("Failed to decode control message: %s", msg.payload)

    def on_disconnect(client: mqtt.Client, userdata: Any, rc: int, properties: Any | None = None) -> None:
        if rc != 0:
            logging.warning("Unexpected MQTT disconnect (code %s). Reconnecting...", rc)

    client.on_connect = on_connect
    client.on_message = on_message
    client.on_disconnect = on_disconnect
    client.enable_logger(logging.getLogger("paho"))
    return client


def connect_with_backoff(client: mqtt.Client, config: AgentConfig) -> None:
    delay = 1
    while True:
        try:
            logging.info("Connecting to MQTT %s:%s", config.broker_host, config.broker_port)
            client.connect(config.broker_host, int(config.broker_port))
            return
        except Exception as exc:  # noqa: BLE001
            logging.error("Connection failed: %s; retrying in %ss", exc, delay)
            time.sleep(delay)
            delay = min(delay * 2, 30)


def run_agent(config_path: Path) -> None:
    config = AgentConfig.load(config_path)
    state = DERState(config=config)
    client = create_mqtt_client(config, state)

    connect_with_backoff(client, config)
    client.loop_start()

    running = True

    def handle_signal(signum: int, frame: Any) -> None:
        nonlocal running
        logging.info("Received signal %s; shutting down", signum)
        running = False

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    topic_prefix = config.topic_prefix.rstrip("/")
    publish_topic = f"{topic_prefix}/telemetry/{config.device_type}/{config.device_id}"
    interval = max(1, int(config.publish_interval_seconds))
    last_time = time.time()

    while running:
        now = time.time()
        dt = now - last_time
        last_time = now
        state.step(dt)
        payload = state.telemetry()
        try:
            client.publish(publish_topic, json.dumps(payload), qos=1, retain=False)
            logging.info("Published telemetry to %s: %s", publish_topic, payload)
        except Exception as exc:  # noqa: BLE001
            logging.error("Failed to publish telemetry: %s", exc)
        time.sleep(interval)

    client.loop_stop()
    client.disconnect()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Raspberry Pi DER MQTT agent")
    parser.add_argument("--config", type=Path, default=Path("config.json"), help="Path to config JSON file")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv or sys.argv[1:])
    try:
        run_agent(args.config)
    except Exception as exc:  # noqa: BLE001
        logging.error("Agent terminated due to error: %s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
