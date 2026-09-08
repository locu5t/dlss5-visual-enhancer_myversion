from __future__ import annotations

import traceback
from dataclasses import dataclass
from pathlib import Path

import gradio as gr

from ..core.paths import LOGS
from .converter import UPLOAD_EXTENSIONS, prepare_for_viewer, viewer_capabilities


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


def load_model(
    files: list[str] | str | None,
    display_mode: str,
    pack_dependencies: bool,
):
    if not files:
        raise gr.Error("Choose at least one 3D model file.")
    try:
        path, status = prepare_for_viewer(files, prefer_glb=bool(pack_dependencies))
    except Exception as exc:
        raise gr.Error(str(exc)) from exc
    # Model3D's value is a file path. Returning it directly is compatible with
    # older Gradio builds and makes the uploaded/converted model appear in the
    # actual interactive viewport instead of only reporting a filename.
    return _viewer_update(path, display_mode), path, status


def change_display_mode(path: str | None, display_mode: str):
    return _viewer_update(path, display_mode)


def sync_native_upload(path):
    if not path:
        return None, _capability_text()
    value = str(path)
    return value, f"Loaded {Path(value).name} directly in the interactive 3D viewport."


def clear_model():
    return None, None, "Cleared."


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


def _create_file_component():
    """Create a multiple-file uploader without relying on newer File kwargs."""
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
    """Create Model3D across old/new Gradio builds shipped in portable releases."""
    component = getattr(gr, "Model3D", None)
    if component is None:
        raise RuntimeError(
            f"This portable Gradio build ({getattr(gr, '__version__', 'unknown')}) has no Model3D component."
        )

    attempts = (
        dict(
            label="3D viewport",
            display_mode="solid",
            clear_color=(0.025, 0.025, 0.035, 1.0),
            height=720,
            interactive=True,
        ),
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


def _build_model_viewer_tab_impl() -> ModelViewerTab:
    gr.Markdown(
        "### 3D Model Viewer\n"
        "Upload a model on the left and press **Load Model**. The model itself is rendered "
        "in the interactive viewport on the right, where you can orbit, pan and zoom. "
        "Native formats are `OBJ`, `GLB`, `GLTF`, `STL`, `PLY` and `SPLAT`. Common "
        "formats such as `FBX`, `DAE`, `3DS`, `BLEND`, Alembic and USD-family files are "
        "accepted too and converted to GLB when Blender or trimesh can read them."
    )
    with gr.Row():
        with gr.Column(scale=2):
            # The user's bundled File component does not accept the newer `info`
            # keyword. Keep this constructor deliberately minimal and validate
            # extensions ourselves after upload.
            files = _create_file_component()
            gr.Markdown(
                "For OBJ/GLTF bundles, select the MTL/BIN/textures together with the primary file."
            )
            display_mode = gr.Radio(
                choices=list(DISPLAY_MODES),
                value="Solid",
                label="Display mode",
            )
            pack_dependencies = gr.Checkbox(
                value=True,
                label="Pack multi-file OBJ/GLTF dependencies to GLB when possible",
            )
            with gr.Row():
                load = gr.Button("Load Model", variant="primary")
                clear = gr.Button("Clear")
            status = gr.Textbox(
                label="Viewer status",
                value=_capability_text(),
                interactive=False,
                lines=8,
            )
            gr.Markdown(
                "**Supported model extensions:** "
                + ", ".join(f"`{ext}`" for ext in UPLOAD_EXTENSIONS)
                + "\n\nModel files are treated as data. Blender conversion uses `--disable-autoexec`."
            )
        with gr.Column(scale=4):
            viewer = _create_model3d_component()
            current_path = gr.State(None)

    load.click(
        load_model,
        inputs=[files, display_mode, pack_dependencies],
        outputs=[viewer, current_path, status],
        show_progress="full",
        concurrency_limit=1,
    )

    upload = getattr(viewer, "upload", None)
    if callable(upload):
        upload(
            sync_native_upload,
            inputs=viewer,
            outputs=[current_path, status],
            queue=False,
            show_progress="hidden",
        )

    display_mode.change(
        change_display_mode,
        inputs=[current_path, display_mode],
        outputs=viewer,
        queue=False,
        show_progress="hidden",
    )
    clear.click(
        clear_model,
        outputs=[viewer, current_path, status],
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
    )


def build_model_viewer_tab() -> ModelViewerTab | None:
    """Never let an optional viewer/Gradio mismatch take down the whole web host."""
    try:
        return _build_model_viewer_tab_impl()
    except Exception as exc:
        log_path = _log_viewer_error("build", exc)
        gr.Markdown(
            "### 3D Viewer unavailable\n"
            f"The main DLSS application is still usable. This portable Gradio build could not "
            f"initialize the 3D viewer: `{type(exc).__name__}: {exc}`\n\n"
            f"Diagnostic: `{log_path}`"
        )
        return None
