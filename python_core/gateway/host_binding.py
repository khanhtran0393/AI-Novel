"""Host binding for AI Novel toolbox / NAV gateway.

Tools refuse to run unless launched by the main app with a valid
AINOVEL_HOST_TOKEN (HMAC, short TTL). No encryption — mutual auth only.

Modes (AINOVEL_HOST_BINDING):
  enforce (default) — require valid token
  open              — skip (dev emergency only)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

HOST_APP_NAME = "AI Novel"
REFUSE_CODE = "HOST_BINDING"


def _mode() -> str:
    m = (os.environ.get("AINOVEL_HOST_BINDING") or "enforce").strip().lower()
    if m in ("open", "off", "0", "false"):
        return "open"
    return "enforce"


def _secret() -> str:
    return (os.environ.get("AINOVEL_HOST_BINDING_SECRET") or "").strip()


def _b64url_decode(s: str) -> bytes:
    pad = "=" * ((4 - len(s) % 4) % 4)
    b64 = s.replace("-", "+").replace("_", "/") + pad
    import base64

    return base64.b64decode(b64)


def _b64url_encode(raw: bytes) -> str:
    import base64

    return base64.b64encode(raw).decode("ascii").replace("+", "-").replace("/", "_").rstrip("=")


def verify_host_token(token: str | None) -> tuple[bool, str, dict[str, Any] | None]:
    """Return (ok, error_message, claims)."""
    if _mode() == "open":
        return True, "", {"host": HOST_APP_NAME, "mode": "open"}

    secret = _secret()
    if not secret:
        return False, "Host-binding enforce thiếu secret do App cấp.", None

    if not token or not isinstance(token, str) or "." not in token:
        return (
            False,
            "NAV/Toolbox bị khóa host-binding: thiếu AINOVEL_HOST_TOKEN. "
            "Chỉ App AI Novel được phép gọi tool này — không chạy độc lập từ Terminal.",
            None,
        )

    body, sig = token.rsplit(".", 1)
    if not body or not sig:
        return False, "Host token không hợp lệ (format).", None

    expect = _b64url_encode(
        hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(sig, expect):
        return (
            False,
            "Host token sai chữ ký. Tool chỉ chấp nhận lời gọi từ App AI Novel.",
            None,
        )

    try:
        claims = json.loads(_b64url_decode(body).decode("utf-8"))
    except Exception:
        return False, "Host token không parse được payload.", None

    if not isinstance(claims, dict):
        return False, "Host token payload không hợp lệ.", None

    host = str(claims.get("host") or "").strip()
    if host != HOST_APP_NAME:
        return False, f"Host token host mismatch (got {host!r}).", None

    exp = claims.get("exp")
    if not isinstance(exp, (int, float)):
        return False, "Host token thiếu exp.", None
    if int(exp) < int(time.time()):
        return False, "Host token hết hạn. Gọi lại từ App AI Novel.", None

    return True, "", claims


def check_host_binding() -> tuple[bool, str, dict[str, Any] | None]:
    """Read token from env and verify."""
    token = (os.environ.get("AINOVEL_HOST_TOKEN") or "").strip()
    return verify_host_token(token or None)


def refuse_payload(message: str) -> dict[str, Any]:
    return {
        "success": False,
        "error": message,
        "code": REFUSE_CODE,
        "standalone": False,
        "host_required": HOST_APP_NAME,
        "hint": "Chạy tool qua App AI Novel (callNavGateway / API). Không double-click / python script trực tiếp.",
    }


def require_host_or_exit(*, as_json: bool = True) -> dict[str, Any] | None:
    """
    For CLI scripts: exit process if unbound.
    Returns None when OK; never returns on failure (sys.exit).
    """
    ok, err, claims = check_host_binding()
    if ok:
        return claims
    payload = refuse_payload(err)
    if as_json:
        print(json.dumps(payload, ensure_ascii=False), flush=True)
    else:
        print(err, file=sys.stderr, flush=True)
    raise SystemExit(2)


def ensure_host_bound() -> dict[str, Any]:
    """
    For gateway: return refuse dict if unbound, else claims.
    Caller should short-circuit on success=False.
    """
    ok, err, claims = check_host_binding()
    if ok:
        return {"success": True, "claims": claims or {}}
    return refuse_payload(err)


def guard_cli_entry() -> None:
    """
    One-liner for toolbox CLIs under python_core/*.py:

        if __name__ == "__main__":
            from gateway.host_binding import guard_cli_entry
            guard_cli_entry()
            ...

    Ensures sys.path includes python_core root when double-clicked.
    """
    root = Path(__file__).resolve().parent.parent
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    require_host_or_exit(as_json=True)
