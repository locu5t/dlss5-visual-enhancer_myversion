from __future__ import annotations

import traceback
from dataclasses import dataclass
from pathlib import Path

import gradio as gr

from ..core.paths import LOGS
from ..settings.models import UISettings, parse_automatic_mask
from ..neural_rendering.video.ui import build_dlss_model_control, build_neural_controls
from ..live.browser_preview import install_browser_preview, preview_html
from .models import (
    REALTIME_FPS_CHOICES,
    REALTIME_GUIDE_CHOICES,
    REALTIME_HEIGHT_CHOICES,
    REALTIME_MAX_HEIGHTS,
    REALTIME_SOURCE_QUALITY_CHOICES,
    RealtimeOptions,
)
from .pipeline import (
    is_realtime_running,
    realtime_status,
    start_realtime_session,
    stop_realtime_session,
)

# Install after both Live and Realtime pipeline modules are imported. The hook is
# idempotent and only publishes frames from Live/Realtime worker threads.
install_browser_preview()


def _log_realtime_error(stage: str, exc: BaseException) -> str:
    try:
        LOGS.mkdir(parents=True, exist_ok=True)
        path = LOGS / "optional_features.log"
        with path.open("a", encoding="utf-8") as stream:
            stream.write(f"\n[Realtime / {stage}] {type(exc).__name__}: {exc}\n")
            stream.write("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
        return str(path)
    except Exception:
        return str(LOGS / "optional_features.log")


def _format_realtime_status(info) -> str:
    if not info.running and info.status == "Idle.":
        return (
            "Idle. Direct mode sends enhanced frames straight to MPV with no "
            "HLS segmenting or output re-encode."
        )
    lines = [info.status]
    if info.source_size:
        lines.append(
            f"Source {info.source_size} → DLSS input {info.input_size} → "
            f"direct output {info.output_size}"
        )
    if info.requested_gpu:
        lines.append(
            f"Requested AI GPU: {info.requested_gpu}. Native worker adapter binding "
            "is not independently verified."
        )
    if info.source_fps:
        lines.append(
            f"Source {info.source_fps:.2f} fps | target {info.target_fps:.2f} fps | "
            f"effective {info.effective_fps:.2f} fps"
        )
        lines.append(
            f"Motion guides {info.guide_ms:.1f} ms | signed DLSS roundtrip "
            f"{info.dlss_ms:.1f} ms | direct player transport {info.transport_ms:.1f} ms"
        )
    if info.player_running:
        lines.append(
            f"MPV direct player: running | dropped {info.player_dropped_frames} | "
            f"A/V offset {info.av_sync_ms:+.1f} ms"
        )
    if info.feature_18_confirmed:
        lines.append("Signed NVIDIA feature 18 confirmed. The in-app viewport is showing post-DLSS frames.")
    if info.report_path:
        lines.append(f"Diagnostics: {info.report_path}")
    return "\n".join(lines)


def start_realtime(
    source: str,
    source_mode: str,
    local_video: str | None,
    nr_preset: str,
    nr_style: str,
    nr_intensity: float,
    local_tone_strength: float,
    local_structure_strength: float,
    skin_structure_strength: float,
    upscaling_factor: float,
    automatic_mask: str,
    dlss_model_preset: str,
    source_quality: str,
    max_height: str,
    target_fps: str,
    guide_quality: str,
) -> tuple[str, str]:
    if is_realtime_running():
        raise gr.Error("A realtime DLSS session is already running; Stop it first.")
    if source_mode == "Local":
        if not local_video or not Path(local_video).is_file():
            raise gr.Error("Select a local video before starting realtime playback.")
        selected = str(local_video)
    elif source_mode == "Online":
        selected = (source or "").strip()
        if not selected:
            raise gr.Error("Enter an online URL, or select Local.")
    else:
        raise gr.Error("Choose Online or Local as the source.")

    try:
        height = int(max_height)
        factor = float(upscaling_factor)
        auto_mask = parse_automatic_mask(automatic_mask)
    except (TypeError, ValueError) as exc:
        raise gr.Error(str(exc)) from exc

    options = RealtimeOptions(
        source=selected,
        source_quality=source_quality,
        max_height=height if height in REALTIME_MAX_HEIGHTS else 720,
        target_fps=target_fps,
        guide_quality=guide_quality,
        upscaling_factor=factor,
        nr_preset=nr_preset,
        nr_style=nr_style,
        nr_intensity=float(nr_intensity),
        local_tone_strength=float(local_tone_strength),
        local_structure_strength=float(local_structure_strength),
        skin_structure_strength=float(skin_structure_strength),
        automatic_mask=auto_mask,
        dlss_model_preset=dlss_model_preset,
    )
    try:
        info = start_realtime_session(options)
    except RuntimeError as exc:
        raise gr.Error(str(exc)) from exc
    return _format_realtime_status(info), preview_html("realtime", "Realtime DLSS 5 enhanced output")


def stop_realtime() -> tuple[str, str]:
    info = stop_realtime_session()
    return _format_realtime_status(info), preview_html("realtime", "Realtime DLSS 5 enhanced output")


def refresh_realtime_status() -> tuple[str, str]:
    info = realtime_status()
    return _format_realtime_status(info), preview_html("realtime", "Realtime DLSS 5 enhanced output")


@dataclass(slots=True)
class RealtimeTab:
    source: object
    source_mode: object
    local_video: object
    neural: list[object]
    model_preset: object
    source_quality: object
    max_height: object
    target_fps: object
    guide_quality: object
    start: object
    stop: object
    refresh: object
    preview: object
    status: object


def _build_realtime_tab_impl(settings: UISettings) -> RealtimeTab:
    height_labels = {"1440": "1440p (2K)", "2160": "2160p (4K)"}
    gr.Markdown(
        "### Direct low-latency DLSS playback\n"
        "Unlike the buffered Live tab, this path does **not** wait for HLS segments "
        "and does **not** re-encode enhanced video before the direct MPV path. "
        "The viewport on the right is a separate low-overhead MJPEG monitor fed from "
        "the frames returned by signed DLSS feature 18, so you can see the enhanced "
        "result inside the web UI while it runs."
    )
    with gr.Row():
        with gr.Column(scale=3):
            source_mode = gr.Radio(
                choices=["Online", "Local"],
                value="Local",
                label="Source",
            )
            source = gr.Textbox(
                label="Online URL",
                placeholder="Direct stream URL, YouTube or Twitch URL",
            )
            local_video = gr.File(
                label="Local video",
                file_count="single",
                file_types=["video"],
                type="filepath",
                interactive=True,
            )
            with gr.Accordion("DLSS 5 Neural Rendering Settings", open=True):
                neural = build_neural_controls(settings)
            with gr.Accordion("DLSS 5 Settings", open=False):
                model_preset = build_dlss_model_control(settings)
            with gr.Row():
                source_quality = gr.Dropdown(
                    choices=[
                        (
                            "Auto (follow Max input height)"
                            if value == "Auto"
                            else height_labels.get(value, f"{value}p"),
                            value,
                        )
                        for value in REALTIME_SOURCE_QUALITY_CHOICES
                    ],
                    value="Auto",
                    label="Source quality",
                )
                max_height = gr.Dropdown(
                    choices=[
                        (height_labels.get(value, f"{value}p"), value)
                        for value in REALTIME_HEIGHT_CHOICES
                    ],
                    value="720",
                    label="Max DLSS input height",
                )
            with gr.Row():
                target_fps = gr.Dropdown(
                    choices=list(REALTIME_FPS_CHOICES),
                    value="Auto",
                    label="Realtime frame rate",
                )
                guide_quality = gr.Dropdown(
                    choices=list(REALTIME_GUIDE_CHOICES),
                    value="Fast",
                    label="Motion guide quality",
                )
            with gr.Row():
                start = gr.Button("Start Realtime DLSS", variant="primary")
                stop = gr.Button("Stop", variant="stop")
                refresh = gr.Button("Refresh Status")
        with gr.Column(scale=4):
            gr.Markdown("### DLSS 5 enhanced live viewport")
            preview = gr.HTML(
                value=preview_html("realtime", "Realtime DLSS 5 enhanced output")
            )
            status = gr.Textbox(
                label="Realtime status",
                value=(
                    "Idle. Direct mode sends enhanced frames straight to MPV with no "
                    "HLS segmenting or output re-encode."
                ),
                lines=10,
                interactive=False,
            )

    tab = RealtimeTab(
        source,
        source_mode,
        local_video,
        neural,
        model_preset,
        source_quality,
        max_height,
        target_fps,
        guide_quality,
        start,
        stop,
        refresh,
        preview,
        status,
    )
    start.click(
        start_realtime,
        inputs=[
            source,
            source_mode,
            local_video,
            *neural,
            model_preset,
            source_quality,
            max_height,
            target_fps,
            guide_quality,
        ],
        outputs=[status, preview],
        concurrency_limit=1,
        show_progress="full",
    )
    stop.click(
        stop_realtime,
        outputs=[status, preview],
        queue=False,
        show_progress="hidden",
    )
    refresh.click(
        refresh_realtime_status,
        outputs=[status, preview],
        queue=False,
        show_progress="hidden",
    )

    # Deliberately no gr.Timer here. The bundled portable Gradio build supplied
    # by the user throws "'float' object has no attribute 'is_set'" from Timer
    # events. The MJPEG viewport updates independently in the browser; status is
    # refreshed manually without involving Timer internals.
    return tab


def build_realtime_tab(settings: UISettings) -> RealtimeTab | None:
    """Do not let an optional realtime-UI mismatch prevent the web app from launching."""
    try:
        return _build_realtime_tab_impl(settings)
    except Exception as exc:
        log_path = _log_realtime_error("build", exc)
        gr.Markdown(
            "### Realtime DLSS unavailable\n"
            f"The main DLSS application is still usable. The optional Realtime tab could not "
            f"initialize with this portable UI build: `{type(exc).__name__}: {exc}`\n\n"
            f"Diagnostic: `{log_path}`"
        )
        return None
