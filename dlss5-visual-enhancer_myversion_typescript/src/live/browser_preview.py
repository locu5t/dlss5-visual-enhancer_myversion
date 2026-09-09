from __future__ import annotations

import html
import json
import math
import queue
import threading
import time
import weakref
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
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
    """Serve post-feature-18 frames to a browser player.

    Video mode keeps a bounded rolling JPEG history so the in-app monitor has
    play/pause and a real scrub bar without ever back-pressuring DLSS.
    Model3D mode uses the same frame transport but sends orbit/pan/zoom commands
    back to a persistent 3D renderer through ``camera_callback``.
    """

    def __init__(
        self,
        *,
        max_width: int = 1280,
        jpeg_quality: int = 82,
        history_seconds: float = 30.0,
        history_max_frames: int = 600,
        history_max_bytes: int = 96 * 1024 * 1024,
        mode: str = "video",
        camera_callback: Callable[[dict[str, float]], None] | None = None,
    ) -> None:
        self.max_width = max(320, int(max_width))
        self.jpeg_quality = max(40, min(95, int(jpeg_quality)))
        self.history_seconds = max(0.0, float(history_seconds))
        self.history_max_frames = max(1, int(history_max_frames))
        self.history_max_bytes = max(4 * 1024 * 1024, int(history_max_bytes))
        self.mode = "model3d" if mode == "model3d" else "video"
        self.camera_callback = camera_callback
        self._stop = threading.Event()
        self._frames: queue.Queue[np.ndarray | None] = queue.Queue(maxsize=1)
        self._condition = threading.Condition()
        self._jpeg: bytes | None = None
        self._sequence = 0
        self._width = 0
        self._height = 0
        self._history: deque[tuple[int, float, bytes]] = deque()
        self._history_bytes = 0
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

    def _metadata_locked(self) -> dict[str, Any]:
        first = self._history[0] if self._history else None
        last = self._history[-1] if self._history else None
        span = max(0.0, (last[1] - first[1]) if first and last else 0.0)
        fps = (len(self._history) - 1) / span if len(self._history) >= 2 and span > 0 else 0.0
        return {"width": self._width, "height": self._height, "sequence": self._sequence,
                "history_frames": len(self._history), "history_seconds": span, "fps": fps,
                "mode": self.mode, "live": not self._stop.is_set()}

    def _metadata(self) -> dict[str, Any]:
        with self._condition:
            return self._metadata_locked()

    def _history_frame(self, pos: float) -> bytes | None:
        with self._condition:
            if not self._history:
                return self._jpeg
            pos = max(0.0, min(1.0, float(pos)))
            index = min(len(self._history) - 1, round(pos * (len(self._history) - 1)))
            return self._history[index][2]

    @staticmethod
    def _video_player_page() -> str:
        return r'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DLSS 5 Live Player</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}html,body{margin:0;width:100%;background:#050607;color:#f4f4f5;font-family:Segoe UI,Arial,sans-serif}#shell{width:100%;background:#050607}#stage{--ratio:16/9;position:relative;width:100%;aspect-ratio:var(--ratio);display:grid;place-items:center;background:#000;overflow:hidden}#stage img{width:100%;height:100%;object-fit:contain;background:#000;user-select:none}#badge{position:absolute;left:12px;top:12px;padding:6px 9px;border-radius:999px;background:rgba(0,0,0,.65);font-size:12px;border:1px solid #2d3137}#transport{background:#101217;border-top:1px solid #30343c;padding:8px 10px}#timeline-row{display:grid;grid-template-columns:auto 1fr auto;gap:9px;align-items:center}#timeline{width:100%;accent-color:#12b981}#buttons{display:flex;align-items:center;gap:7px;margin-top:7px;flex-wrap:wrap}button,a{background:#222731;color:#fff;border:1px solid #3c424e;border-radius:5px;padding:6px 10px;font:inherit;cursor:pointer;text-decoration:none}button:hover,a:hover{background:#303744}#play{min-width:46px;font-size:16px}#live-dot{width:8px;height:8px;border-radius:50%;background:#14d594;display:inline-block;margin-right:5px}#state{margin-left:auto;color:#aeb4bf;font-size:12px}.time{font-variant-numeric:tabular-nums;color:#c4c8cf;font-size:12px;min-width:54px;text-align:center}
