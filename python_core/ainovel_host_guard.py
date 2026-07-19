"""
Import side-effect guard for toolbox CLIs.

Usage (first line inside ``if __name__ == "__main__"``)::

    import ainovel_host_guard  # noqa: F401

Refuses standalone Terminal / double-click without App host token.
Does not encrypt code — mutual host-binding only.
"""

from __future__ import annotations

from pathlib import Path
import sys

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from gateway.host_binding import require_host_or_exit

require_host_or_exit(as_json=True)
