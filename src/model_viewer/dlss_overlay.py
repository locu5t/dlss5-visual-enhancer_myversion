from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import cv2

from ..settings.storage import processing_gpu_settings
from ..neural_rendering.image.models import ImageConversionOptions
from ..neural_rendering.image.processor import convert_image
from .converter import MODEL_CACHE, _find_blender


OVERLAY_VIEWS = ("Three-quarter", "Front", "Right", "Top")
OVERLAY_RESOLUTIONS = {
    "720p": (1280, 720),
    "1080p": (1920, 1080),
}

_BLENDER_RENDER_SCRIPT = r'''
import bpy
import sys
from pathlib import Path
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
src = Path(args[0])
out = Path(args[1])
width = int(args[2])
height = int(args[3])
view = args[4]
ext = src.suffix.lower()


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def op(path, modern, legacy=None):
    target = bpy.ops
    for part in modern.split('.'):
        target = getattr(target, part, None)
        if target is None:
            break
    if target is not None:
        target(filepath=str(path))
        return
    if legacy:
        target = bpy.ops
        for part in legacy.split('.'):
            target = getattr(target, part, None)
            if target is None:
                break
        if target is not None:
            target(filepath=str(path))
            return
    raise RuntimeError(f"This Blender build has no importer for {ext}")


clear_scene()
if ext in {".glb", ".gltf"}:
    bpy.ops.import_scene.gltf(filepath=str(src))
elif ext == ".obj":
    op(src, "wm.obj_import", "import_scene.obj")
elif ext == ".stl":
    op(src, "wm.stl_import", "import_mesh.stl")
elif ext == ".ply":
    op(src, "wm.ply_import", "import_mesh.ply")
else:
    raise RuntimeError(
        f"DLSS overlay camera rendering currently requires GLB/GLTF/OBJ/STL/PLY; received {ext}. "
        "Load/convert the model to GLB first."
    )

objects = [o for o in bpy.context.scene.objects if getattr(o, "bound_box", None)]
if not objects:
    raise RuntimeError("Imported model has no renderable bounded objects.")
points = []
for obj in objects:
    try:
        points.extend([obj.matrix_world @ Vector(corner) for corner in obj.bound_box])
    except Exception:
        pass
if not points:
    raise RuntimeError("Could not determine model bounds.")
mins = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
maxs = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
center = (mins + maxs) * 0.5
size = max(maxs.x - mins.x, maxs.y - mins.y, maxs.z - mins.z, 0.001)
radius = size * 0.9

directions = {
    "Three-quarter": Vector((1.5, -1.5, 1.0)),
    "Front": Vector((0.0, -2.2, 0.15)),
    "Right": Vector((2.2, 0.0, 0.15)),
    "Top": Vector((0.001, -0.001, 2.5)),
}
direction = directions.get(view, directions["Three-quarter"]).normalized()
camera_data = bpy.data.cameras.new("DLSS5OverlayCamera")
camera = bpy.data.objects.new("DLSS5OverlayCamera", camera_data)
bpy.context.scene.collection.objects.link(camera)
bpy.context.scene.camera = camera
camera.location = center + direction * radius * 2.8
look = center - camera.location
camera.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
camera_data.lens = 52
camera_data.clip_start = max(0.001, radius / 1000)
camera_data.clip_end = max(1000.0, radius * 100)

world = bpy.context.scene.world
world.color = (0.025, 0.028, 0.035)

def add_area(name, location, energy, size_scale):
    data = bpy.data.lights.new(name=name, type='AREA')
    data.energy = energy
    data.shape = 'DISK'
    data.size = max(0.1, radius * size_scale)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = center + Vector(location) * radius
    obj.rotation_euler = (center - obj.location).to_track_quat('-Z', 'Y').to_euler()

add_area("Key", (2.0, -2.0, 2.7), 1100, 2.5)
add_area("Fill", (-2.0, -0.5, 1.2), 650, 2.0)
add_area("Rim", (0.5, 2.1, 2.0), 800, 1.5)

scene = bpy.context.scene
try:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
except Exception:
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except Exception:
        pass
scene.render.resolution_x = width
scene.render.resolution_y = height
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = False
scene.render.filepath = str(out)
try:
    scene.view_settings.look = 'Medium High Contrast'
except Exception:
    pass
bpy.ops.render.render(write_still=True)
if not out.is_file() or out.stat().st_size == 0:
    raise RuntimeError("Blender completed without producing the overlay camera render.")
'''


