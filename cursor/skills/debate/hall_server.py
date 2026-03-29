#!/usr/bin/env python3
"""
Debate Hall — long-running localhost server for archived debates + live runs.

  python hall_server.py [--port 8765]

Keeps running until Ctrl+C. Open http://127.0.0.1:8765/ — start debates from the
UI or queue via: python debate.py <dir> --hall-url http://127.0.0.1:8765

Runs are stored under debate_hall_data/runs/<uuid>/
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import uuid
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from datetime import datetime
from urllib.parse import parse_qs, unquote, urlparse

DEBATE_DIR = Path(__file__).resolve().parent
DATA_DIR = DEBATE_DIR / "debate_hall_data"
RUNS_DIR = DATA_DIR / "runs"
HALL_WEB = DEBATE_DIR / "hall_web"
MERMAID_API_CAP = 32000

_run_lock = threading.Lock()
_active: dict[str, threading.Thread] = {}

_pick_lock = threading.Lock()
_pick_states: dict[str, dict] = {}
_pick_procs: dict[str, subprocess.Popen] = {}

_plan_lock = threading.Lock()
_plan_states: dict[str, dict] = {}


def _ensure_paths():
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "plan_scratch").mkdir(parents=True, exist_ok=True)


def _find_git_root(path: Path) -> Path | None:
    cur = path.resolve()
    for _ in range(64):
        if (cur / ".git").exists():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    return None


def inspect_target_path(tpath: Path) -> dict:
    """
    Lightweight git metadata for the Hall UI (path picker / defaults).
    """
    out: dict = {
        "path": str(tpath.resolve()),
        "exists": tpath.is_dir(),
        "is_git": False,
        "git_root": None,
        "branch": None,
        "head_short": None,
        "error": None,
    }
    if not tpath.is_dir():
        out["error"] = "not a directory"
        return out
    root = _find_git_root(tpath)
    if root is None:
        return out
    out["is_git"] = True
    out["git_root"] = str(root)
    try:
        br = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if br.returncode == 0:
            b = (br.stdout or "").strip()
            if b and b != "HEAD":
                out["branch"] = b
        hd = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if hd.returncode == 0:
            out["head_short"] = (hd.stdout or "").strip()[:40]
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as e:
        out["error"] = str(e)
    return out


def _plan_worker(token: str, query: str, target_str: str, timeout_each: int) -> None:
    try:
        tpath = Path(target_str).resolve()
        if not tpath.is_dir():
            raise ValueError("target is not a directory")
        scratch = DATA_DIR / "plan_scratch" / token
        scratch.mkdir(parents=True, exist_ok=True)
        sys.path.insert(0, str(DEBATE_DIR))
        from debate_planner import run_guided_plan

        plan = run_guided_plan(
            query,
            tpath,
            timeout_per_agent=timeout_each,
            scratch_dir=scratch,
        )
        with _plan_lock:
            _plan_states[token] = {"done": True, "plan": plan, "error": None}
    except Exception as e:
        with _plan_lock:
            _plan_states[token] = {"done": True, "plan": None, "error": str(e)}


def _load_meta(run_dir: Path) -> dict:
    mf = run_dir / "meta.json"
    if mf.is_file():
        try:
            return json.loads(mf.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    return {"run_id": run_dir.name, "label": run_dir.name, "status": "unknown"}


def _list_runs() -> list[dict]:
    _ensure_paths()
    rows = []
    for p in sorted(RUNS_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if not p.is_dir():
            continue
        m = _load_meta(p)
        m.setdefault("run_id", p.name)
        m["path"] = str(p)
        rows.append(m)
    return rows


def _read_events(run_dir: Path, limit: int = 500) -> list[dict]:
    ev = run_dir / "events.jsonl"
    if not ev.is_file():
        return []
    try:
        lines = ev.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    out = []
    for line in lines[-limit:]:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _run_job(
    run_id: str,
    target_str: str,
    num_agents: int,
    timeout: int,
    debate_mode: str = "sequential",
    max_findings_debate: int | None = None,
    improvement_plan: bool = False,
    use_git_worktrees: bool = False,
):
    if str(DEBATE_DIR) not in sys.path:
        sys.path.insert(0, str(DEBATE_DIR))

    import debate as debate_mod

    run_dir = RUNS_DIR / run_id
    target = Path(target_str).resolve()
    meta = _load_meta(run_dir)
    meta["status"] = "running"
    meta["updated_at"] = datetime.now().isoformat()
    (run_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    try:
        code = debate_mod.execute_debate(
            target,
            run_dir,
            num_agents,
            timeout,
            print_banner=False,
            print_report_stdout=False,
            debate_mode=debate_mode,
            max_findings_debate=max_findings_debate,
            improvement_plan=improvement_plan,
            use_git_worktrees=use_git_worktrees,
        )
        meta["status"] = "complete" if code == 0 else "failed"
    except Exception as e:
        meta["status"] = "error"
        meta["error"] = str(e)
    finally:
        meta["ended_at"] = datetime.now().isoformat()
        meta["updated_at"] = meta["ended_at"]
        (run_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    with _run_lock:
        _active.pop(run_id, None)


def _picker_worker(token: str) -> None:
    """Run pick_folder.py in a subprocess so /api/pick-folder/cancel can terminate it."""
    script = DEBATE_DIR / "pick_folder.py"
    proc: subprocess.Popen | None = None
    try:
        proc = subprocess.Popen(
            [sys.executable, str(script)],
            cwd=str(DEBATE_DIR),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        with _pick_lock:
            if _pick_states.get(token, {}).get("cancel_requested"):
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    pass
                _pick_states[token] = {
                    "done": True,
                    "path": "",
                    "cancelled": True,
                    "error": None,
                }
                return
            _pick_procs[token] = proc

        try:
            out, err = proc.communicate(timeout=7200)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
                out, err = proc.communicate(timeout=5)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                out, err = "", ""
            with _pick_lock:
                _pick_states[token] = {
                    "done": True,
                    "path": "",
                    "cancelled": True,
                    "error": "dialog timed out",
                }
            return

        stderr = (err or "").strip()
        path = (out or "").strip()
        with _pick_lock:
            cancelled_req = bool(_pick_states.get(token, {}).get("cancel_requested"))
        if cancelled_req:
            with _pick_lock:
                _pick_states[token] = {
                    "done": True,
                    "path": "",
                    "cancelled": True,
                    "error": None,
                }
            return
        if path:
            err_msg = None
            cancelled = False
        elif proc.returncode == 0:
            err_msg = None
            cancelled = True
        else:
            err_msg = stderr or f"exit {proc.returncode}"
            cancelled = False
        with _pick_lock:
            _pick_states[token] = {
                "done": True,
                "path": path,
                "cancelled": cancelled,
                "error": err_msg,
            }
    except Exception as e:
        with _pick_lock:
            _pick_states[token] = {
                "done": True,
                "path": "",
                "cancelled": True,
                "error": str(e),
            }
    finally:
        with _pick_lock:
            _pick_procs.pop(token, None)


def make_handler_class():
    class HallHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            pass

        def handle(self):
            try:
                super().handle()
            except (ConnectionResetError, BrokenPipeError):
                # Client closed the socket mid-request (tab closed, prefetch cancelled, etc.)
                return
            except OSError as e:
                if getattr(e, "winerror", None) == 10054:
                    return
                raise

        def _send(self, code: int, body: bytes, ctype: str):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path in ("/", ""):
                fp = HALL_WEB / "index.html"
                if not fp.is_file():
                    self._send(500, b"hall_web/index.html missing", "text/plain; charset=utf-8")
                    return
                self._send(200, fp.read_bytes(), "text/html; charset=utf-8")
                return

            if path.startswith("/static/"):
                rel = path[len("/static/") :].lstrip("/")
                if not rel or ".." in rel:
                    self.send_error(404)
                    return
                fp = (HALL_WEB / rel).resolve()
                if not str(fp).startswith(str(HALL_WEB.resolve())) or not fp.is_file():
                    self.send_error(404)
                    return
                mime, _ = mimetypes.guess_type(str(fp))
                ct = (mime or "application/octet-stream")
                if ct.startswith("text/"):
                    ct = f"{ct}; charset=utf-8"
                self._send(200, fp.read_bytes(), ct)
                return

            if path.startswith("/api/target-inspect"):
                parsed = urlparse(self.path)
                qs = parse_qs(parsed.query)
                raw_p = (qs.get("path") or [""])[0]
                path_param = unquote(raw_p).strip()
                if not path_param:
                    self._send(
                        400,
                        b'{"error":"path query parameter required"}',
                        "application/json; charset=utf-8",
                    )
                    return
                try:
                    tpath = Path(path_param).expanduser().resolve()
                except OSError as e:
                    body = json.dumps(
                        {"error": str(e), "path": path_param},
                        ensure_ascii=False,
                    ).encode("utf-8")
                    self._send(400, body, "application/json; charset=utf-8")
                    return
                info = inspect_target_path(tpath)
                self._send(
                    200,
                    json.dumps(info, ensure_ascii=False).encode("utf-8"),
                    "application/json; charset=utf-8",
                )
                return

            if path == "/api/runs":
                self._send(
                    200,
                    json.dumps({"runs": _list_runs()}, ensure_ascii=False).encode("utf-8"),
                    "application/json; charset=utf-8",
                )
                return

            if path.startswith("/api/runs/") and path.endswith("/stream"):
                run_id = path[len("/api/runs/") : -len("/stream")].strip("/")
                if not run_id or "/" in run_id:
                    self.send_error(404)
                    return
                rd = (RUNS_DIR / run_id).resolve()
                if not str(rd).startswith(str(RUNS_DIR.resolve())) or not rd.is_dir():
                    self.send_error(404)
                    return
                parsed = urlparse(self.path)
                qs = parse_qs(parsed.query)
                try:
                    after = int((qs.get("after") or ["0"])[0])
                except ValueError:
                    after = 0
                sf = rd / "stream.jsonl"
                events = []
                total = 0
                next_i = after
                if sf.is_file():
                    try:
                        lines = sf.read_text(encoding="utf-8", errors="replace").splitlines()
                    except OSError:
                        lines = []
                    total = len(lines)
                    end = min(after + 400, total)
                    for i in range(after, end):
                        line = lines[i].strip()
                        if not line:
                            continue
                        try:
                            events.append(json.loads(line))
                        except json.JSONDecodeError:
                            continue
                    next_i = end
                body = json.dumps(
                    {"events": events, "next": next_i, "total": total},
                    ensure_ascii=False,
                ).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
                return

            if path.startswith("/api/runs/") and path.endswith("/mermaid"):
                run_id = path[len("/api/runs/") : -len("/mermaid")].strip("/")
                if not run_id or "/" in run_id:
                    self.send_error(404)
                    return
                rd = (RUNS_DIR / run_id).resolve()
                if not str(rd).startswith(str(RUNS_DIR.resolve())) or not rd.is_dir():
                    self.send_error(404)
                    return
                mf = rd / "debate_graph.mermaid"
                if not mf.is_file():
                    body = json.dumps(
                        {"mermaid": None, "rev": None},
                        ensure_ascii=False,
                    ).encode("utf-8")
                    self._send(200, body, "application/json; charset=utf-8")
                    return
                try:
                    st = mf.stat()
                    rev_ns = getattr(st, "st_mtime_ns", int(st.st_mtime * 1_000_000_000))
                    rev = f"{rev_ns}-{st.st_size}"
                    raw = mf.read_text(encoding="utf-8", errors="replace")
                    if len(raw) > MERMAID_API_CAP:
                        raw = raw[:MERMAID_API_CAP]
                    body = json.dumps(
                        {"mermaid": raw, "rev": rev},
                        ensure_ascii=False,
                    ).encode("utf-8")
                except OSError:
                    body = json.dumps(
                        {"mermaid": None, "rev": None},
                        ensure_ascii=False,
                    ).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
                return

            if path.startswith("/api/plan-run/result"):
                parsed = urlparse(self.path)
                qs = parse_qs(parsed.query)
                token = (qs.get("token") or [""])[0]
                if not token:
                    self._send(400, b'{"error":"token required"}', "application/json; charset=utf-8")
                    return
                with _plan_lock:
                    st = _plan_states.get(token)
                if st is None:
                    self._send(404, b'{"error":"unknown token"}', "application/json; charset=utf-8")
                    return
                if not st.get("done"):
                    body = json.dumps({"pending": True}, ensure_ascii=False).encode("utf-8")
                    self._send(200, body, "application/json; charset=utf-8")
                    return
                body = json.dumps(
                    {
                        "pending": False,
                        "plan": st.get("plan"),
                        "error": st.get("error"),
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
                return

            if path.startswith("/api/pick-folder/result"):
                parsed = urlparse(self.path)
                qs = parse_qs(parsed.query)
                token = (qs.get("token") or [""])[0]
                if not token:
                    self._send(400, b'{"error":"token required"}', "application/json; charset=utf-8")
                    return
                with _pick_lock:
                    st = _pick_states.get(token)
                if st is None:
                    self._send(404, b'{"error":"unknown token"}', "application/json; charset=utf-8")
                    return
                if not st.get("done"):
                    body = json.dumps({"pending": True}, ensure_ascii=False).encode("utf-8")
                    self._send(200, body, "application/json; charset=utf-8")
                    return
                body = json.dumps(
                    {
                        "pending": False,
                        "path": st.get("path", ""),
                        "cancelled": bool(st.get("cancelled")),
                        "error": st.get("error"),
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
                return

            if path.startswith("/api/runs/") and not path.endswith(
                "/snapshot",
            ) and not path.endswith("/stream") and not path.endswith("/mermaid"):
                run_id = path[len("/api/runs/") :].strip("/")
                if not run_id or "/" in run_id:
                    self.send_error(404)
                    return
                rd = (RUNS_DIR / run_id).resolve()
                if not str(rd).startswith(str(RUNS_DIR.resolve())) or not rd.is_dir():
                    self.send_error(404)
                    return
                sys.path.insert(0, str(DEBATE_DIR))
                from ui_server import build_snapshot

                snap = build_snapshot(rd)
                snap["meta"] = _load_meta(rd)
                self._send(
                    200,
                    json.dumps(snap, ensure_ascii=False).encode("utf-8"),
                    "application/json; charset=utf-8",
                )
                return

            self.send_error(404)

        def do_POST(self):
            post_path = self.path.split("?", 1)[0]
            if post_path == "/api/plan-run/start":
                n = int(self.headers.get("Content-Length", "0") or "0")
                raw = self.rfile.read(n) if n else b"{}"
                try:
                    data = json.loads(raw.decode("utf-8"))
                except json.JSONDecodeError:
                    self._send(400, b'{"error":"invalid json"}', "application/json; charset=utf-8")
                    return
                query = (data.get("query") or "").strip()
                target = (data.get("target") or "").strip()
                if not query:
                    self._send(
                        400,
                        b'{"error":"query required"}',
                        "application/json; charset=utf-8",
                    )
                    return
                if len(query) > 12000:
                    self._send(
                        400,
                        b'{"error":"query too long"}',
                        "application/json; charset=utf-8",
                    )
                    return
                if not target:
                    self._send(
                        400,
                        b'{"error":"target required"}',
                        "application/json; charset=utf-8",
                    )
                    return
                tpath = Path(str(target)).resolve()
                if not tpath.is_dir():
                    self._send(
                        400,
                        json.dumps({"error": "not a directory", "target": str(tpath)}).encode("utf-8"),
                        "application/json; charset=utf-8",
                    )
                    return
                try:
                    timeout_each = int(data.get("timeout_per_agent", 180))
                except (TypeError, ValueError):
                    timeout_each = 180
                timeout_each = max(60, min(600, timeout_each))
                token = str(uuid.uuid4())
                with _plan_lock:
                    _plan_states[token] = {"done": False, "plan": None, "error": None}
                th = threading.Thread(
                    target=_plan_worker,
                    args=(token, query, str(tpath), timeout_each),
                    daemon=True,
                    name=f"plan-run-{token[:8]}",
                )
                th.start()
                body = json.dumps({"token": token}, ensure_ascii=False).encode("utf-8")
                self._send(201, body, "application/json; charset=utf-8")
                return

            if post_path == "/api/pick-folder/start":
                token = str(uuid.uuid4())
                with _pick_lock:
                    _pick_states[token] = {"done": False}
                th = threading.Thread(
                    target=_picker_worker,
                    args=(token,),
                    daemon=True,
                    name=f"pick-folder-{token[:8]}",
                )
                th.start()
                body = json.dumps({"token": token}, ensure_ascii=False).encode("utf-8")
                self._send(201, body, "application/json; charset=utf-8")
                return

            if post_path == "/api/pick-folder/cancel":
                n = int(self.headers.get("Content-Length", "0") or "0")
                raw = self.rfile.read(n) if n else b"{}"
                try:
                    data = json.loads(raw.decode("utf-8"))
                except json.JSONDecodeError:
                    self._send(400, b'{"error":"invalid json"}', "application/json; charset=utf-8")
                    return
                token = (data.get("token") or "").strip()
                if not token:
                    self._send(
                        400,
                        b'{"error":"token required"}',
                        "application/json; charset=utf-8",
                    )
                    return
                proc_to_kill = None
                with _pick_lock:
                    st = _pick_states.get(token)
                    if st is None:
                        self._send(
                            404,
                            b'{"error":"unknown token"}',
                            "application/json; charset=utf-8",
                        )
                        return
                    if st.get("done"):
                        body = json.dumps({"ok": True, "already": True}, ensure_ascii=False).encode(
                            "utf-8",
                        )
                        self._send(200, body, "application/json; charset=utf-8")
                        return
                    st["cancel_requested"] = True
                    proc_to_kill = _pick_procs.get(token)
                if proc_to_kill is not None and proc_to_kill.poll() is None:
                    try:
                        proc_to_kill.terminate()
                    except ProcessLookupError:
                        pass
                body = json.dumps({"ok": True}, ensure_ascii=False).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
                return

            if post_path != "/api/runs":
                self.send_error(404)
                return
            n = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(n) if n else b"{}"
            try:
                data = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                self._send(400, b'{"error":"invalid json"}', "application/json")
                return

            target = data.get("target")
            if not target:
                self._send(400, b'{"error":"target required"}', "application/json")
                return

            tpath = Path(str(target)).resolve()
            if not tpath.is_dir():
                self._send(
                    400,
                    json.dumps({"error": "not a directory", "target": str(tpath)}).encode("utf-8"),
                    "application/json; charset=utf-8",
                )
                return

            num_agents = int(data.get("agents", 3))
            timeout = int(data.get("timeout", 300))
            if num_agents < 2:
                num_agents = 2
            debate_mode = str(data.get("debate_mode", "sequential")).lower()
            if debate_mode not in ("sequential", "legacy"):
                debate_mode = "sequential"
            max_fd = data.get("max_findings_debate")
            max_findings_debate = int(max_fd) if max_fd is not None and str(max_fd).strip() != "" else None
            improvement_plan = bool(data.get("improvement_plan"))
            use_git_worktrees = bool(data.get("use_git_worktrees"))

            guided = data.get("guided")
            if guided is not None and not isinstance(guided, dict):
                self._send(
                    400,
                    b'{"error":"guided must be an object"}',
                    "application/json; charset=utf-8",
                )
                return

            run_id = str(uuid.uuid4())
            run_dir = RUNS_DIR / run_id
            run_dir.mkdir(parents=True, exist_ok=True)

            label = data.get("label") or tpath.name
            meta = {
                "run_id": run_id,
                "target": str(tpath),
                "label": label,
                "status": "queued",
                "started_at": datetime.now().isoformat(),
                "num_agents": num_agents,
                "timeout": timeout,
                "debate_mode": debate_mode,
                "max_findings_debate": max_findings_debate,
                "improvement_plan": improvement_plan,
                "use_git_worktrees": use_git_worktrees,
            }
            if guided:
                slim = {
                    "user_query": str(guided.get("user_query", ""))[:12000],
                    "focus_points": guided.get("focus_points"),
                    "query_rephrase": guided.get("query_rephrase"),
                    "internal_rationale": guided.get("internal_rationale"),
                    "planner_version": guided.get("planner_version"),
                }
                if not isinstance(slim["focus_points"], list):
                    slim["focus_points"] = []
                meta["guided"] = slim
                (run_dir / "run_plan.json").write_text(
                    json.dumps(guided, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
            (run_dir / "meta.json").write_text(
                json.dumps(meta, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            th = threading.Thread(
                target=_run_job,
                args=(
                    run_id,
                    str(tpath),
                    num_agents,
                    timeout,
                    debate_mode,
                    max_findings_debate,
                    improvement_plan,
                    use_git_worktrees,
                ),
                daemon=True,
                name=f"debate-{run_id[:8]}",
            )
            with _run_lock:
                _active[run_id] = th
            th.start()

            body = json.dumps({"run_id": run_id, "url": f"/#/run/{run_id}"}).encode("utf-8")
            self._send(201, body, "application/json; charset=utf-8")

    return HallHandler


def main():
    parser = argparse.ArgumentParser(description="Debate Hall persistent server")
    parser.add_argument("--port", type=int, default=8765, help="Listen port (default 8765)")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default 127.0.0.1)")
    args = parser.parse_args()

    _ensure_paths()
    Handler = make_handler_class()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    print("=" * 60)
    print("  DEBATE HALL")
    print("=" * 60)
    print(f"  Open:  {url}")
    print(f"  Runs:  {RUNS_DIR}")
    print("  Queue: python debate.py <dir> --hall-url " + url.rstrip("/"))
    print("  Stop:  Ctrl+C")
    print("=" * 60)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Hall] Shutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
