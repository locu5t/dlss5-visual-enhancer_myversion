from __future__ import annotations

import numbers
from typing import TypeVar


T = TypeVar("T", bound=type)


def install_thread_started_guard(session_cls: T) -> T:
    """Protect ``threading.Thread._started`` from RealtimeSession timing writes.

    ``threading.Thread`` owns ``_started`` and stores a ``threading.Event`` there.
    RealtimeSession also used ``self._started`` for a ``time.monotonic()``
    timestamp. That replaced the Event with a float, so ``Thread.start()``
    failed immediately at ``self._started.is_set()``.

    Redirect only numeric timestamp writes to ``_dlss5_started_at``. Non-numeric
    values pass through unchanged so ``threading.Thread.__init__`` keeps its
    real Event object. The guard also catches the second timestamp write at the
    beginning of ``RealtimeSession.run()``.
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
