from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Iterable

from ..core.paths import OUTPUTS


NATIVE_VIEWER_EXTENSIONS = {
    ".obj",
    ".glb",
    ".gltf",
    ".stl",
    ".ply",
    ".splat",
}

CONVERTIBLE_EXTENSIONS = {
    ".fbx",
    ".dae",
    ".3ds",
    ".blend",
    ".abc",
    ".usd",
    ".usda",
    ".usdc",
    ".usdz",
    ".x3d",
    ".wrl",
    ".3mf",
    ".amf",
    ".off",
    ".vtk",
    ".vtp",
    ".pcd",
    ".xyz",
    ".vox",
    ".lwo",
    ".lwob",
    ".lws",
    ".md2",
}

UPLOAD_EXTENSIONS = tuple(sorted(NATIVE_VIEWER_EXTENSIONS | CONVERTIBLE_EXTENSIONS))
MODEL_CACHE = OUTPUTS / "model_viewer"


def _safe_name(path: Path) -> str:
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._- "
    name = "".join(char if char in allowed else "_" for char in path.name).strip()
    return name or "model"


def _copy_bundle(paths: Iterable[str | os.PathLike[str]]) -> tuple[Path, list[Path]]:
    sources = [Path(value).resolve() for value in paths]
    if not sources:
        raise ValueError("Choose at least one 3D model file.")
    for source in sources:
        if not source.is_file():
            raise FileNotFoundError(source)

    digest = hashlib.sha256()
    for source in sources:
        stat = source.stat()
        digest.update(str(source).encode("utf-8", "replace"))
        digest.update(str(stat.st_size).encode())
        digest.update(str(stat.st_mtime_ns).encode())
    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    cache_dir = MODEL_CACHE / f"{int(time.time())}-{digest.hexdigest()[:12]}"
    cache_dir.mkdir(parents=True, exist_ok=False)

    copied: list[Path] = []
    used: set[str] = set()
    for source in sources:
        name = _safe_name(source)
        stem, suffix = Path(name).stem, Path(name).suffix
        candidate = name
        counter = 1
        while candidate.casefold() in used:
            counter += 1
            candidate = f"{stem}_{counter}{suffix}"
        used.add(candidate.casefold())
        destination = cache_dir / candidate
        shutil.copy2(source, destination)
        copied.append(destination)
    return cache_dir, copied


def _primary_model(files: list[Path]) -> Path:
    candidates = [path for path in files if path.suffix.lower() in set(UPLOAD_EXTENSIONS)]
    if not candidates:
        raise ValueError(
            "No supported model was found. Supported upload extensions: "
            + ", ".join(UPLOAD_EXTENSIONS)
        )
    priority = {
        ".glb": 0,
        ".gltf": 1,
        ".fbx": 2,
        ".blend": 3,
        ".obj": 4,
        ".usd": 5,
        ".usda": 5,
        ".usdc": 5,
        ".usdz": 5,
        ".dae": 6,
        ".abc": 7,
        ".stl": 8,
        ".ply": 9,
        ".splat": 10,
    }
    return sorted(candidates, key=lambda path: (priority.get(path.suffix.lower(), 50), path.name.casefold()))[0]


def _find_blender() -> Path | None:
    override = os.environ.get("BLENDER_EXE", "").strip().strip('"')
    if override:
        path = Path(override)
        if path.is_file():
            return path.resolve()

    located = shutil.which("blender") or shutil.which("blender.exe")
    if located:
        return Path(located).resolve()

    if os.name == "nt":
        roots = [
            Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Blender Foundation",
            Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Blender Foundation",
        ]
        candidates: list[Path] = []
        for root in roots:
            if root.is_dir():
                candidates.extend(root.glob("Blender */blender.exe"))
                candidates.extend(root.glob("Blender/blender.exe"))
        if candidates:
            return sorted(candidates, reverse=True)[0].resolve()
    return None


_BLENDER_SCRIPT = r'''
import bpy
import sys
from pathlib import Path

args = sys.argv[sys.argv.index("--") + 1:]
src = Path(args[0])
dst = Path(args[1])
ext = src.suffix.lower()

def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

if ext == ".blend":
    bpy.ops.wm.open_mainfile(filepath=str(src), load_ui=False, use_scripts=False)
else:
    clear()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(src))
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=str(src))
    elif ext in {".gltf", ".glb"}:
        bpy.ops.import_scene.gltf(filepath=str(src))
    elif ext == ".dae":
        bpy.ops.wm.collada_import(filepath=str(src))
    elif ext == ".abc":
        bpy.ops.wm.alembic_import(filepath=str(src))
    elif ext in {".usd", ".usda", ".usdc", ".usdz"}:
        bpy.ops.wm.usd_import(filepath=str(src))
    elif ext == ".3ds":
        op = getattr(getattr(bpy.ops, "import_scene", None), "autodesk_3ds", None)
        if op is None:
            raise RuntimeError("This Blender build has no 3DS importer enabled.")
        op(filepath=str(src))
    elif ext in {".x3d", ".wrl"}:
        op = getattr(getattr(bpy.ops, "import_scene", None), "x3d", None)
        if op is None:
            raise RuntimeError("This Blender build has no X3D/VRML importer enabled.")
        op(filepath=str(src))
    else:
        raise RuntimeError(f"Blender conversion is not configured for {ext}")

bpy.ops.export_scene.gltf(
    filepath=str(dst),
    export_format="GLB",
    export_apply=True,
    export_yup=True,
)
'''


