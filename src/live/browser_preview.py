from __future__ import annotations

import html
import queue
import threading
import time
import weakref
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np

from ..core.runtime import DLSSFrameSession


_INSTALL_LOCK = threading.Lock()
_REGISTRY_LOCK = threading.Lock()
_ACTIVE: dict[str, tuple[weakref.ReferenceType[Any], "EnhancedPreviewServer"]] = {}
_TLS = threading.local()
_INSTALLED = False


class EnhancedPreviewServer:
    """Serve post-feature-18 frames and a controlled browser viewport.

    JPEG encoding is isolated on a latest-frame queue so the browser can pause,
    reconnect or enter fullscreen without back-pressuring DLSS processing.
    """

    def __init__(self, *, max_width: int = 1280, jpeg_quality: int = 82) -> None:
        self.max_width = max(320, int(max_width))
        self.jpeg_quality = max(40, min(95, int(jpeg_quality)))
        self._stop = threading.Event()
        self._frames: queue.Queue[np.ndarray | None] = queue.Queue(maxsize=1)
        self._condition = threading.Condition()
        self._jpeg: bytes | None = None
        self._sequence = 0
        self._server: ThreadingHTTPServer | None = None
        self._server_thread: threading.Thread | None = None
        self._encode_thread: threading.Thread | None = None

    @property
    def base_url(self) -> str:
        if self._server is None:
            return ""
        return f"http://127.0.0.1:{int(self._server.server_address[1])}"

    @property
    def url(self) -> str:
        base = self.base_url
        return f"{base}/dlss5.mjpg" if base else ""

    @property
    def viewer_url(self) -> str:
        base = self.base_url
        return f"{base}/viewer.html" if base else ""

    def _viewer_page(self, embedded: bool) -> bytes:
        body_class = "embedded" if embedded else "standalone"
        page = f'''<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DLSS 5 Enhanced View</title>
<style>
html,body{{margin:0;width:100%;height:100%;background:#050607;color:#f4f4f5;font-family:Arial,sans-serif}}
#shell{{display:flex;flex-direction:column;width:100%;height:100%;background:#050607}}
#stage{{position:relative;flex:1;min-height:0;display:grid;place-items:center;background:#000;overflow:hidden}}
#stage img{{width:100%;height:100%;object-fit:contain;background:#000}}
#badge{{position:absolute;left:12px;top:12px;padding:6px 9px;border-radius:999px;background:rgba(0,0,0,.62);font-size:12px;border:1px solid #2d3137}}
#controls{{display:flex;gap:8px;align-items:center;padding:8px;background:#111318;border-top:1px solid #2c3037;flex-wrap:wrap}}
button,a{{background:#242831;color:#fff;border:1px solid #3d424d;border-radius:6px;padding:7px 11px;font:inherit;cursor:pointer;text-decoration:none}}
button:hover,a:hover{{background:#313744}}
#state{{margin-left:auto;font-size:12px;color:#a9adb7}}
body.embedded #controls{{padding:6px}}
</style>
</head>
<body class="{body_class}">
<div id="shell">
  <div id="stage">
    <img id="stream" src="/dlss5.mjpg?t={time.time_ns()}" alt="DLSS 5 enhanced output">
    <div id="badge">POST-DLSS FEATURE 18</div>
  </div>
  <div id="controls">
    <button id="play">Pause</button>
    <button id="live">Go Live</button>
    <button id="snapshot">Snapshot</button>
    <button id="fullscreen">Fullscreen</button>
    <a href="/viewer.html" target="_blank" rel="noopener">Pop-out</a>
    <span id="state">Live</span>
  </div>
</div>
<script>
(() => {{
  const img = document.getElementById('stream');
  const play = document.getElementById('play');
  const state = document.getElementById('state');
  let playing = true;
  function goLive() {{
    img.src = '/dlss5.mjpg?t=' + Date.now();
    playing = true; play.textContent = 'Pause'; state.textContent = 'Live';
  }}
  function pause() {{
    img.src = '/snapshot.jpg?t=' + Date.now();
    playing = false; play.textContent = 'Play'; state.textContent = 'Paused';
  }}
  play.addEventListener('click', () => playing ? pause() : goLive());
  document.getElementById('live').addEventListener('click', goLive);
  document.getElementById('snapshot').addEventListener('click', () =>
    window.open('/snapshot.jpg?t=' + Date.now(), '_blank', 'noopener'));
  document.getElementById('fullscreen').addEventListener('click', async () => {{
    const stage = document.getElementById('stage');
    try {{ if (!document.fullscreenElement) await stage.requestFullscreen(); else await document.exitFullscreen(); }} catch (_) {{}}
  }});
  document.getElementById('stage').addEventListener('dblclick', async () => {{
    try {{ await document.getElementById('stage').requestFullscreen(); }} catch (_) {{}}
  }});
  document.addEventListener('keydown', (event) => {{
    if (event.code === 'Space') {{ event.preventDefault(); playing ? pause() : goLive(); }}
    if (event.key.toLowerCase() === 'f') document.getElementById('fullscreen').click();
  }});
}})();
</script>
</body>
</html>'''
        return page.encode("utf-8")

    def start(self) -> None:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args) -> None:
                return

            def _headers(self, content_type: str, length: int | None = None) -> None:
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                self.send_header("Pragma", "no-cache")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Connection", "close")
                if length is not None:
                    self.send_header("Content-Length", str(length))
                self.end_headers()

            def do_GET(self) -> None:  # noqa: N802
                parsed = urlparse(self.path)
                route = parsed.path
                if route == "/viewer.html":
                    embedded = parse_qs(parsed.query).get("embedded", ["0"])[0] == "1"
                    payload = owner._viewer_page(embedded)
                    self.send_response(200)
                    self._headers("text/html; charset=utf-8", len(payload))
                    self.wfile.write(payload)
                    return
                if route == "/snapshot.jpg":
                    with owner._condition:
                        jpeg = owner._jpeg
                    if jpeg is None:
                        payload = b"Waiting for frame"
                        self.send_response(503)
                        self._headers("text/plain; charset=utf-8", len(payload))
                        self.wfile.write(payload)
                        return
                    self.send_response(200)
                    self._headers("image/jpeg", len(jpeg))
                    self.wfile.write(jpeg)
                    return
                if route != "/dlss5.mjpg":
                    payload = b"Not found"
                    self.send_response(404)
                    self._headers("text/plain; charset=utf-8", len(payload))
                    self.wfile.write(payload)
                    return

                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                self.send_header("Pragma", "no-cache")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                sequence = -1
                try:
                    while not owner._stop.is_set():
                        with owner._condition:
                            owner._condition.wait_for(
                                lambda: owner._stop.is_set() or owner._sequence != sequence,
                                timeout=1.0,
                            )
                            if owner._stop.is_set():
                                break
                            jpeg = owner._jpeg
                            sequence = owner._sequence
                        if not jpeg:
                            continue
                        self.wfile.write(b"--frame\r\n")
                        self.wfile.write(b"Content-Type: image/jpeg\r\n")
                        self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode("ascii"))
                        self.wfile.write(jpeg)
                        self.wfile.write(b"\r\n")
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    pass

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self._server_thread = threading.Thread(
            target=self._server.serve_forever,
            kwargs={"poll_interval": 0.2},
            daemon=True,
            name="dlss5-browser-preview-http",
        )
        self._encode_thread = threading.Thread(
            target=self._encode_loop,
            daemon=True,
            name="dlss5-browser-preview-jpeg",
        )
        self._server_thread.start()
        self._encode_thread.start()

    def offer_rgba(self, frame: np.ndarray) -> None:
        if self._stop.is_set() or not isinstance(frame, np.ndarray) or frame.ndim != 3:
            return
        try:
            self._frames.put_nowait(frame)
            return
        except queue.Full:
            pass
        try:
            self._frames.get_nowait()
        except queue.Empty:
            pass
        try:
            self._frames.put_nowait(frame)
        except queue.Full:
            pass

    def _encode_loop(self) -> None:
        while not self._stop.is_set():
            try:
                frame = self._frames.get(timeout=0.25)
            except queue.Empty:
                continue
            if frame is None:
                break
            try:
                height, width = frame.shape[:2]
                working = frame
                if width > self.max_width:
                    ratio = self.max_width / width
                    working = cv2.resize(
                        working,
                        (self.max_width, max(2, int(round(height * ratio)))),
                        interpolation=cv2.INTER_AREA,
                    )
                channels = working.shape[2]
                if channels == 4:
                    bgr = cv2.cvtColor(working, cv2.COLOR_RGBA2BGR)
                elif channels == 3:
                    bgr = cv2.cvtColor(working, cv2.COLOR_RGB2BGR)
                else:
                    continue
                ok, encoded = cv2.imencode(
                    ".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality]
                )
                if not ok:
                    continue
                with self._condition:
                    self._jpeg = encoded.tobytes()
                    self._sequence += 1
                    self._condition.notify_all()
            except Exception:
                continue

    def stop(self) -> None:
        if self._stop.is_set():
            return
        self._stop.set()
        with self._condition:
            self._condition.notify_all()
        try:
            self._frames.put_nowait(None)
        except queue.Full:
            try:
                self._frames.get_nowait()
                self._frames.put_nowait(None)
            except (queue.Empty, queue.Full):
                pass
        if self._server is not None:
            try:
                self._server.shutdown()
            except Exception:
                pass
            try:
                self._server.server_close()
            except Exception:
                pass
        if self._server_thread is not None:
            self._server_thread.join(timeout=2)
        if self._encode_thread is not None:
            self._encode_thread.join(timeout=2)


