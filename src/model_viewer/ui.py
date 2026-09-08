from __future__ import annotations

import traceback
from dataclasses import dataclass
from pathlib import Path

import gradio as gr

from ..core.paths import LOGS
from ..settings.models import UISettings, parse_automatic_mask
from ..neural_rendering.video.ui import build_dlss_model_control, build_neural_controls
from .converter import UPLOAD_EXTENSIONS, prepare_for_viewer, viewer_capabilities
from .dlss_overlay import (
    OVERLAY_RESOLUTIONS,
    OVERLAY_VIEWS,
    blend_overlay,
    render_dlss_overlay,
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


def load_model(files, display_mode: str, pack_dependencies: bool):
    if not files:
        raise gr.Error("Choose at least one 3D model file.")
    try:
        path, status = prepare_for_viewer(files, prefer_glb=bool(pack_dependencies))
    except Exception as exc:
        raise gr.Error(str(exc)) from exc
    return _viewer_update(path, display_mode), path, status


def change_display_mode(path: str | None, display_mode: str):
    return _viewer_update(path, display_mode)


def sync_native_upload(path):
    if not path:
        return None, _capability_text()
    value = str(path)
    return value, f"Loaded {Path(value).name} directly in the interactive 3D viewport."


def render_overlay_ui(
    model_path: str | None,
    nr_preset: str,
    nr_style: str,
    nr_intensity: float,
    local_tone_strength: float,
    local_structure_strength: float,
    skin_structure_strength: float,
    upscaling_factor: float,
    automatic_mask: str,
    dlss_model_preset: str,
    view: str,
    resolution: str,
    blend: float,
):
    if not model_path:
        raise gr.Error("Load a 3D model before rendering the DLSS 5 overlay.")
    try:
        raw, enhanced, composite, status = render_dlss_overlay(
            model_path,
            nr_preset,
            nr_style,
            nr_intensity,
            local_tone_strength,
            local_structure_strength,
            skin_structure_strength,
            upscaling_factor,
            parse_automatic_mask(automatic_mask),
            dlss_model_preset,
            view,
            resolution,
            float(blend),
        )
    except Exception as exc:
        _log_viewer_error("DLSS overlay", exc)
        raise gr.Error(str(exc)) from exc
    return raw, enhanced, composite, raw, enhanced, status


def reblend_overlay(raw_path: str | None, enhanced_path: str | None, blend: float):
    if not raw_path or not enhanced_path:
        return None
    try:
        return blend_overlay(raw_path, enhanced_path, float(blend))
    except Exception as exc:
        raise gr.Error(str(exc)) from exc


def clear_model():
    return None, None, "Cleared model."


def clear_overlay():
    return None, None, None, None, None


@dataclass(slots=True)
class ModelViewerTab:
    files: object
    display_mode: object
    pack_dependencies: object
    load: object
    clear: object
    viewer: object
    current_path: object
    status: object
    neural: list[object]
    model_preset: object
    overlay_view: object
    overlay_resolution: object
    overlay_blend: object
    render_overlay: object
    clear_overlay: object
    raw_render: object
    enhanced_render: object
    overlay_render: object
    raw_state: object
    enhanced_state: object


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
        dict(label="3D viewport", display_mode="solid", clear_color=(0.025, 0.025, 0.035, 1.0), height=720, interactive=True),
        dict(label="3D viewport", display_mode="solid", height=720, interactive=True),
        dict(label="3D viewport", height=720),
        dict(label="3D viewport"),
        {},
    )
    errors: list[str] = []
    for kwargs in attempts:
        try:
            return component(**kwargs)
        except TypeError as exc:
            errors.append(str(exc))
    raise RuntimeError("Could not construct Model3D with this Gradio build: " + " | ".join(errors))


def _create_image_component(label: str, height: int = 420):
    attempts = (
        dict(label=label, type="filepath", interactive=False, height=height),
        dict(label=label, type="filepath", interactive=False),
        dict(label=label, interactive=False),
        dict(label=label),
    )
    errors: list[str] = []
    for kwargs in attempts:
        try:
            return gr.Image(**kwargs)
        except TypeError as exc:
            errors.append(str(exc))
    raise RuntimeError("Could not construct overlay image component: " + " | ".join(errors))