def _convert_with_blender(primary: Path, destination: Path) -> str:
    blender = _find_blender()
    if blender is None:
        raise RuntimeError(
            "Blender was not found. Set BLENDER_EXE to blender.exe or install Blender "
            "to enable FBX/DAE/BLEND/Alembic/USD conversion."
        )

    script_path = destination.parent / "_convert_model.py"
    script_path.write_text(_BLENDER_SCRIPT, encoding="utf-8")
    command = [
        str(blender),
        "--background",
        "--factory-startup",
        "--disable-autoexec",
        "--python",
        str(script_path),
        "--",
        str(primary),
        str(destination),
    ]
    process = subprocess.run(
        command,
        cwd=primary.parent,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if process.returncode or not destination.is_file() or destination.stat().st_size == 0:
        detail = (process.stderr or process.stdout or "Blender produced no GLB output.")[-5000:]
        raise RuntimeError("Blender model conversion failed:\n" + detail)
    return f"Blender ({blender.name})"


def _convert_with_trimesh(primary: Path, destination: Path) -> str:
    try:
        import trimesh
    except Exception as exc:
        raise RuntimeError("Optional trimesh conversion backend is not installed.") from exc

    try:
        scene = trimesh.load(str(primary), force="scene", process=False)
        payload = scene.export(file_type="glb")
    except Exception as exc:
        raise RuntimeError(f"trimesh could not import {primary.suffix}: {exc}") from exc
    if not isinstance(payload, (bytes, bytearray)) or not payload:
        raise RuntimeError("trimesh returned no GLB data.")
    destination.write_bytes(bytes(payload))
    return f"trimesh {getattr(trimesh, '__version__', '')}".strip()


def _needs_bundle_conversion(primary: Path, copied: list[Path]) -> bool:
    return len(copied) > 1 and primary.suffix.lower() in {".obj", ".gltf"}


def prepare_for_viewer(
    paths: str | os.PathLike[str] | list[str] | tuple[str, ...] | None,
    *,
    prefer_glb: bool = True,
) -> tuple[str, str]:
    if paths is None:
        raise ValueError("Choose a 3D model.")
    values = [str(paths)] if isinstance(paths, (str, os.PathLike)) else [str(value) for value in paths]
    cache_dir, copied = _copy_bundle(values)
    primary = _primary_model(copied)
    extension = primary.suffix.lower()

    if extension in NATIVE_VIEWER_EXTENSIONS and not (
        prefer_glb and _needs_bundle_conversion(primary, copied)
    ):
        status = (
            f"Loaded {primary.name} directly with Gradio Model3D ({extension}). "
            "Mouse drag rotates, wheel zooms and right-drag pans."
        )
        return str(primary), status

    destination = cache_dir / f"{primary.stem}_VIEWER.glb"
    errors: list[str] = []

    try:
        backend = _convert_with_trimesh(primary, destination)
        return str(destination), f"Converted {primary.name} → GLB with {backend}."
    except Exception as exc:
        errors.append(str(exc))

    try:
        backend = _convert_with_blender(primary, destination)
        return str(destination), f"Converted {primary.name} → GLB with {backend}."
    except Exception as exc:
        errors.append(str(exc))

    if extension in NATIVE_VIEWER_EXTENSIONS:
        return str(primary), (
            f"Loaded {primary.name} directly. Companion-file GLB packing was unavailable: "
            + " | ".join(errors)
        )

    raise RuntimeError(
        f"{primary.name} ({extension}) needs a conversion backend before the browser viewer "
        "can display it. " + " | ".join(errors)
    )


def clean_model_cache(max_age_seconds: float = 24 * 3600) -> int:
    if not MODEL_CACHE.is_dir():
        return 0
    cutoff = time.time() - max_age_seconds
    removed = 0
    for child in MODEL_CACHE.iterdir():
        if not child.is_dir():
            continue
        try:
            if child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
                removed += not child.exists()
        except OSError:
            continue
    return removed


def _has_trimesh() -> bool:
    try:
        import trimesh  # noqa: F401
        return True
    except Exception:
        return False


def viewer_capabilities() -> dict:
    blender = _find_blender()
    return {
        "native": sorted(NATIVE_VIEWER_EXTENSIONS),
        "accepted": list(UPLOAD_EXTENSIONS),
        "blender": str(blender) if blender else None,
        "trimesh": _has_trimesh(),
    }