def _render_camera_frame(model_path: str | os.PathLike[str], view: str, resolution: str) -> Path:
    source = Path(model_path).resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    if source.suffix.lower() == ".splat":
        raise RuntimeError(
            "The browser can display SPLAT directly, but the local Blender camera renderer "
            "cannot render SPLAT without a Gaussian-splat import plug-in. Convert it to a mesh/GLB first."
        )
    blender = _find_blender()
    if blender is None:
        raise RuntimeError(
            "A real DLSS 5 overlay needs a rendered 2D camera frame. Blender was not found. "
            "Set BLENDER_EXE to your blender.exe so the app can render the selected 3D model before feature 18."
        )
    width, height = OVERLAY_RESOLUTIONS.get(resolution, OVERLAY_RESOLUTIONS["720p"])
    stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{time.time_ns() % 1_000_000:06d}"
    work = MODEL_CACHE / f"dlss-overlay-{stamp}"
    work.mkdir(parents=True, exist_ok=False)
    script = work / "_render_dlss_overlay.py"
    output = work / "model_source_render.png"
    script.write_text(_BLENDER_RENDER_SCRIPT, encoding="utf-8")
    command = [
        str(blender),
        "--background",
        "--factory-startup",
        "--disable-autoexec",
        "--python",
        str(script),
        "--",
        str(source),
        str(output),
        str(width),
        str(height),
        view if view in OVERLAY_VIEWS else "Three-quarter",
    ]
    process = subprocess.run(
        command,
        cwd=source.parent,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if process.returncode or not output.is_file():
        detail = (process.stderr or process.stdout or "Blender produced no render.")[-6000:]
        raise RuntimeError("3D overlay camera render failed:\n" + detail)
    return output


def blend_overlay(source_path: str | None, enhanced_path: str | None, blend: float) -> str | None:
    if not source_path or not enhanced_path:
        return None
    source = cv2.imread(str(source_path), cv2.IMREAD_COLOR)
    enhanced = cv2.imread(str(enhanced_path), cv2.IMREAD_COLOR)
    if source is None or enhanced is None:
        raise RuntimeError("Could not read the source/enhanced overlay images.")
    if source.shape[:2] != enhanced.shape[:2]:
        source = cv2.resize(source, (enhanced.shape[1], enhanced.shape[0]), interpolation=cv2.INTER_CUBIC)
    alpha = max(0.0, min(1.0, float(blend)))
    composite = cv2.addWeighted(source, 1.0 - alpha, enhanced, alpha, 0.0)
    destination = Path(enhanced_path).with_name("model_DLSS5_overlay.png")
    if not cv2.imwrite(str(destination), composite):
        raise RuntimeError("Could not save the DLSS overlay composite.")
    return str(destination)


def render_dlss_overlay(
    model_path: str,
    nr_preset: str,
    nr_style: str,
    nr_intensity: float,
    local_tone_strength: float,
    local_structure_strength: float,
    skin_structure_strength: float,
    upscaling_factor: float,
    automatic_mask: bool,
    dlss_model_preset: str,
    view: str,
    resolution: str,
    blend: float,
) -> tuple[str, str, str, str]:
    raw = _render_camera_frame(model_path, view, resolution)
    ai_gpu_uuid, _video_gpu_uuid = processing_gpu_settings()
    options = ImageConversionOptions(
        ai_gpu_uuid=ai_gpu_uuid,
        nr_preset=nr_preset,
        nr_style=nr_style,
        nr_intensity=float(nr_intensity),
        local_tone_strength=float(local_tone_strength),
        local_structure_strength=float(local_structure_strength),
        skin_structure_strength=float(skin_structure_strength),
        upscaling_factor=float(upscaling_factor),
        output_format="PNG",
        quality=100,
        preserve_metadata=False,
        warmup_frames=0,
        automatic_mask=bool(automatic_mask),
        rename_mode="Custom",
        custom_suffix="_DLSS5_3D",
        dlss_model_preset=dlss_model_preset,
    )
    dlss_dir = raw.parent / "dlss"
    dlss_dir.mkdir(exist_ok=True)
    result = convert_image(
        raw,
        options,
        output_dir=dlss_dir,
        generate_previews=False,
        create_zip=False,
    )
    overlay = blend_overlay(str(raw), result.output_path, blend)
    if overlay is None:
        raise RuntimeError("DLSS overlay composition produced no output.")
    status = (
        f"DLSS 5 overlay rendered from {view} view on {result.gpu} in {result.elapsed_seconds:.2f}s. "
        f"DLSS {result.dlss_mode}: {result.render_width}x{result.render_height} -> "
        f"{result.output_width}x{result.output_height}. Overlay blend {float(blend):.0%}. "
        f"Feature-18 report: {result.report_path}"
    )
    return str(raw), str(result.output_path), overlay, status
