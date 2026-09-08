from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import gradio as gr

from .converter import UPLOAD_EXTENSIONS, prepare_for_viewer, viewer_capabilities


DISPLAY_MODES = {
    "Solid": "solid",
    "Wireframe": "wireframe",
    "Point cloud": "point_cloud",
}


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
    mode = DISPLAY_MODES.get(display_mode, "solid")
    return gr.update(value=path, display_mode=mode), path, status


def change_display_mode(path: str | None, display_mode: str):
    if not path:
        return gr.update()
    return gr.update(value=path, display_mode=DISPLAY_MODES.get(display_mode, "solid"))


def sync_native_upload(path: str | None):
    if not path:
        return None, _capability_text()
    return path, f"Loaded {Path(path).name} directly in the native Model3D uploader."


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


def build_model_viewer_tab() -> ModelViewerTab:
    gr.Markdown(
        "### 3D Model Viewer\n"
        "Interactive orbit/pan/zoom viewer for all Model3D default formats "
        "(`OBJ`, `GLB`, `GLTF`, `STL`, `PLY`, `SPLAT`). Common DCC/CAD interchange "
        "files such as `FBX`, `DAE`, `3DS`, `BLEND`, Alembic and USD-family files "
        "are accepted too and converted to GLB when Blender or trimesh can read them."
    )
    with gr.Row():
        with gr.Column(scale=2):
            files = gr.File(
                label="3D model + companion files",
                file_count="multiple",
                file_types=list(UPLOAD_EXTENSIONS),
                type="filepath",
                interactive=True,
                info=(
                    "For OBJ/GLTF, upload MTL/BIN/textures alongside the primary file. "
                    "The loader can pack multi-file assets into one GLB when a converter is available."
                ),
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
                "**Supported upload extensions:** "
                + ", ".join(f"`{ext}`" for ext in UPLOAD_EXTENSIONS)
                + "\n\nConversion never enables embedded model scripts. Blender is launched "
                "with auto-execution disabled."
            )
        with gr.Column(scale=4):
            viewer = gr.Model3D(
                label="3D viewport — default formats can also be dropped here directly",
                display_mode="solid",
                clear_color=(0.025, 0.025, 0.035, 1.0),
                height=720,
                interactive=True,
            )
            current_path = gr.State(None)

    load.click(
        load_model,
        inputs=[files, display_mode, pack_dependencies],
        outputs=[viewer, current_path, status],
        show_progress="full",
        concurrency_limit=1,
    )
    viewer.upload(
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
