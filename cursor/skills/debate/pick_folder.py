#!/usr/bin/env python3
"""Open a native folder dialog; print chosen directory to stdout (empty if cancel).

Used by Debate Hall (hall_server) so the browser can obtain a real filesystem path
on the machine where the server runs. Tk runs in this subprocess, not in the HTTP thread.
"""

from __future__ import annotations

import sys


def main() -> int:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as e:
        print(f"tkinter unavailable: {e}", file=sys.stderr)
        return 2

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    try:
        path = filedialog.askdirectory(title="Debate Hall — select project folder")
    finally:
        try:
            root.destroy()
        except tk.TclError:
            pass
    sys.stdout.write((path or "").strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
