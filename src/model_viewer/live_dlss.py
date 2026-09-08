from __future__ import annotations

import atexit
import json
import math
import socket
import struct
import subprocess
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any

import numpy as np

from ..core.gpu_selection import resolve_runtime_ai_gpu
from ..core.jobs import Cancelled, JobController, active_job
from ..core.paths import LOGS
from ..core.runtime import (
    DLSSFrameSession,
    prepare_runtime,
    resolve_native_settings,
    resolve_output_size,
    resolve_upscaling_mode,
    verify_feature_18,
)
from ..live.browser_preview import EnhancedPreviewServer, register_preview_server, unregister_preview_server
from ..neural_rendering.video.guides import TemporalGuideGenerator
from ..settings.storage import processing_gpu_settings
from .converter import MODEL_CACHE, _find_blender

MODEL_LIVE_RESOLUTIONS = {"540p": (960, 540), "720p": (1280, 720), "1080p": (1920, 1080)}
MODEL_LIVE_FRAME_COUNT = 1_000_000_000
_LOCK = threading.Lock()
_CURRENT: "ModelLiveSession | None" = None
_LAST: "ModelLiveInfo | None" = None


@dataclass(slots=True)
class ModelLiveOptions:
    model_path: str = ""
    resolution: str = "720p"
    nr_preset: str = "Default"
    nr_style: str = "Default"
    nr_intensity: float = 1.0
    local_tone_strength: float = 1.0
    local_structure_strength: float = 1.0
    skin_structure_strength: float = -1.0
    upscaling_factor: float = 1.5
    automatic_mask: bool = False
    dlss_model_preset: str = "Default"


@dataclass(slots=True)
class ModelLiveInfo:
    running: bool = False
    status: str = "Idle."
    requested_gpu: str = ""
    input_size: str = ""
    output_size: str = ""
    frames: int = 0
    render_ms: float = 0.0
    guide_ms: float = 0.0
    dlss_ms: float = 0.0
    effective_fps: float = 0.0
    feature_18_confirmed: bool = False
    report_path: str = ""
    failures: list[str] = field(default_factory=list)