def _register(kind: str, session: Any, server: EnhancedPreviewServer) -> None:
    with _REGISTRY_LOCK:
        _ACTIVE[kind] = (weakref.ref(session), server)


def _unregister(kind: str, session: Any, server: EnhancedPreviewServer) -> None:
    with _REGISTRY_LOCK:
        current = _ACTIVE.get(kind)
        if current is not None and current[0]() is session and current[1] is server:
            _ACTIVE.pop(kind, None)


def _active_server(kind: str) -> EnhancedPreviewServer | None:
    with _REGISTRY_LOCK:
        current = _ACTIVE.get(kind)
        if current is None:
            return None
        if current[0]() is None:
            _ACTIVE.pop(kind, None)
            return None
        return current[1]


def preview_url(kind: str) -> str:
    server = _active_server(kind)
    return server.url if server is not None else ""


def preview_html(kind: str, title: str = "DLSS 5 enhanced live view") -> str:
    server = _active_server(kind)
    title_text = html.escape(title)
    if server is None or not server.viewer_url:
        return (
            '<div style="width:100%;aspect-ratio:16/9;background:#08090b;border:1px solid #34363d;'
            'border-radius:8px;display:grid;place-items:center;color:#a9adb7">'
            f'<div><strong>{title_text}</strong><br><span>Start playback to show enhanced frames here.</span></div>'
            "</div>"
        )
    viewer_url = html.escape(server.viewer_url + "?embedded=1", quote=True)
    popout_url = html.escape(server.viewer_url, quote=True)
    return (
        '<div style="width:100%;background:#08090b;border:1px solid #34363d;border-radius:8px;overflow:hidden">'
        f'<iframe src="{viewer_url}" title="{title_text}" allow="fullscreen" allowfullscreen '
        'style="display:block;width:100%;aspect-ratio:16/9;border:0;background:#000"></iframe>'
        "</div>"
        '<div style="font-size:0.85em;color:#9ca3af;margin-top:6px">'
        'The viewport has Pause/Play, Go Live, Snapshot and Fullscreen controls. '
        f'<a href="{popout_url}" target="_blank" rel="noopener">Open full player</a>. '
        "Frames enter this viewer only after signed DLSS feature 18 returns."
        "</div>"
    )


