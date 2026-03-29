"""
Local HTTP server for the debate dashboard (stdlib only).

Serves static files from web/ and GET /api/snapshot with status + log tails.
"""

from __future__ import annotations

import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading

TAIL_BYTES = 16 * 1024
REPORT_PREVIEW_CHARS = 32_000

def build_snapshot(work_dir: Path) -> dict:
    wd = work_dir.resolve()
    status: dict = {}
    sf = wd / "status.json"
    if sf.is_file():
        try:
            status = json.loads(sf.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            status = {"phase": "unknown", "parse_error": "status.json unreadable"}

    log_tails: dict[str, str] = {}
    for pattern in ("eval_*.txt", "vote_*.txt", "debate_turns/*.txt"):
        for p in sorted(wd.glob(pattern)):
            if not p.is_file():
                continue
            try:
                raw = p.read_bytes()
                if len(raw) > TAIL_BYTES:
                    text = "…" + raw[-TAIL_BYTES:].decode("utf-8", errors="replace")
                else:
                    text = raw.decode("utf-8", errors="replace")
                log_tails[p.name] = text
            except OSError:
                log_tails[p.name] = ""

    report_preview = None
    rf = wd / "debate-report.md"
    if rf.is_file():
        try:
            report_preview = rf.read_text(encoding="utf-8", errors="replace")[:REPORT_PREVIEW_CHARS]
        except OSError:
            report_preview = None

    events: list[dict] = []
    ev_path = wd / "events.jsonl"
    if ev_path.is_file():
        try:
            lines = ev_path.read_text(encoding="utf-8", errors="replace").splitlines()
            for line in lines[-400:]:
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        except OSError:
            pass

    stream_line_count = 0
    stream_tail: list[dict] = []
    sp = wd / "stream.jsonl"
    if sp.is_file():
        try:
            slines = sp.read_text(encoding="utf-8", errors="replace").splitlines()
            stream_line_count = len(slines)
            for line in slines[-40:]:
                line = line.strip()
                if not line:
                    continue
                try:
                    stream_tail.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        except OSError:
            pass

    debate_turns_preview: list[dict] = []
    dtp = wd / "debate_turns.jsonl"
    if dtp.is_file():
        try:
            for line in dtp.read_text(encoding="utf-8", errors="replace").splitlines()[-30:]:
                line = line.strip()
                if not line:
                    continue
                try:
                    debate_turns_preview.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        except OSError:
            pass

    debate_graph_mermaid = None
    mg = wd / "debate_graph.mermaid"
    if mg.is_file():
        try:
            debate_graph_mermaid = mg.read_text(encoding="utf-8", errors="replace")[:32000]
        except OSError:
            pass

    debate_track = status.get("debate_track")
    if debate_track is None:
        debate_track = []

    improvement_plan_preview = None
    ipp = wd / "improvement-plan.md"
    if ipp.is_file():
        try:
            improvement_plan_preview = ipp.read_text(encoding="utf-8", errors="replace")[:16000]
        except OSError:
            pass

    return {
        "status": status,
        "log_tails": log_tails,
        "events": events,
        "has_results": (wd / "results.json").is_file(),
        "has_report": rf.is_file(),
        "report_preview": report_preview,
        "stream_line_count": stream_line_count,
        "stream_tail": stream_tail,
        "debate_turns_preview": debate_turns_preview,
        "debate_graph_mermaid": debate_graph_mermaid,
        "debate_track": debate_track,
        "improvement_plan_preview": improvement_plan_preview,
    }


def _make_handler(work_dir: Path, web_root: Path) -> type[BaseHTTPRequestHandler]:
    wd = work_dir.resolve()
    root = web_root.resolve()

    class DebateUIHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format, *args):
            pass

        def _send(self, code: int, body: bytes, content_type: str):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/" or path == "":
                fp = root / "index.html"
                if not fp.is_file():
                    self._send(500, b"index.html missing", "text/plain; charset=utf-8")
                    return
                self._send(200, fp.read_bytes(), "text/html; charset=utf-8")
                return

            if path.startswith("/static/"):
                rel = path[len("/static/") :].lstrip("/")
                if not rel or ".." in rel:
                    self.send_error(404)
                    return
                fp = (root / rel).resolve()
                if not str(fp).startswith(str(root)) or not fp.is_file():
                    self.send_error(404)
                    return
                mime, _ = mimetypes.guess_type(str(fp))
                ct = mime or "application/octet-stream"
                if ct.startswith("text/"):
                    ct = f"{ct}; charset=utf-8"
                self._send(200, fp.read_bytes(), ct)
                return

            if path == "/api/snapshot":
                snap = build_snapshot(wd)
                raw = json.dumps(snap, ensure_ascii=False).encode("utf-8")
                self._send(200, raw, "application/json; charset=utf-8")
                return

            self.send_error(404)

    return DebateUIHandler


def start_ui_server(work_dir: Path, port: int = 0) -> tuple[ThreadingHTTPServer, str]:
    """
    Start a daemon thread serving the dashboard. Bind 127.0.0.1 only.

    Returns (server, url). Caller may keep server reference; process exit stops it.
    """
    debate_dir = Path(__file__).resolve().parent
    web_root = debate_dir / "web"
    handler_cls = _make_handler(work_dir, web_root)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler_cls)
    actual_port = server.server_address[1]
    url = f"http://127.0.0.1:{actual_port}/"

    t = threading.Thread(target=server.serve_forever, daemon=True, name="debate-ui")
    t.start()
    return server, url