_BLENDER_LIVE_SCRIPT = r'''
import bpy
import json
import math
import socket
import struct
import sys
from pathlib import Path
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
src = Path(args[0]); host = args[1]; port = int(args[2]); width = int(args[3]); height = int(args[4]); ext = src.suffix.lower()

def clear_scene():
    bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)

def call_operator(modern, legacy=None):
    target = bpy.ops
    for part in modern.split("."):
        target = getattr(target, part, None)
        if target is None: break
    if target is not None: target(filepath=str(src)); return
    if legacy:
        target = bpy.ops
        for part in legacy.split("."):
            target = getattr(target, part, None)
            if target is None: break
        if target is not None: target(filepath=str(src)); return
    raise RuntimeError(f"No Blender importer is available for {ext}")

clear_scene()
if ext in {".glb", ".gltf"}: bpy.ops.import_scene.gltf(filepath=str(src))
elif ext == ".obj": call_operator("wm.obj_import", "import_scene.obj")
elif ext == ".stl": call_operator("wm.stl_import", "import_mesh.stl")
elif ext == ".ply": call_operator("wm.ply_import", "import_mesh.ply")
elif ext == ".fbx": bpy.ops.import_scene.fbx(filepath=str(src))
elif ext == ".dae": bpy.ops.wm.collada_import(filepath=str(src))
elif ext == ".abc": bpy.ops.wm.alembic_import(filepath=str(src))
elif ext in {".usd", ".usda", ".usdc", ".usdz"}: bpy.ops.wm.usd_import(filepath=str(src))
else: raise RuntimeError(f"Live DLSS 3D requires a Blender-readable mesh. Convert {ext} to GLB first.")

objects = [o for o in bpy.context.scene.objects if getattr(o, "bound_box", None)]
if not objects: raise RuntimeError("Imported model has no renderable bounded objects.")
points = []
for obj in objects:
    try: points.extend([obj.matrix_world @ Vector(corner) for corner in obj.bound_box])
    except Exception: pass
if not points: raise RuntimeError("Could not determine model bounds.")
mins = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
maxs = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
center = (mins + maxs) * 0.5
size = max(maxs.x - mins.x, maxs.y - mins.y, maxs.z - mins.z, 0.001)
radius = max(size * 0.5, 0.001)
camera_data = bpy.data.cameras.new("DLSS5LiveCamera"); camera = bpy.data.objects.new("DLSS5LiveCamera", camera_data); bpy.context.scene.collection.objects.link(camera); bpy.context.scene.camera = camera
camera_data.lens = 52.0; camera_data.clip_start = max(0.0001, radius / 1000.0); camera_data.clip_end = max(1000.0, radius * 100.0)
world = bpy.context.scene.world
if world is not None: world.color = (0.025, 0.028, 0.035)

def add_area(name, location, energy, size_scale):
    data = bpy.data.lights.new(name=name, type="AREA"); data.energy = energy; data.shape = "DISK"; data.size = max(0.1, radius * size_scale)
    obj = bpy.data.objects.new(name, data); bpy.context.scene.collection.objects.link(obj); obj.location = center + Vector(location) * radius; obj.rotation_euler = (center - obj.location).to_track_quat("-Z", "Y").to_euler()
add_area("Key", (2.2, -2.0, 2.8), 1100, 2.5); add_area("Fill", (-2.0, -0.5, 1.2), 650, 2.0); add_area("Rim", (0.5, 2.1, 2.0), 800, 1.5)
scene = bpy.context.scene
for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: scene.render.engine = engine; break
    except Exception: pass
scene.render.resolution_x = width; scene.render.resolution_y = height; scene.render.resolution_percentage = 100; scene.render.film_transparent = False
try: scene.view_settings.look = "Medium High Contrast"
except Exception: pass

def recv_exact(sock, count):
    chunks=[]; total=0
    while total<count:
        part=sock.recv(count-total)
        if not part: raise EOFError("Controller disconnected")
        chunks.append(part); total += len(part)
    return b"".join(chunks)

def recv_message(sock):
    size=struct.unpack("!I", recv_exact(sock,4))[0]
    if size>1024*1024: raise RuntimeError("Control packet too large")
    return json.loads(recv_exact(sock,size).decode("utf-8"))

def send_response(sock, meta, payload=b""):
    header=json.dumps(meta).encode("utf-8"); sock.sendall(struct.pack("!I",len(header))); sock.sendall(header)
    if payload: sock.sendall(payload)

def apply_camera(state):
    yaw=math.radians(float(state.get("yaw",35.0))); pitch=math.radians(max(-85.0,min(85.0,float(state.get("pitch",18.0))))); distance=max(1.1,min(9.0,float(state.get("distance",2.8)))); pan_x=max(-4.0,min(4.0,float(state.get("pan_x",0.0)))); pan_y=max(-4.0,min(4.0,float(state.get("pan_y",0.0))))
    direction=Vector((math.cos(pitch)*math.cos(yaw),math.cos(pitch)*math.sin(yaw),math.sin(pitch))).normalized(); target=center+Vector((pan_x*size*0.35,0.0,pan_y*size*0.35)); camera.location=target+direction*radius*distance; camera.rotation_euler=(target-camera.location).to_track_quat("-Z","Y").to_euler()

sock=socket.create_connection((host,port),timeout=60.0); sock.settimeout(120.0)
try:
    while True:
        command=recv_message(sock); op=command.get("op")
        if op=="quit": send_response(sock,{"ok":True}); break
        if op!="render": send_response(sock,{"ok":False,"error":f"Unknown operation: {op}"}); continue
        try:
            apply_camera(command.get("camera") or {}); bpy.ops.render.render(); image=bpy.data.images.get("Render Result")
            if image is None: raise RuntimeError("Blender produced no Render Result")
            pixels=np.empty(len(image.pixels),dtype=np.float32); image.pixels.foreach_get(pixels); rgba=pixels.reshape(height,width,4); rgba=np.flipud(rgba); rgba=np.clip(rgba,0.0,1.0); rgba=(rgba*255.0+0.5).astype(np.uint8,copy=False); payload=rgba.tobytes(order="C")
            send_response(sock,{"ok":True,"width":width,"height":height,"bytes":len(payload)},payload)
        except Exception as exc: send_response(sock,{"ok":False,"error":f"{type(exc).__name__}: {exc}"})
finally:
    try: sock.close()
    except Exception: pass
'''


