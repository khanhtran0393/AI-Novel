"""
AI Novel — standalone scheduler job store (JSON).

Replaces broken decompiled models/database.py scheduler methods.
Does NOT depend on NAVTools.exe.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
PROJECT = ROOT.parent
DEFAULT_STORE = PROJECT / "public" / "navtools" / "scheduler" / "jobs.json"

_lock = threading.Lock()


def _path(store_path: str | Path | None = None) -> Path:
    p = Path(store_path) if store_path else DEFAULT_STORE
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _load(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {"version": 1, "jobs": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"version": 1, "jobs": []}
        if not isinstance(data.get("jobs"), list):
            data["jobs"] = []
        return data
    except Exception:
        return {"version": 1, "jobs": []}


def _save(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def list_jobs(store_path: str | Path | None = None) -> list[dict[str, Any]]:
    path = _path(store_path)
    with _lock:
        data = _load(path)
        return list(data.get("jobs") or [])


def get_job(job_id: str, store_path: str | Path | None = None) -> dict[str, Any] | None:
    for j in list_jobs(store_path):
        if str(j.get("id")) == str(job_id):
            return j
    return None


def save_job(job: dict[str, Any], store_path: str | Path | None = None) -> dict[str, Any]:
    path = _path(store_path)
    with _lock:
        data = _load(path)
        jobs: list[dict] = list(data.get("jobs") or [])
        jid = str(job.get("id") or "").strip() or str(uuid.uuid4())
        job = {**job, "id": jid, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        if "created_at" not in job:
            job["created_at"] = job["updated_at"]
        found = False
        for i, existing in enumerate(jobs):
            if str(existing.get("id")) == jid:
                jobs[i] = {**existing, **job}
                found = True
                break
        if not found:
            jobs.append(job)
        data["jobs"] = jobs
        _save(path, data)
        return job


def delete_job(job_id: str, store_path: str | Path | None = None) -> bool:
    path = _path(store_path)
    with _lock:
        data = _load(path)
        before = len(data.get("jobs") or [])
        data["jobs"] = [j for j in (data.get("jobs") or []) if str(j.get("id")) != str(job_id)]
        _save(path, data)
        return len(data["jobs"]) < before


def store_info(store_path: str | Path | None = None) -> dict[str, Any]:
    path = _path(store_path)
    jobs = list_jobs(path)
    return {
        "path": str(path),
        "count": len(jobs),
        "standalone": True,
        "backend": "json",
    }
