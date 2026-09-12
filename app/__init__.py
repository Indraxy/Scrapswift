import sys
from pathlib import Path

_backend_dir = Path(__file__).resolve().parent.parent / "backend"
_backend_app_dir = _backend_dir / "app"

__path__ = [str(_backend_app_dir)]

if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))