def install_browser_preview() -> None:
    """Attach controlled in-app preview to Live and Realtime without native DLL changes."""
    global _INSTALLED
    with _INSTALL_LOCK:
        if _INSTALLED:
            return
        from .pipeline import LiveSession
        from ..realtime.pipeline import RealtimeSession

        original_process = DLSSFrameSession.process

        def process_with_preview(self, *args, **kwargs):
            result = original_process(self, *args, **kwargs)
            server = getattr(_TLS, "preview_server", None)
            if server is not None:
                try:
                    server.offer_rgba(result[0])
                except Exception:
                    pass
            return result

        DLSSFrameSession.process = process_with_preview

        def patch_session(cls, kind: str) -> None:
            original_init = cls.__init__
            original_run = cls.run

            def init_with_preview(self, *args, **kwargs):
                original_init(self, *args, **kwargs)
                server = None
                try:
                    server = EnhancedPreviewServer()
                    server.start()
                    _register(kind, self, server)
                except Exception:
                    if server is not None:
                        server.stop()
                    server = None
                self._dlss5_browser_preview = server

            def run_with_preview(self, *args, **kwargs):
                server = getattr(self, "_dlss5_browser_preview", None)
                previous = getattr(_TLS, "preview_server", None)
                _TLS.preview_server = server
                try:
                    return original_run(self, *args, **kwargs)
                finally:
                    if previous is None:
                        try:
                            delattr(_TLS, "preview_server")
                        except AttributeError:
                            pass
                    else:
                        _TLS.preview_server = previous
                    if server is not None:
                        _unregister(kind, self, server)
                        server.stop()

            cls.__init__ = init_with_preview
            cls.run = run_with_preview

        patch_session(LiveSession, "live")
        patch_session(RealtimeSession, "realtime")
        _INSTALLED = True