</style></head><body><div id="shell"><div id="stage"><img id="stream" src="/dlss5.mjpg" alt="DLSS 5 enhanced output"><div id="badge">POST-DLSS FEATURE 18</div></div><div id="transport"><div id="timeline-row"><span id="left-time" class="time">-0:00</span><input id="timeline" type="range" min="0" max="1000" value="1000" step="1" aria-label="Playback position"><span class="time">LIVE</span></div><div id="buttons"><button id="play">Pause</button><button id="live"><span id="live-dot"></span>Go Live</button><button id="snapshot">Snapshot</button><button id="fullscreen">Fullscreen</button><a href="/viewer.html" target="_blank" rel="noopener">Pop-out</a><span id="state">Live</span></div></div></div><script>
(()=>{const img=document.getElementById('stream'),stage=document.getElementById('stage'),slider=document.getElementById('timeline'),play=document.getElementById('play'),state=document.getElementById('state'),leftTime=document.getElementById('left-time');let liveMode=true,playing=true,reviewTimer=null,meta={history_seconds:0,width:0,height:0,fps:15};function fmt(s){s=Math.max(0,Number(s)||0);const m=Math.floor(s/60),x=Math.floor(s%60);return `${m}:${String(x).padStart(2,'0')}`}function aspect(){if(meta.width>0&&meta.height>0)stage.style.setProperty('--ratio',`${meta.width}/${meta.height}`);else if(img.naturalWidth&&img.naturalHeight)stage.style.setProperty('--ratio',`${img.naturalWidth}/${img.naturalHeight}`)}async function readMeta(){try{const r=await fetch('/meta.json?t='+Date.now(),{cache:'no-store'});if(r.ok)meta=await r.json();aspect();if(liveMode){slider.value=1000;leftTime.textContent='-'+fmt(meta.history_seconds)}else leftTime.textContent='-'+fmt(meta.history_seconds*(1-Number(slider.value)/1000))}catch(_){}}function stopTimer(){if(reviewTimer)clearInterval(reviewTimer);reviewTimer=null}function goLive(){stopTimer();liveMode=true;playing=true;slider.value=1000;img.src='/dlss5.mjpg?t='+Date.now();play.textContent='Pause';state.textContent='Live'}function showPosition(value,stop=true){if(stop)stopTimer();liveMode=false;const p=Math.max(0,Math.min(1,Number(value)/1000));img.src='/frame.jpg?pos='+p.toFixed(4)+'&t='+Date.now();leftTime.textContent='-'+fmt(meta.history_seconds*(1-p));state.textContent='Review'}function pause(){playing=false;if(liveMode){liveMode=false;slider.value=1000;img.src='/frame.jpg?pos=1&t='+Date.now()}stopTimer();play.textContent='Play';state.textContent='Paused'}function playReview(){if(liveMode)return goLive();playing=true;play.textContent='Pause';state.textContent='Playing buffer';stopTimer();let last=performance.now();reviewTimer=setInterval(()=>{const now=performance.now(),elapsed=(now-last)/1000;last=now;const span=Math.max(.25,meta.history_seconds||1);let value=Number(slider.value)+(1000*elapsed/span);if(value>=998)return goLive();slider.value=Math.min(1000,value);showPosition(slider.value,false);playing=true;state.textContent='Playing buffer'},Math.max(55,1000/Math.min(18,Math.max(5,meta.fps||12))))}slider.addEventListener('input',()=>{playing=false;play.textContent='Play';showPosition(slider.value)});play.addEventListener('click',()=>playing?pause():playReview());document.getElementById('live').addEventListener('click',goLive);document.getElementById('snapshot').addEventListener('click',()=>window.open('/snapshot.jpg?t='+Date.now(),'_blank','noopener'));document.getElementById('fullscreen').addEventListener('click',async()=>{try{if(!document.fullscreenElement)await stage.requestFullscreen();else await document.exitFullscreen()}catch(_){}});stage.addEventListener('dblclick',async()=>{try{await stage.requestFullscreen()}catch(_){}});img.addEventListener('load',aspect);document.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();play.click()}if(e.key.toLowerCase()==='f')document.getElementById('fullscreen').click()});readMeta();setInterval(readMeta,400)})();
</script></body></html>'''

    @staticmethod
    def _model_player_page() -> str:
        return r'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DLSS 5 Live 3D Viewer</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}html,body{margin:0;width:100%;background:#050607;color:#f4f4f5;font-family:Segoe UI,Arial,sans-serif}#stage{--ratio:16/9;position:relative;width:100%;aspect-ratio:var(--ratio);display:grid;place-items:center;background:#000;overflow:hidden;touch-action:none;cursor:grab}#stage.drag{cursor:grabbing}#stage img{width:100%;height:100%;object-fit:contain;background:#000;pointer-events:none;user-select:none}#badge{position:absolute;left:12px;top:12px;padding:6px 9px;border-radius:999px;background:rgba(0,0,0,.65);font-size:12px;border:1px solid #2d3137}#help{position:absolute;left:12px;bottom:12px;padding:7px 9px;background:rgba(0,0,0,.58);border-radius:6px;font-size:11px;color:#c8ccd3}#controls{display:flex;gap:7px;align-items:center;padding:8px 10px;background:#101217;border-top:1px solid #30343c;flex-wrap:wrap}button,a{background:#222731;color:#fff;border:1px solid #3c424e;border-radius:5px;padding:6px 10px;font:inherit;cursor:pointer;text-decoration:none}button:hover,a:hover{background:#303744}#state{margin-left:auto;color:#aeb4bf;font-size:12px}
</style></head><body><div id="stage"><img id="stream" src="/dlss5.mjpg" alt="DLSS 5 live 3D output"><div id="badge">DLSS 5 LIVE 3D • FEATURE 18</div><div id="help">Left drag: orbit • Right/Shift drag: pan • Wheel: zoom</div></div><div id="controls"><button id="reset">Reset View</button><button id="freeze">Freeze</button><button id="snapshot">Snapshot</button><button id="fullscreen">Fullscreen</button><a href="/viewer.html" target="_blank" rel="noopener">Pop-out</a><span id="state">Live</span></div><script>
(()=>{const stage=document.getElementById('stage'),img=document.getElementById('stream'),state=document.getElementById('state');let yaw=35,pitch=18,distance=2.8,pan_x=0,pan_y=0,dragging=false,lastX=0,lastY=0,button=0,frozen=false,pending=false;const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));async function send(){if(pending)return;pending=true;try{await fetch('/camera',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({yaw,pitch,distance,pan_x,pan_y}),cache:'no-store'});state.textContent='Rendering DLSS 5...'}catch(_){state.textContent='Camera update failed'}finally{pending=false}}function reset(){yaw=35;pitch=18;distance=2.8;pan_x=0;pan_y=0;send()}stage.addEventListener('pointerdown',e=>{dragging=true;button=e.button;lastX=e.clientX;lastY=e.clientY;stage.classList.add('drag');stage.setPointerCapture(e.pointerId)});stage.addEventListener('pointermove',e=>{if(!dragging)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;if(button===2||e.shiftKey){pan_x+=dx*.004;pan_y-=dy*.004}else{yaw+=dx*.35;pitch=clamp(pitch-dy*.35,-85,85)}send()});stage.addEventListener('pointerup',e=>{dragging=false;stage.classList.remove('drag');try{stage.releasePointerCapture(e.pointerId)}catch(_){}});stage.addEventListener('contextmenu',e=>e.preventDefault());stage.addEventListener('wheel',e=>{e.preventDefault();distance=clamp(distance*Math.exp(e.deltaY*.0012),1.1,9);send()},{passive:false});document.getElementById('reset').addEventListener('click',reset);document.getElementById('freeze').addEventListener('click',()=>{frozen=!frozen;document.getElementById('freeze').textContent=frozen?'Resume':'Freeze';img.src=frozen?('/snapshot.jpg?t='+Date.now()):('/dlss5.mjpg?t='+Date.now());state.textContent=frozen?'Frozen':'Live'});document.getElementById('snapshot').addEventListener('click',()=>window.open('/snapshot.jpg?t='+Date.now(),'_blank','noopener'));document.getElementById('fullscreen').addEventListener('click',async()=>{try{if(!document.fullscreenElement)await stage.requestFullscreen();else await document.exitFullscreen()}catch(_){}});stage.addEventListener('dblclick',async()=>{try{await stage.requestFullscreen()}catch(_){}});async function meta(){try{const r=await fetch('/meta.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)return;const m=await r.json();if(m.width&&m.height)stage.style.setProperty('--ratio',`${m.width}/${m.height}`);if(!frozen&&m.sequence>0)state.textContent='Live'}catch(_){}}meta();setInterval(meta,500);reset()})();
</script></body></html>'''

    def _viewer_page(self, embedded: bool) -> bytes:
        _ = embedded
        return (self._model_player_page() if self.mode == "model3d" else self._video_player_page()).encode("utf-8")

    def start(self) -> None:
        owner = self
        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *_args) -> None: return
            def _headers(self, content_type: str, length: int | None = None) -> None:
                self.send_header("Content-Type", content_type); self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"); self.send_header("Pragma", "no-cache"); self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Connection", "close")
                if length is not None: self.send_header("Content-Length", str(length))
                self.end_headers()
            def _write(self, status: int, content_type: str, payload: bytes) -> None:
                self.send_response(status); self._headers(content_type, len(payload)); self.wfile.write(payload)
            def do_POST(self) -> None:
                parsed = urlparse(self.path)
                if parsed.path != "/camera" or owner.mode != "model3d" or owner.camera_callback is None: self._write(404, "text/plain; charset=utf-8", b"Not found"); return
                try:
                    length=min(8192,int(self.headers.get("Content-Length") or "0")); data=json.loads(self.rfile.read(length).decode("utf-8","replace")); state={"yaw":float(data.get("yaw",35.0)),"pitch":float(data.get("pitch",18.0)),"distance":float(data.get("distance",2.8)),"pan_x":float(data.get("pan_x",0.0)),"pan_y":float(data.get("pan_y",0.0))}
                    if not all(math.isfinite(v) for v in state.values()): raise ValueError("non-finite camera value")
                    owner.camera_callback(state); self._write(200,"application/json",b'{"ok":true}')
                except Exception as exc: self._write(400,"application/json",json.dumps({"ok":False,"error":str(exc)}).encode())
            def do_GET(self) -> None:
                route=urlparse(self.path).path
                if route=="/viewer.html": self._write(200,"text/html; charset=utf-8",owner._viewer_page(True)); return
                if route=="/meta.json": self._write(200,"application/json",json.dumps(owner._metadata()).encode()); return
                if route in {"/snapshot.jpg","/frame.jpg"}:
                    if route=="/frame.jpg":
                        try: pos=float(parse_qs(urlparse(self.path).query).get("pos",["1"])[0])
                        except Exception: pos=1.0
                        jpeg=owner._history_frame(pos)
                    else:
                        with owner._condition: jpeg=owner._jpeg
                    self._write(200,"image/jpeg",jpeg) if jpeg else self._write(503,"text/plain",b"Waiting for frame"); return
                if route!="/dlss5.mjpg": self._write(404,"text/plain",b"Not found"); return
                self.send_response(200); self.send_header("Content-Type","multipart/x-mixed-replace; boundary=frame"); self.send_header("Cache-Control","no-store"); self.end_headers(); sequence=-1
                try:
                    while not owner._stop.is_set():
                        with owner._condition:
                            owner._condition.wait_for(lambda:owner._stop.is_set() or owner._sequence!=sequence,timeout=1.0)
                            if owner._stop.is_set(): break
                            jpeg=owner._jpeg; sequence=owner._sequence
                        if not jpeg: continue
                        self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n"+f"Content-Length: {len(jpeg)}\r\n\r\n".encode()+jpeg+b"\r\n"); self.wfile.flush()
                except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError,OSError): pass
        self._server=ThreadingHTTPServer(("127.0.0.1",0),Handler); self._server.daemon_threads=True
        self._server_thread=threading.Thread(target=self._server.serve_forever,kwargs={"poll_interval":.2},daemon=True,name="dlss5-browser-preview-http"); self._encode_thread=threading.Thread(target=self._encode_loop,daemon=True,name="dlss5-browser-preview-jpeg"); self._server_thread.start(); self._encode_thread.start()

    def offer_rgba(self, frame: np.ndarray) -> None:
        if self._stop.is_set() or not isinstance(frame,np.ndarray) or frame.ndim!=3:return
        try:self._frames.put_nowait(frame);return
        except queue.Full:pass
        try:self._frames.get_nowait()
        except queue.Empty:pass
        try:self._frames.put_nowait(frame)
        except queue.Full:pass

    def _encode_loop(self) -> None:
        while not self._stop.is_set():
            try: frame=self._frames.get(timeout=.25)
            except queue.Empty: continue
            if frame is None: break
            try:
                h,w=frame.shape[:2]; working=frame
                if w>self.max_width:
                    r=self.max_width/w; working=cv2.resize(working,(self.max_width,max(2,int(round(h*r)))),interpolation=cv2.INTER_AREA)
                c=working.shape[2]; bgr=cv2.cvtColor(working,cv2.COLOR_RGBA2BGR if c==4 else cv2.COLOR_RGB2BGR) if c in (3,4) else None
                if bgr is None: continue
                ok,encoded=cv2.imencode(".jpg",bgr,[int(cv2.IMWRITE_JPEG_QUALITY),self.jpeg_quality])
                if not ok: continue
                payload=encoded.tobytes(); now=time.monotonic()
                with self._condition:
                    self._width=int(working.shape[1]);self._height=int(working.shape[0]);self._jpeg=payload;self._sequence+=1
                    if self.mode=="video" and self.history_seconds>0:
                        self._history.append((self._sequence,now,payload));self._history_bytes+=len(payload);cutoff=now-self.history_seconds
                        while self._history and (self._history[0][1]<cutoff or len(self._history)>self.history_max_frames or self._history_bytes>self.history_max_bytes):
                            _s,_t,old=self._history.popleft();self._history_bytes-=len(old)
                    self._condition.notify_all()
            except Exception: continue

    def stop(self) -> None:
        if self._stop.is_set():return
        self._stop.set()
        with self._condition:self._condition.notify_all()
        try:self._frames.put_nowait(None)
        except queue.Full:pass
        if self._server:
            try:self._server.shutdown();self._server.server_close()
            except Exception:pass
        if self._server_thread:self._server_thread.join(timeout=2)
        if self._encode_thread:self._encode_thread.join(timeout=2)