def _build_model_viewer_tab_impl(settings: UISettings) -> ModelViewerTab:
    gr.Markdown(
        "### 3D Model Viewer + DLSS 5 Overlay\n"
        "The interactive viewport is the model-control surface for orbit/pan/zoom. "
        "The **DLSS 5 Overlay** section performs a real camera render of the same model "
        "and sends that frame through signed Neural Rendering feature 18 using the controls on the left. "
        "This is real DLSS processing, not a CSS filter. The current native worker does not accept the "
        "browser WebGL texture directly, so the feature-18 overlay is a rendered camera frame rather than "
        "a fake claim of zero-copy game-engine integration."
    )
    with gr.Row():
        with gr.Column(scale=2):
            files = _create_file_component()
            gr.Markdown("For OBJ/GLTF bundles, select MTL/BIN/textures with the primary file.")
            display_mode = gr.Radio(choices=list(DISPLAY_MODES), value="Solid", label="Display mode")
            pack_dependencies = gr.Checkbox(value=True, label="Pack OBJ/GLTF dependencies to GLB when possible")
            with gr.Row():
                load = gr.Button("Load Model", variant="primary")
                clear = gr.Button("Clear Model")

            with gr.Accordion("DLSS 5 Neural Rendering Settings", open=True):
                neural = build_neural_controls(settings)
            with gr.Accordion("DLSS 5 Settings", open=True):
                model_preset = build_dlss_model_control(settings)

            gr.Markdown("#### DLSS 5 Overlay Render")
            overlay_view = gr.Dropdown(choices=list(OVERLAY_VIEWS), value="Three-quarter", label="Camera view")
            overlay_resolution = gr.Dropdown(
                choices=list(OVERLAY_RESOLUTIONS), value="720p", label="Base camera render"
            )
            overlay_blend = gr.Slider(
                minimum=0.0,
                maximum=1.0,
                step=0.05,
                value=1.0,
                label="DLSS overlay blend",
            )
            with gr.Row():
                render_overlay_button = gr.Button("Render DLSS 5 Overlay", variant="primary")
                clear_overlay_button = gr.Button("Clear Overlay")
            status = gr.Textbox(label="Viewer / DLSS status", value=_capability_text(), interactive=False, lines=8)
            gr.Markdown(
                "**Model formats:** " + ", ".join(f"`{ext}`" for ext in UPLOAD_EXTENSIONS)
                + "\n\nThe overlay camera renderer supports mesh models that Blender can import after the viewer's conversion stage. "
                "SPLAT remains interactive-only unless a local splat-to-mesh/import plug-in is installed."
            )

        with gr.Column(scale=4):
            viewer = _create_model3d_component()
            current_path = gr.State(None)
            gr.Markdown("### DLSS 5 overlay effect")
            overlay_render_component = _create_image_component("DLSS 5 overlay", 500)
            with gr.Row():
                raw_render = _create_image_component("Source camera render", 300)
                enhanced_render = _create_image_component("Signed DLSS 5 render", 300)
            raw_state = gr.State(None)
            enhanced_state = gr.State(None)

    load.click(
        load_model,
        inputs=[files, display_mode, pack_dependencies],
        outputs=[viewer, current_path, status],
        show_progress="full",
        concurrency_limit=1,
    )
    upload = getattr(viewer, "upload", None)
    if callable(upload):
        upload(sync_native_upload, inputs=viewer, outputs=[current_path, status], queue=False, show_progress="hidden")
    display_mode.change(change_display_mode, inputs=[current_path, display_mode], outputs=viewer, queue=False, show_progress="hidden")
    clear.click(clear_model, outputs=[viewer, current_path, status], queue=False, show_progress="hidden")

    render_overlay_button.click(
        render_overlay_ui,
        inputs=[
            current_path,
            *neural,
            model_preset,
            overlay_view,
            overlay_resolution,
            overlay_blend,
        ],
        outputs=[
            raw_render,
            enhanced_render,
            overlay_render_component,
            raw_state,
            enhanced_state,
            status,
        ],
        concurrency_limit=1,
        show_progress="full",
    )
    overlay_blend.change(
        reblend_overlay,
        inputs=[raw_state, enhanced_state, overlay_blend],
        outputs=overlay_render_component,
        queue=False,
        show_progress="hidden",
    )
    clear_overlay_button.click(
        clear_overlay,
        outputs=[raw_render, enhanced_render, overlay_render_component, raw_state, enhanced_state],
        queue=False,
        show_progress="hidden",
    )

    return ModelViewerTab(
        files,
        display_mode,
        pack_dependencies,
        load,
        clear,
        viewer,
        current_path,
        status,
        neural,
        model_preset,
        overlay_view,
        overlay_resolution,
        overlay_blend,
        render_overlay_button,
        clear_overlay_button,
        raw_render,
        enhanced_render,
        overlay_render_component,
        raw_state,
        enhanced_state,
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
