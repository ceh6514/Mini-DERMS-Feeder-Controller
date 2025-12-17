import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pi_der_agent import AgentConfig


def test_load_sets_default_topic_prefix(tmp_path: Path) -> None:
    config_path = tmp_path / "config.json"
    config_data = {
        "broker_host": "localhost",
        "broker_port": 1883,
        "device_id": "pi-der-001",
        "device_type": "battery",
        "site_id": "home-site",
        "p_max_kw": 5.0,
        "publish_interval_seconds": 5,
    }
    config_path.write_text(json.dumps(config_data))

    config = AgentConfig.load(config_path)

    assert config.topic_prefix == "der"
