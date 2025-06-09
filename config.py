import json
from pathlib import Path


def load_config(path: str = 'config.json'):
    cfg_path = Path(path)
    if not cfg_path.is_file():
        raise FileNotFoundError(f'Config file {path} not found')
    with cfg_path.open() as f:
        return json.load(f)

CONFIG = load_config()