def _recv_exact(sock: socket.socket, count: int) -> bytes:
    parts=[]; total=0
    while total<count:
        chunk=sock.recv(count-total)
        if not chunk: raise RuntimeError("Blender live renderer disconnected.")
        parts.append(chunk); total += len(chunk)
    return b"".join(parts)


class BlenderViewportWorker:
    def __init__(self, model_path: Path, width: int, height: int, controller: JobController) -> None:
        blender=_find_blender()
        if blender is None: raise RuntimeError("Blender was not found. Set BLENDER_EXE to blender.exe to use DLSS 5 Live 3D.")
        if model_path.suffix.lower()==".splat": raise RuntimeError("SPLAT can be shown by Model3D, but Live DLSS 3D requires a mesh/GLB unless a Gaussian-splat Blender importer is installed.")
        self.controller=controller; self.width=width; self.height=height; self._socket=None; self._listener=None; self._process=None; self._logs=deque(maxlen=200); self._log_thread=None
        stamp=time.strftime("%Y%m%d-%H%M%S")+f"-{time.time_ns()%1_000_000:06d}"; self.work=MODEL_CACHE/f"dlss-live3d-{stamp}"; self.work.mkdir(parents=True,exist_ok=False); script=self.work/"_dlss5_live3d_blender.py"; script.write_text(_BLENDER_LIVE_SCRIPT,encoding="utf-8")
        listener=socket.socket(socket.AF_INET,socket.SOCK_STREAM); listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); listener.bind(("127.0.0.1",0)); listener.listen(1); listener.settimeout(.25); self._listener=listener; port=int(listener.getsockname()[1])
        command=[str(blender),"--background","--factory-startup","--disable-autoexec","--python",str(script),"--",str(model_path),"127.0.0.1",str(port),str(width),str(height)]
        self._process=subprocess.Popen(command,cwd=model_path.parent,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0)); controller.register(self._process); self._log_thread=threading.Thread(target=self._drain_logs,daemon=True,name="dlss5-live3d-blender-log"); self._log_thread.start()
        deadline=time.monotonic()+75.0
        while True:
            if controller.cancel.is_set(): raise Cancelled("DLSS 5 Live 3D stopped.")
            if self._process.poll() is not None: raise RuntimeError(f"Blender live renderer exited with code {self._process.returncode}.\n"+"\n".join(self._logs[-30:]))
            if time.monotonic()>deadline: raise TimeoutError("Timed out waiting for Blender live renderer to start.")
            try:
                sock,_=listener.accept(); self._socket=sock; sock.settimeout(120.0); break
            except socket.timeout: continue
        listener.close(); self._listener=None
    def _drain_logs(self):
        if self._process is None or self._process.stdout is None:return
        for raw in iter(self._process.stdout.readline,b""): self._logs.append(raw.decode("utf-8","replace").rstrip())
    def _send(self,message):
        if self._socket is None: raise RuntimeError("Blender live renderer is not connected.")
        payload=json.dumps(message).encode(); self._socket.sendall(struct.pack("!I",len(payload))); self._socket.sendall(payload)
    def render(self,camera):
        if self.controller.cancel.is_set(): raise Cancelled("DLSS 5 Live 3D stopped.")
        self._send({"op":"render","camera":camera}); header_len=struct.unpack("!I",_recv_exact(self._socket,4))[0]; meta=json.loads(_recv_exact(self._socket,header_len).decode())
        if not meta.get("ok"): raise RuntimeError(str(meta.get("error") or "Blender live render failed."))
        byte_count=int(meta.get("bytes") or 0); expected=self.width*self.height*4
        if byte_count!=expected: raise RuntimeError(f"Blender live renderer returned {byte_count} bytes; expected {expected}.")
        return np.frombuffer(_recv_exact(self._socket,byte_count),dtype=np.uint8).reshape(self.height,self.width,4).copy()
    def close(self):
        if self._socket is not None:
            try:self._socket.settimeout(2.0);self._send({"op":"quit"});header_len=struct.unpack("!I",_recv_exact(self._socket,4))[0];_recv_exact(self._socket,header_len)
            except Exception:pass
            try:self._socket.close()
            except Exception:pass
            self._socket=None
        if self._listener is not None:
            try:self._listener.close()
            except Exception:pass
        if self._process is not None:
            if self._process.poll() is None:
                try:self._process.terminate();self._process.wait(timeout=5)
                except Exception:
                    try:self._process.kill();self._process.wait(timeout=5)
                    except Exception:pass
            self.controller.unregister(self._process)
        if self._log_thread:self._log_thread.join(timeout=1)