def _register(kind:str,owner:Any,server:EnhancedPreviewServer)->None:
    with _REGISTRY_LOCK:_ACTIVE[kind]=(weakref.ref(owner),server)
def _unregister(kind:str,owner:Any,server:EnhancedPreviewServer)->None:
    with _REGISTRY_LOCK:
        c=_ACTIVE.get(kind)
        if c is not None and c[0]() is owner and c[1] is server:_ACTIVE.pop(kind,None)
def register_preview_server(kind:str,owner:Any,server:EnhancedPreviewServer)->None:_register(kind,owner,server)
def unregister_preview_server(kind:str,owner:Any,server:EnhancedPreviewServer)->None:_unregister(kind,owner,server)
def _active_server(kind:str)->EnhancedPreviewServer|None:
    with _REGISTRY_LOCK:
        c=_ACTIVE.get(kind)
        if c is None:return None
        if c[0]() is None:_ACTIVE.pop(kind,None);return None
        return c[1]
def preview_url(kind:str)->str:
    s=_active_server(kind);return s.url if s else ""
def preview_html(kind:str,title:str="DLSS 5 enhanced live view")->str:
    server=_active_server(kind); title_text=html.escape(title)
    if server is None or not server.viewer_url:return '<div style="width:100%;min-height:420px;background:#08090b;border:1px solid #34363d;border-radius:8px;display:grid;place-items:center;color:#a9adb7"><div><strong>'+title_text+'</strong><br><span>Start playback to show enhanced output here.</span></div></div>'
    viewer_url=html.escape(server.viewer_url+"?embedded=1",quote=True);popout_url=html.escape(server.viewer_url,quote=True);help_text="Drag the enhanced viewport to orbit; right/Shift-drag pans and the wheel zooms." if server.mode=="model3d" else "The playback bar reviews the most recent enhanced frames without slowing the live DLSS worker."
    return '<div style="width:100%;background:#08090b;border:1px solid #34363d;border-radius:8px;overflow:hidden"><iframe src="'+viewer_url+'" title="'+title_text+'" allow="fullscreen" allowfullscreen style="display:block;width:100%;height:72vh;min-height:440px;max-height:900px;border:0;background:#000"></iframe></div><div style="font-size:0.85em;color:#9ca3af;margin-top:6px">'+html.escape(help_text)+' <a href="'+popout_url+'" target="_blank" rel="noopener">Open full player</a>. Frames enter this viewer only after signed DLSS feature 18 returns.</div>'

