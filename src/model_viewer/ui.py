from __future__ import annotations

import os
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import gradio as gr

from ..core.paths import LOGS
from ..live.browser_preview import preview_html
from ..settings.models import UISettings, parse_automatic_mask
from ..neural_rendering.video.ui import build_dlss_model_control, build_neural_controls
from .converter import UPLOAD_EXTENSIONS, prepare_for_viewer, viewer_capabilities
from .live_dlss import (
    MODEL_LIVE_RESOLUTIONS,
    ModelLiveOptions,
    is_model_live_running,
    model_live_status,
    start_model_live,
    stop_model_live,
)

DISPLAY_MODES = {
    "Solid": "solid",
    "Wireframe": "wireframe",
    "Point cloud": "point_cloud",
}


def _log_viewer_error(stage: str, exc: BaseException) -> str:
    try:
        LOGS.mkdir(parents=True, exist_ok=True)
        path = LOGS / "optional_features.log"
        with path.open("a", encoding="utf-8") as stream:
            stream.write(f"\n[3D Viewer / {stage}] {type(exc).__name__}: {exc}\n")
            stream.write("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
        return str(path)
    except Exception:
        return str(LOGS / "optional_features.log")


def _capability_text() -> str:
    caps = viewer_capabilities()
    native = ", ".join(caps["native"])
    converter = []
    if caps["trimesh"]:
        converter.append("trimesh")
    if caps["blender"]:
        converter.append(f"Blender: {caps['blender']}")
    extra = ", ".join(converter) if converter else "no optional converter detected"
    return (
        f"Native viewer formats: {native}. Additional accepted formats are normalized "
        f"to GLB when a local converter can read them ({extra})."
    )


def _extract_file_paths(value: Any) -> list[str]:
    """Normalize File values across the old/new Gradio APIs in portable builds."""
    result: list[str] = []

    def add(item: Any) -> None:
        if item is None:
            return
        if isinstance(item, (list, tuple, set)):
            for child in item:
                add(child)
            return
        if isinstance(item, dict):
            for key in ("path", "name", "orig_name"):
                candidate = item.get(key)
                if candidate and Path(str(candidate)).is_file():
                    result.append(str(Path(str(candidate))))
                    return
            return
        if isinstance(item, (str, os.PathLike)):
            candidate = Path(str(item))
            if candidate.is_file():
                result.append(str(candidate))
            return
        # Gradio FileData / tempfile wrapper variants.
        for attr in ("path", "name"):
            candidate = getattr(item, attr, None)
            if candidate and Path(str(candidate)).is_file():
                result.append(str(Path(str(candidate))))
                return

    add(value)
    # Preserve ordering while removing duplicates.
    seen: set[str] = set()
    return [path for path in result if not (path in seen or seen.add(path))]


def _viewer_update(path: str | None, display_mode: str):
    if not path:
        return None
    mode = DISPLAY_MODES.get(display_mode, "solid")
    update = getattr(gr, "update", None)
    if callable(update):
        try:
            return update(value=path, display_mode=mode)
        except TypeError:
            try:
                return update(value=path)
            except TypeError:
                pass
    return path


def _prepare_uploaded_model(files: Any, pack_dependencies: bool) -> tuple[str, str]:
    paths = _extract_file_paths(files)
    if not paths:
        raise ValueError("Choose at least one valid 3D model file.")
    return prepare_for_viewer(paths, prefer_glb=bool(pack_dependencies))


def load_model(files, display_mode: str, pack_dependencies: bool):
    try:
        path, status = _prepare_uploaded_model(files, pack_dependencies)
    except Exception as exc:
        _log_viewer_error("load model", exc)
        raise gr.Error(str(exc)) from exc
    status += (
        "\nLoaded for DLSS 5 Live 3D. The uploaded file is now the active model; "
        "you do not need a second Load step before pressing Start."
    )
    return _viewer_update(path, display_mode), path, status


def change_display_mode(path: str | None, display_mode: str):
    return _viewer_update(path, display_mode)


def sync_native_upload(path):
    paths = _extract_file_paths(path)
    if not paths:
        return None, _capability_text()
    value = paths[0]
    return value, f"Loaded {Path(value).name}. Press Start DLSS 5 Live 3D for the enhanced viewer."


def _format_live3d_status(info) -> str:
    lines = [info.status]
    if info.input_size:
        lines.append(
            f"Persistent 3D renderer {info.input_size} -> DLSS output {info.output_size} | "
            f"{info.effective_fps:.2f} effective fps"
        )
    if info.requested_gpu:
        lines.append(f"Requested AI GPU: {info.requested_gpu}")
    if info.frames:
        lines.append(
            f"Blender render {info.render_ms:.1f} ms | motion guides {info.guide_ms:.1f} ms | "
            f"signed DLSS roundtrip {info.dlss_ms:.1f} ms | {info.frames} enhanced frames"
        )
    if info.feature_18_confirmed:
        lines.append("Signed NVIDIA feature 18 confirmed for the live 3D stream.")
    if info.report_path:
        lines.append(f"Diagnostics: {info.report_path}")
    return "\n".join(lines)


def start_live3d_ui(
    model_path,
    uploaded_files,
    pack_dependencies,
    nr_preset,
    nr_style,
    nr_intensity,
    local_tone_strength,
    local_structure_strength,
    skin_structure_strength,
    upscaling_factor,
    automatic_mask,
    dlss_model_preset,
    resolution,
):
    try:
        resolved = str(model_path) if model_path and Path(str(model_path)).is_file() else ""
        if not resolved:
            # Selecting a file is enough. This fallback fixes the case where the
            # portable Gradio State has not yet received the Load Model callback.
            resolved, _status = _prepare_uploaded_model(uploaded_files, bool(pack_dependencies))
        if not Path(resolved).is_file():
            raise ValueError("The selected 3D model could not be resolved to a local file.")
        if is_model_live_running():
            raise RuntimeError("A DLSS 5 Live 3D session is already running.")
        options = ModelLiveOptions(
            model_path=resolved,
            resolution=resolution if resolution in MODEL_LIVE_RESOLUTIONS else "720p",
            nr_preset=nr_preset,
            nr_style=nr_style,
            nr_intensity=float(nr_intensity),
            local_tone_strength=float(local_tone_strength),
            local_structure_strength=float(local_structure_strength),
            skin_structure_strength=float(skin_structure_strength),
            upscaling_factor=float(upscaling_factor),
            automatic_mask=parse_automatic_mask(automatic_mask),
            dlss_model_preset=dlss_model_preset,
        )
        info = start_model_live(options)
        return (
            _format_live3d_status(info),
            preview_html("model3d", "DLSS 5 Live 3D Viewer"),
            resolved,
        )
    except Exception as exc:
        log_path = _log_viewer_error("start live 3D", exc)
        return (
            f"DLSS 5 Live 3D failed to start: {type(exc).__name__}: {exc}\nDiagnostic: {log_path}",
            preview_html("model3d", "DLSS 5 Live 3D Viewer"),
            model_path,
        )


def stop_live3d_ui():
    try:
        info = stop_model_live()
        return _format_live3d_status(info), preview_html("model3d", "DLSS 5 Live 3D Viewer")
    except Exception as exc:
        log_path = _log_viewer_error("stop live 3D", exc)
        return (
            f"Stop failed: {type(exc).__name__}: {exc}\nDiagnostic: {log_path}",
            preview_html("model3d", "DLSS 5 Live 3D Viewer"),
        )


def refresh_live3d_ui():
    info = model_live_status()
    return _format_live3d_status(info), preview_html("model3d", "DLSS 5 Live 3D Viewer")


def clear_model():
    if is_model_live_running():
        raise gr.Error("Stop DLSS 5 Live 3D before clearing the model.")
    return None, None, "Cleared model.", preview_html("model3d", "DLSS 5 Live 3D Viewer")


@dataclass(slots=True)
class ModelViewerTab:
    files: object
    display_mode: object
    pack_dependencies: object
    load: object
    clear: object
    source_viewer: object
    current_path: object
    status: object
    neural: list[object]
    model_preset: object
    live_resolution: object
    start_live: object
    stop_live: object
    refresh_live: object
    live_viewer: object


def _create_file_component():
    attempts = (
        dict(label="3D model + companion files", file_count="multiple", type="filepath", interactive=True),
        dict(label="3D model + companion files", file_count="multiple", type="filepath"),
        dict(label="3D model + companion files", file_count="multiple"),
        dict(label="3D model + companion files"),
    )
    errors: list[str] = []
    for kwargs in attempts:
        try:
            return gr.File(**kwargs)
        except TypeError as exc:
            errors.append(str(exc))
    raise RuntimeError("Could not construct the 3D uploader with this Gradio build: " + " | ".join(errors))


def _create_model3d_component():
    component = getattr(gr, "Model3D", None)
    if component is None:
        raise RuntimeError(
            f"This portable Gradio build ({getattr(gr, '__version__', 'unknown')}) has no Model3D component."
        )
    attempts = (
        dict(
            label="Source geometry viewport (unprocessed reference)",
            display_mode="solid",
            clear_color=(0.025, 0.025, 0.035, 1.0),
            height=520,
            interactive=True,
        ),
        dict(label="Source geometry viewport", display_mode="solid", height=520, interactive=True),
        dict(label="Source geometry viewport", height=520),
        dict(label="Source geometry viewport"),
        {},
    )
    errors: list[str] = []
    for kwargs in attempts:
        try:
            return component(**kwargs)
        except TypeError as exc:
            errors.append(str(exc))
    raise RuntimeError("Could not construct Model3D with this Gradio build: " + " | ".join(errors))


def _build_model_viewer_tab_impl(settings: UISettings) -> ModelViewerTab:
    gr.Markdown(
        "### 3D Model Viewer — DLSS 5 Live\n"
        "The primary output is an **interactive live DLSS 5 viewport**. Uploading a model "
        "automatically makes it the active model; the explicit Load Model button remains available "
        "for multi-file bundles or retrying conversion."
    )
    with gr.Row():
        with gr.Column(scale=2):
            files = _create_file_component()
            gr.Markdown(
                "For OBJ/GLTF bundles, select MTL/BIN/textures with the primary file. "
                "Non-native DCC files are converted to GLB first when Blender/trimesh supports them."
            )
            display_mode = gr.Radio(
                choices=list(DISPLAY_MODES), value="Solid", label="Source reference display mode"
            )
            pack_dependencies = gr.Checkbox(
                value=True, label="Pack OBJ/GLTF dependencies to GLB when possible"
            )
            with gr.Row():
                load = gr.Button("Load Model", variant="primary")
                clear = gr.Button("Clear Model")
            with gr.Accordion("DLSS 5 Neural Rendering Settings", open=True):
                neural = build_neural_controls(settings)
            with gr.Accordion("DLSS 5 Settings", open=False):
                model_preset = build_dlss_model_control(settings)
            live_resolution = gr.Dropdown(
                choices=list(MODEL_LIVE_RESOLUTIONS), value="720p", label="Live 3D base render"
            )
            with gr.Row():
                start_live = gr.Button("Start DLSS 5 Live 3D", variant="primary")
                stop_live = gr.Button("Stop", variant="stop")
                refresh_live = gr.Button("Refresh Status")
            status = gr.Textbox(
                label="3D / DLSS status", value=_capability_text(), interactive=False, lines=10
            )
            gr.Markdown(
                "**Model formats:** " + ", ".join(f"`{ext}`" for ext in UPLOAD_EXTENSIONS)
                + "\n\nThe live renderer needs a Blender-readable mesh. SPLAT remains source-viewer "
                "only unless a Gaussian-splat Blender importer is installed."
            )
        with gr.Column(scale=4):
            gr.Markdown("### DLSS 5 Live 3D Viewer")
            live_viewer = gr.HTML(value=preview_html("model3d", "DLSS 5 Live 3D Viewer"))
            with gr.Accordion("Unprocessed source geometry reference", open=False):
                source_viewer = _create_model3d_component()
            current_path = gr.State(None)

    load.click(
        load_model,
        inputs=[files, display_mode, pack_dependencies],
        outputs=[source_viewer, current_path, status],
        queue=False,
        show_progress="hidden",
    )

    # Selecting a model should mean it is loaded. Do not require the user to
    # remember a second button click before Start DLSS 5 Live 3D.
    change = getattr(files, "change", None)
    if callable(change):
        change(
            load_model,
            inputs=[files, display_mode, pack_dependencies],
            outputs=[source_viewer, current_path, status],
            queue=False,
            show_progress="hidden",
        )

    upload = getattr(source_viewer, "upload", None)
    if callable(upload):
        upload(
            sync_native_upload,
            inputs=source_viewer,
            outputs=[current_path, status],
            queue=False,
            show_progress="hidden",
        )
    display_mode.change(
        change_display_mode,
        inputs=[current_path, display_mode],
        outputs=source_viewer,
        queue=False,
        show_progress="hidden",
    )
    clear.click(
        clear_model,
        outputs=[source_viewer, current_path, status, live_viewer],
        queue=False,
        show_progress="hidden",
    )
    start_live.click(
        start_live3d_ui,
        inputs=[
            current_path,
            files,
            pack_dependencies,
            *neural,
            model_preset,
            live_resolution,
        ],
        outputs=[status, live_viewer, current_path],
        queue=False,
        show_progress="hidden",
    )
    stop_live.click(
        stop_live3d_ui,
        outputs=[status, live_viewer],
        queue=False,
        show_progress="hidden",
    )
    refresh_live.click(
        refresh_live3d_ui,
        outputs=[status, live_viewer],
        queue=False,
        show_progress="hidden",
    )
    return ModelViewerTab(
        files,
        display_mode,
        pack_dependencies,
        load,
        clear,
        source_viewer,
        current_path,
        status,
        neural,
        model_preset,
        live_resolution,
        start_live,
        stop_live,
        refresh_live,
        live_viewer,
    )


def build_model_viewer_tab(settings: UISettings = UISettings()) -> ModelViewerTab | None:
    try:
        return _build_model_viewer_tab_impl(settings)
    except Exception as exc:
        log_path = _log_viewer_error("build", exc)
        gr.Markdown(
            "### 3D Viewer unavailable\n"
            f"The main DLSS application is still usable. This portable Gradio build could not "
            f"initialize the 3D viewer: `{type(exc).__name__}: {exc}`\n\n"
            f"Diagnostic: `{log_path}`"
        )
        return None