class ModelLiveSession(threading.Thread):
    def __init__(self, options: ModelLiveOptions) -> None:
        super().__init__(daemon=True,name="dlss5-model-live"); self.options=replace(options); self.controller=JobController(); self.info=ModelLiveInfo(running=True,status="Starting DLSS 5 Live 3D..."); self._info_lock=threading.Lock(); self._camera_lock=threading.Lock(); self._camera={"yaw":35.0,"pitch":18.0,"distance":2.8,"pan_x":0.0,"pan_y":0.0}; self._dirty=threading.Event(); self._dirty.set(); self._server=EnhancedPreviewServer(mode="model3d",history_seconds=0.0,max_width=1280,jpeg_quality=86,camera_callback=self.update_camera); self._server.start(); register_preview_server("model3d",self,self._server); self._native=None; self._worker=None; self._feature_evidence={}
    def _set(self,**values):
        with self._info_lock:
            for k,v in values.items(): setattr(self.info,k,v)
    def snapshot(self):
        with self._info_lock:return replace(self.info,failures=list(self.info.failures))
    def update_camera(self,state):
        safe={"yaw":float(state.get("yaw",35.0)),"pitch":max(-85.0,min(85.0,float(state.get("pitch",18.0)))),"distance":max(1.1,min(9.0,float(state.get("distance",2.8)))),"pan_x":max(-4.0,min(4.0,float(state.get("pan_x",0.0)))),"pan_y":max(-4.0,min(4.0,float(state.get("pan_y",0.0))))}
        if not all(math.isfinite(v) for v in safe.values()):return
        with self._camera_lock:self._camera=safe
        self._dirty.set()
    def stop(self):self._set(status="Stopping DLSS 5 Live 3D...");self.controller.stop();self._dirty.set()
    def _write_report(self):
        if not self.info.report_path:return
        payload={"session":asdict(self.snapshot()),"settings":{k:v for k,v in asdict(self.options).items() if k!="model_path"},"feature_18":self._feature_evidence,"model":Path(self.options.model_path).name,"pipeline":"persistent Blender RGBA -> temporal guides -> signed feature18 -> interactive live viewer","notes":{"still_image_overlay":False,"persistent_blender_process":True,"native_adapter_verified":False,"zero_copy":False}}
        try:Path(self.info.report_path).write_text(json.dumps(payload,indent=2),encoding="utf-8")
        except OSError:pass
    def run(self):
        global _LAST,_CURRENT
        try:
            source=Path(self.options.model_path).resolve()
            if not source.is_file():raise FileNotFoundError(source)
            if self.options.resolution not in MODEL_LIVE_RESOLUTIONS:raise ValueError("Choose a valid live 3D render resolution.")
            width,height=MODEL_LIVE_RESOLUTIONS[self.options.resolution];factor,mode=resolve_upscaling_mode(float(self.options.upscaling_factor));out_w,out_h=resolve_output_size(width,height,factor);LOGS.mkdir(parents=True,exist_ok=True);report_dir=LOGS/"model_live";report_dir.mkdir(parents=True,exist_ok=True);stamp=time.strftime("%Y%m%d-%H%M%S")+f"-{time.time_ns()%1_000_000:06d}";self._set(input_size=f"{width}x{height}",output_size=f"{out_w}x{out_h}",report_path=str(report_dir/f"{stamp}.json"),status="Preparing Blender and signed DLSS feature 18...")
            with active_job(self.controller):
                prepared=prepare_runtime();ai_uuid,_=processing_gpu_settings();gpu=resolve_runtime_ai_gpu(prepared.gpus,prepared.runtime_bundle,ai_uuid);self._set(requested_gpu=str(gpu.get("display_name") or gpu.get("name") or "NVIDIA RTX GPU"));self._worker=BlenderViewportWorker(source,width,height,self.controller);self._native=DLSSFrameSession(input_width=width,input_height=height,output_width=out_w,output_height=out_h,frame_count=MODEL_LIVE_FRAME_COUNT,warmup_frames=0,factor=factor,mode=mode,native_settings=resolve_native_settings(self.options),gpu=gpu,runtime_bundle=prepared.runtime_bundle,controller=self.controller);guides=TemporalGuideGenerator(width,height,flow_width=320);frame_index=0;started=time.perf_counter()
                while not self.controller.cancel.is_set():
                    if not self._dirty.wait(.25):continue
                    self._dirty.clear()
                    with self._camera_lock:camera=dict(self._camera)
                    tick=time.perf_counter();rgba=self._worker.render(camera);render_ms=(time.perf_counter()-tick)*1000;tick=time.perf_counter();guide=guides.process(rgba);guide_ms=(time.perf_counter()-tick)*1000;tick=time.perf_counter();enhanced,_pts=self._native.process(index=frame_index,rgba=rgba,motion=guide.motion,reset=guide.reset,pts=frame_index);dlss_ms=(time.perf_counter()-tick)*1000;frame_index+=1
                    if frame_index==1:
                        evidence=verify_feature_18(self._native.worker_logs,self._native.reshade_log_text());self._feature_evidence={k:v for k,v in evidence.items() if k!="reshade_log"};self._set(feature_18_confirmed=True)
                    self._server.offer_rgba(enhanced);old=self.snapshot();elapsed=max(time.perf_counter()-started,.001);self._set(frames=frame_index,render_ms=render_ms if not old.render_ms else old.render_ms*.8+render_ms*.2,guide_ms=guide_ms if not old.guide_ms else old.guide_ms*.8+guide_ms*.2,dlss_ms=dlss_ms if not old.dlss_ms else old.dlss_ms*.8+dlss_ms*.2,effective_fps=frame_index/elapsed,status=f"DLSS 5 Live 3D active — drag to orbit, right/Shift-drag to pan, wheel to zoom. {frame_index} enhanced frames.");self._write_report()
        except Cancelled:self._set(status="Stopped.")
        except Exception as exc:self._set(status="Stopped." if self.controller.cancel.is_set() else f"Failed: {type(exc).__name__}: {exc}",failures=[] if self.controller.cancel.is_set() else [f"{type(exc).__name__}: {exc}"])
        finally:
            self.controller.terminate_processes()
            if self._native is not None and not self._native.closed:
                try:self._native.abort()
                except Exception:pass
            if self._worker is not None:self._worker.close()
            self._set(running=False);self._write_report();unregister_preview_server("model3d",self,self._server);self._server.stop()
            with _LOCK:
                _LAST=self.snapshot()
                if _CURRENT is self:_CURRENT=None


def start_model_live(options: ModelLiveOptions) -> ModelLiveInfo:
    global _CURRENT
    with _LOCK:
        if _CURRENT is not None and _CURRENT.is_alive():raise RuntimeError("A DLSS 5 Live 3D session is already running.")
        session=ModelLiveSession(options);_CURRENT=session;session.start();return session.snapshot()
def stop_model_live()->ModelLiveInfo:
    with _LOCK:session=_CURRENT
    if session is None or not session.is_alive():return model_live_status()
    session.stop();session.join(timeout=5);return session.snapshot()
def model_live_status()->ModelLiveInfo:
    with _LOCK:session,last=_CURRENT,_LAST
    if session is not None:return session.snapshot()
    return replace(last,failures=list(last.failures)) if last else ModelLiveInfo()
def is_model_live_running()->bool:
    with _LOCK:return _CURRENT is not None and _CURRENT.is_alive()
def _shutdown()->None:
    with _LOCK:session=_CURRENT
    if session is not None:session.stop();session.join(timeout=5)
atexit.register(_shutdown)
