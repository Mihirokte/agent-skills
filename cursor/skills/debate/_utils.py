"""
Shared utilities for the debate skill modules.

Collected from duplicated patterns across debate.py, hall_server.py,
ui_server.py, debate_planner.py, and start_debate_hall.py.
"""

from __future__ import annotations

import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path


# ── Filesystem / Git ─────────────────────────────────────────────────────────

def find_git_root(path: Path) -> Path | None:
    """Walk up from *path* looking for a .git directory (depth-capped)."""
    cur = path.resolve()
    if not cur.is_dir():
        cur = cur.parent
    for _ in range(64):
        if (cur / ".git").exists():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    return None


def is_git_repo(path: Path) -> bool:
    """Return True if *path* is inside a git work tree (subprocess check)."""
    try:
        kw: dict = {
            "args": ["git", "-C", str(path), "rev-parse", "--is-inside-work-tree"],
            "capture_output": True,
            "text": True,
            "timeout": 8,
        }
        flags = subprocess_creation_flags()
        if flags:
            kw["creationflags"] = flags
        r = subprocess.run(**kw)
        return r.returncode == 0 and (r.stdout or "").strip() == "true"
    except (OSError, subprocess.TimeoutExpired):
        return False


# ── Platform helpers ─────────────────────────────────────────────────────────

def subprocess_creation_flags() -> int:
    """Return CREATE_NO_WINDOW on Windows, 0 elsewhere."""
    if sys.platform == "win32":
        return subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
    return 0


# ── JSON / JSONL I/O ────────────────────────────────────────────────────────

def safe_read_json(path: Path, default=None):
    """Read a JSON file, returning *default* on any I/O or parse error."""
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def safe_write_json(path: Path, data, *, indent: int = 2) -> None:
    """Write *data* as JSON to *path* with utf-8 encoding."""
    path.write_text(
        json.dumps(data, indent=indent, ensure_ascii=False), encoding="utf-8"
    )


def read_jsonl_tail(path: Path, limit: int = 500) -> list[dict]:
    """Read the last *limit* lines of a JSONL file, skipping bad lines."""
    if not path.is_file():
        return []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    out: list[dict] = []
    for line in lines[-limit:] if limit else lines:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def read_jsonl_tail_with_count(path: Path, limit: int = 500) -> tuple[int, list[dict]]:
    """Like read_jsonl_tail but also returns the total line count."""
    if not path.is_file():
        return 0, []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return 0, []
    total = len(lines)
    out: list[dict] = []
    for line in lines[-limit:] if limit else lines:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return total, out


# ── HTTP mixin ───────────────────────────────────────────────────────────────

class SendMixin:
    """Mixin for BaseHTTPRequestHandler subclasses (no-store cache control)."""

    def _send(self: BaseHTTPRequestHandler, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
