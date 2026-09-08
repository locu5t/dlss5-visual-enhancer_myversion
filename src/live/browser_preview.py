from __future__ import annotations

import html
import queue
import threading
import time
import weakref
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import cv2
import numpy as np

from ..core.runtime import DLSSFrameSession


_INSTALL_LOCK = threading.Lock()
_REGISTRY_LOCK = threading.Lock()
_ACTIVE: dict[str, tuple[weakref.ReferenceType[Any], "EnhancedPreviewServer"]] = {}
_TLS = threading.local()
_INSTALLED = False


class EnhancedPreviewServer:
    """Serve the latest signed-DLSS output as a low-overhead MJPEG stream.

    Encoding happens on a dedicated thread and the queue retains only the newest
    frame, so a slow browser preview can never back-pressure the DLSS pipeline.
    Audio remains on the existing MPV/HLS transport; this endpoint is the visual
    in-app preview only.
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
    def url(self) -> str:
        if self._server is None:
            return ""
        port = int(self._server.server_address[1])
        return f"http://127.0.0.1:{port}/dlss5.mjpg"

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

            def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
                route = self.path.split("?", 1)[0]
                if route == "/snapshot.jpg":
                    with owner._condition:
                        jpeg = owner._jpeg
                    if jpeg is None:
                        self.send_response(503)
                        self._headers("text/plain; charset=utf-8", 18)
                        self.wfile.write(b"Waiting for frame")
                        return
                    self.send_response(200)
                    self._headers("image/jpeg", len(jpeg))
                    self.wfile.write(jpeg)
                    return
                if route != "/dlss5.mjpg":
                    self.send_response(404)
                    self._headers("text/plain; charset=utf-8", 9)
                    self.wfile.write(b"Not found")
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
                    target = (self.max_width, max(2, int(round(height * ratio))))
                    working = cv2.resize(working, target, interpolation=cv2.INTER_AREA)
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
                payload = encoded.tobytes()
                with self._condition:
                    self._jpeg = payload
                    self._sequence += 1
                    self._condition.notify_all()
            except Exception:
                # Browser preview must never stop the signed DLSS pipeline.
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


def preview_url(kind: str) -> str:
    with _REGISTRY_LOCK:
        current = _ACTIVE.get(kind)
        if current is None:
            return ""
        session = current[0]()
        if session is None:
            _ACTIVE.pop(kind, None)
            return ""
        return current[1].url


def preview_html(kind: str, title: str = "DLSS 5 enhanced live view") -> str:
    url = preview_url(kind)
    title_text = html.escape(title)
    if not url:
        return (
            '<div style="width:100%;aspect-ratio:16/9;background:#08090b;border:1px solid #34363d;'
            'border-radius:8px;display:grid;place-items:center;color:#a9adb7">'
            f'<div><strong>{title_text}</strong><br><span>Start playback to show enhanced frames here.</span></div>'
            "</div>"
        )
    safe_url = html.escape(url, quote=True)
    return (
        '<div style="width:100%;background:#08090b;border:1px solid #34363d;border-radius:8px;overflow:hidden">'
        f'<img src="{safe_url}?t={time.time_ns()}" alt="{title_text}" '
        'style="display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#000">'
        "</div>"
        '<div style="font-size:0.85em;color:#9ca3af;margin-top:6px">'
        "This viewport shows frames after signed DLSS feature 18. Audio/playback controls remain on the existing MPV/HLS path."
        "</div>"
    )


def install_browser_preview() -> None:
    """Attach in-app MJPEG preview to Live and Realtime without touching native DLLs."""
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
