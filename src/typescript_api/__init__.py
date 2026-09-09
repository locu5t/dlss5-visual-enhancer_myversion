"""Local API used by the TypeScript DLSS 5 Visual Enhancer UI.

The TypeScript bridge needs the loopback browser player's URL. The preview
module intentionally kept its active-server helper private, so expose a tiny
compatibility function here without changing the processing path.
"""

from ..live import browser_preview as _browser_preview


def _preview_viewer_url(kind: str) -> str:
    server = _browser_preview._active_server(kind)
    return server.viewer_url if server is not None else ""


if not hasattr(_browser_preview, "preview_viewer_url"):
    _browser_preview.preview_viewer_url = _preview_viewer_url


__all__ = []
