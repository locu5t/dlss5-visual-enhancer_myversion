from __future__ import annotations

import numbers
from typing import TypeVar


T = TypeVar("T", bound=type)


def install_thread_started_guard(session_cls: T) -> T:
    """Protect ``threading.Thread._started`` from RealtimeSession timing writes.

    ``threading.Thread`` owns ``_started`` and stores a ``threading.Event`` there.
    The RealtimeSession implementation also used ``self._started`` for a
    ``time.monotonic()`` timestamp. That replaces the Event with a float, so
    ``Thread.start()`` immediately fails at ``self._started.is_set()`` with:

        AttributeError: 'float' object has no attribute 'is_set'

    This compatibility guard redirects only numeric writes intended as the
    DLSS session timestamp to ``_dlss5_started_at``. Thread's real Event value
    is left untouched. The guard is installed before any RealtimeSession is
    instantiated and also protects the second numeric write at the beginning
    of ``RealtimeSession.run()``.

    It is intentionally narrow: non-numeric writes to ``_started`` are passed
    through unchanged so ``threading.Thread.__init__`` can install its Event.
    """
    if getattr(session_cls, "_dlss5_thread_started_guard", False):
        return session_cls

    original_setattr = session_cls.__setattr__

    def guarded_setattr(self, name, value):
        if (
            name == "_started"
            and isinstance(value, numbers.Real)
            and not isinstance(value, bool)
        ):
            original_setattr(self, "_dlss5_started_at", float(value))
            return
        original_setattr(self, name, value)

    session_cls.__setattr__ = guarded_setattr
    session_cls._dlss5_thread_started_guard = True
    return session_cls
