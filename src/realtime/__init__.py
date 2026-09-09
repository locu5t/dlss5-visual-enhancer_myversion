"""Internal low-latency backend used by the unified Live tab.

The Realtime UI was merged into ``src.live.ui``. Keeping this package backend-
only avoids importing a second, duplicate set of Gradio controls and prevents
circular UI imports when the unified Live module selects the realtime backend.
"""

from .models import RealtimeInfo, RealtimeOptions
from . import pipeline as _pipeline
from .thread_compat import install_thread_started_guard

# RealtimeSession subclasses threading.Thread. Its legacy timing field was also
# named ``_started``, which is reserved by Thread for a threading.Event. Install
# the guard before the first session object can be constructed.
install_thread_started_guard(_pipeline.RealtimeSession)

is_realtime_running = _pipeline.is_realtime_running
realtime_status = _pipeline.realtime_status
start_realtime_session = _pipeline.start_realtime_session
stop_realtime_session = _pipeline.stop_realtime_session

__all__ = [
    "RealtimeInfo",
    "RealtimeOptions",
    "is_realtime_running",
    "realtime_status",
    "start_realtime_session",
    "stop_realtime_session",
]