def install_browser_preview()->None:
    global _INSTALLED
    with _INSTALL_LOCK:
        if _INSTALLED:return
        from .pipeline import LiveSession
        from ..realtime.pipeline import RealtimeSession
        original_process=DLSSFrameSession.process
        def process_with_preview(self,*args,**kwargs):
            result=original_process(self,*args,**kwargs);server=getattr(_TLS,"preview_server",None)
            if server is not None:
                try:server.offer_rgba(result[0])
                except Exception:pass
            return result
        DLSSFrameSession.process=process_with_preview
        def patch_session(cls,kind:str)->None:
            original_init=cls.__init__;original_run=cls.run
            def init_with_preview(self,*args,**kwargs):
                original_init(self,*args,**kwargs);server=None
                try:server=EnhancedPreviewServer(mode="video",history_seconds=30.0);server.start();_register(kind,self,server)
                except Exception:
                    if server is not None:server.stop()
                    server=None
                self._dlss5_browser_preview=server
            def run_with_preview(self,*args,**kwargs):
                server=getattr(self,"_dlss5_browser_preview",None);previous=getattr(_TLS,"preview_server",None);_TLS.preview_server=server
                try:return original_run(self,*args,**kwargs)
                finally:
                    if previous is None:
                        try:delattr(_TLS,"preview_server")
                        except AttributeError:pass
                    else:_TLS.preview_server=previous
                    if server is not None:_unregister(kind,self,server);server.stop()
            cls.__init__=init_with_preview;cls.run=run_with_preview
        patch_session(LiveSession,"live");patch_session(RealtimeSession,"realtime");_INSTALLED=True
