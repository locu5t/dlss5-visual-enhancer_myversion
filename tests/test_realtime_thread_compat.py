from __future__ import annotations

import importlib.util
import threading
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "dlss5_realtime_thread_compat_test_module",
    ROOT / "src" / "realtime" / "thread_compat.py",
)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
install_thread_started_guard = MODULE.install_thread_started_guard


class _CollisionThread(threading.Thread):
    def __init__(self) -> None:
        super().__init__(daemon=True)
        # Reproduce the exact RealtimeSession bug. Without the guard this
        # replaces Thread._started (a threading.Event) with a float.
        self._started = 1.25

    def run(self) -> None:
        self._started = 2.5


class RealtimeThreadCompatTests(unittest.TestCase):
    def test_numeric_started_writes_do_not_replace_thread_event(self) -> None:
        install_thread_started_guard(_CollisionThread)
        thread = _CollisionThread()

        self.assertTrue(callable(getattr(thread._started, "is_set", None)))
        self.assertEqual(thread._dlss5_started_at, 1.25)

        thread.start()
        thread.join(timeout=2)

        self.assertFalse(thread.is_alive())
        self.assertTrue(thread._started.is_set())
        self.assertEqual(thread._dlss5_started_at, 2.5)

    def test_guard_is_idempotent(self) -> None:
        first = install_thread_started_guard(_CollisionThread)
        second = install_thread_started_guard(_CollisionThread)
        self.assertIs(first, second)


if __name__ == "__main__":
    unittest.main()
