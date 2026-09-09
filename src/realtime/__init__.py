"""Internal low-latency backend used by the unified Live tab.

The Realtime UI was merged into ``src.live.ui``. Keeping this package backend-
only avoids importing a second, duplicate set of Gradio controls and prevents
circular UI imports when the unified Live module selects the realtime backend.
"""

from .models import RealtimeInfo, RealtimeOptions
from .pipeline import (
    is_realtime_running,
    realtime_status,
    start_realtime_session,
    stop_realtime_session,
)

__all__ = [
    "RealtimeInfo",
    "RealtimeOptions",
    "is_realtime_running",
    "realtime_status",
    "start_realtime_session",
    "stop_realtime_session",
]
