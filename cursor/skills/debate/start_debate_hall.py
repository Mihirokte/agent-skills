#!/usr/bin/env python3
"""
Debate Hall launcher — canonical way for humans and agents to run the hall.

Starts hall_server.py in the background and keeps it running until you click
Stop or close this window. Auto-starts the server when the UI opens.

  Windows (no console, GUI only): pythonw start_debate_hall.py [--port 8765] ...
  Or: Start-DebateHall.ps1 — uses pythonw + Start-Process so PowerShell exits immediately.

  Dev / with console: python start_debate_hall.py ...
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import tkinter as tk
from tkinter import messagebox, scrolledtext, ttk

DEBATE_DIR = Path(__file__).resolve().parent
HALL_SERVER = DEBATE_DIR / "hall_server.py"

DEFAULT_PORT = 8765
DEFAULT_HOST = "127.0.0.1"


def _request_graceful_hall_shutdown(host: str, port: int, timeout: float = 6.0) -> bool:
    """Ask hall_server to tear down cursor-agent children then stop (loopback POST)."""
    url = f"http://{host}:{port}/api/hall/shutdown"
    try:
        req = urllib.request.Request(
            url,
            data=b"{}",
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            code = resp.getcode()
            return 200 <= code < 300
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, TimeoutError):
        return False


def _popen_kwargs() -> dict:
    kw: dict = {
        "cwd": str(DEBATE_DIR),
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "bufsize": 1,
    }
    if sys.platform == "win32":
        kw["creationflags"] = subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
    return kw


class HallLauncher(tk.Tk):
    def __init__(self, autostart: bool, port: int, host: str):
        super().__init__()
        self._autostart = autostart
        self._port = port
        self._host = host
        self.proc: subprocess.Popen | None = None
        self._user_stopped = False
        self._exit_handled = False

        self.title("Debate Hall")
        self.minsize(420, 360)
        self.geometry("520x420")

        self._build_ui()

        self.protocol("WM_DELETE_WINDOW", self._on_close)
        if self._autostart:
            self.after(200, self._start_server)

    def _build_ui(self) -> None:
        outer = ttk.Frame(self, padding=12)
        outer.pack(fill=tk.BOTH, expand=True)

        ttk.Label(outer, text="Debate Hall", font=("", 14, "bold")).pack(anchor=tk.W)
        ttk.Label(
            outer,
            text="Server runs until you click Stop or close this window.",
            wraplength=480,
        ).pack(anchor=tk.W, pady=(4, 8))

        row = ttk.Frame(outer)
        row.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(row, text="URL:").pack(side=tk.LEFT)
        self.url_var = tk.StringVar(value="(not running)")
        ttk.Label(row, textvariable=self.url_var, foreground="#0a5").pack(
            side=tk.LEFT, padx=(6, 0)
        )

        btn_row = ttk.Frame(outer)
        btn_row.pack(fill=tk.X, pady=(0, 8))
        self.btn_start = ttk.Button(btn_row, text="Start", command=self._start_server)
        self.btn_start.pack(side=tk.LEFT, padx=(0, 6))
        self.btn_stop = ttk.Button(
            btn_row, text="Stop server", command=self._stop_server, state=tk.DISABLED
        )
        self.btn_stop.pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(btn_row, text="Open in browser", command=self._open_browser).pack(
            side=tk.LEFT, padx=(0, 6)
        )

        ttk.Label(outer, text="Server log").pack(anchor=tk.W)
        self.log = scrolledtext.ScrolledText(
            outer, height=14, wrap=tk.WORD, font=("Consolas", 9), state=tk.DISABLED
        )
        self.log.pack(fill=tk.BOTH, expand=True, pady=(4, 0))

        self.status_var = tk.StringVar(value="Idle")
        ttk.Label(outer, textvariable=self.status_var).pack(anchor=tk.W, pady=(8, 0))

    def _append_log(self, line: str) -> None:
        self.log.configure(state=tk.NORMAL)
        self.log.insert(tk.END, line)
        self.log.see(tk.END)
        self.log.configure(state=tk.DISABLED)

    def _stdout_reader(self) -> None:
        if not self.proc or not self.proc.stdout:
            self._reader_done.set()
            return
        try:
            for line in self.proc.stdout:
                self.after(0, self._append_log, line)
        except Exception:
            pass

    def _start_server(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            return
        if not HALL_SERVER.is_file():
            messagebox.showerror(
                "Missing file",
                f"hall_server.py not found next to this script:\n{HALL_SERVER}",
            )
            return

        self._user_stopped = False
        self._exit_handled = False
        self.proc = subprocess.Popen(
            [
                sys.executable,
                str(HALL_SERVER),
                "--host",
                self._host,
                "--port",
                str(self._port),
            ],
            **_popen_kwargs(),
        )
        threading.Thread(target=self._stdout_reader, daemon=True).start()

        url = f"http://{self._host}:{self._port}/"
        self.url_var.set(url)
        self.status_var.set("Running")
        self.btn_start.configure(state=tk.DISABLED)
        self.btn_stop.configure(state=tk.NORMAL)
        self._append_log(f"[launcher] Started hall_server on {url}\n")

        self.after(400, self._poll_proc)

    def _poll_proc(self) -> None:
        if self.proc is None:
            return
        code = self.proc.poll()
        if code is None:
            self.after(500, self._poll_proc)
            return
        self._on_process_exit(code)

    def _on_process_exit(self, code: int) -> None:
        if self._exit_handled:
            return
        self._exit_handled = True
        self.proc = None

        self.btn_start.configure(state=tk.NORMAL)
        self.btn_stop.configure(state=tk.DISABLED)
        self.url_var.set("(not running)")
        if self._user_stopped:
            self.status_var.set("Stopped")
            self._append_log(f"[launcher] Server stopped (exit {code}).\n")
        else:
            self.status_var.set(f"Exited ({code})")
            self._append_log(f"[launcher] Server exited unexpectedly (code {code}).\n")
            if code != 0:
                messagebox.showwarning(
                    "Debate Hall",
                    f"The server process ended (exit code {code}).\n"
                    "Port may be in use — try another port or close the other process.",
                )

    def _stop_server(self) -> None:
        if self.proc is None or self.proc.poll() is not None:
            return
        self._user_stopped = True
        self.status_var.set("Stopping…")
        self._append_log("[launcher] Stopping server…\n")
        if _request_graceful_hall_shutdown(self._host, self._port):
            self._append_log("[launcher] Graceful shutdown requested (agents stopped).\n")
        else:
            self._append_log("[launcher] Graceful shutdown HTTP failed — forcing process stop.\n")
        self.after(50, self._finish_stop)

    def _finish_stop(self) -> None:
        if self.proc is None or self._exit_handled:
            return
        rc = -1
        try:
            rc = self.proc.wait(timeout=12)
        except subprocess.TimeoutExpired:
            try:
                self.proc.terminate()
            except ProcessLookupError:
                pass
            try:
                rc = self.proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                try:
                    self.proc.kill()
                    rc = self.proc.wait(timeout=2)
                except ProcessLookupError:
                    rc = -1
        if not self._exit_handled:
            self._on_process_exit(rc if rc is not None else -1)

    def _open_browser(self) -> None:
        url = self.url_var.get()
        if url.startswith("http"):
            webbrowser.open(url)

    def _on_close(self) -> None:
        p = self.proc
        if p is not None and p.poll() is None:
            self._user_stopped = True
            _request_graceful_hall_shutdown(self._host, self._port)
            try:
                p.wait(timeout=12)
            except subprocess.TimeoutExpired:
                try:
                    p.terminate()
                    p.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    try:
                        p.kill()
                    except ProcessLookupError:
                        pass
                except ProcessLookupError:
                    pass
            except ProcessLookupError:
                pass
        self.destroy()


def main() -> None:
    parser = argparse.ArgumentParser(description="Debate Hall GUI launcher")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument(
        "--no-autostart",
        action="store_true",
        help="Open the window without starting the server (click Start).",
    )
    args = parser.parse_args()

    if not HALL_SERVER.is_file():
        print(f"ERROR: {HALL_SERVER} not found.", file=sys.stderr)
        sys.exit(1)

    app = HallLauncher(autostart=not args.no_autostart, port=args.port, host=args.host)
    app.mainloop()


if __name__ == "__main__":
    main()
