from __future__ import annotations

import traceback
from dataclasses import dataclass
from pathlib import Path

import gradio as gr

from ..core.paths import LOGS
from ..settings.models import UISettings, parse_automatic_mask
from ..neural_rendering.video.ui import build_dlss_model_control, build_neural_controls
from .browser_preview import install_browser_preview, preview_html
from .models import (
    LIVE_FPS_CHOICES,
    LIVE_GUIDE_CHOICES,
    LIVE_MAX_HEIGHT_CHOICES,
    LIVE_MAX_HEIGHTS,
    LIVE_SEGMENT_CHOICES,
    LIVE_SOURCE_QUALITY_CHOICES,
    LiveOptions,
)
from .pipeline import is_live_running, live_status, start_live_session, stop_live_session
from ..realtime.models import RealtimeOptions
from ..realtime.pipeline import (
    is_realtime_running,
    realtime_status,
    start_realtime_session,
    stop_realtime_session,
)

install_browser_preview()
MODE_REALTIME = "Realtime (lowest latency)"
MODE_BUFFERED = "Buffered (HLS + larger buffer)"
_LAST_MODE = MODE_REALTIME


def _log_live_ui_error(stage: str, exc: BaseException) -> None:
    """Keep callback tracebacks visible even when Gradio renders only a toast."""
    try:
        LOGS.mkdir(parents=True, exist_ok=True)
        with (LOGS / "live_ui_error.log").open("a", encoding="utf-8") as stream:
            stream.write(f"\n[Live UI / {stage}] {type(exc).__name__}: {exc}\n")
            stream.write("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
    except Exception:
        pass


def _selected_source(source_mode: str, online: str, local_video: str | None) -> str:
    if source_mode == "Local":
        if not local_video or not Path(str(local_video)).is_file():
            raise gr.Error("Select a local video before starting Live.")
        return str(local_video)
    if source_mode == "Online":
        selected = (online or "").strip()
        if not selected:
            raise gr.Error("Enter an online URL, or select Local.")
        return selected
    raise gr.Error("Choose Online or Local as the source.")


def _common_values(max_height: str, upscaling_factor: float, automatic_mask: str):
    try:
        height = int(max_height)
    except (TypeError, ValueError):
        height = 720
    try:
        factor = float(upscaling_factor)
        auto_mask = parse_automatic_mask(automatic_mask)
    except (TypeError, ValueError) as exc:
        raise gr.Error(str(exc)) from exc
    return (height if height in LIVE_MAX_HEIGHTS else 720), factor, auto_mask


def _format_status(mode: str, info) -> str:
    if mode == MODE_REALTIME:
        lines = ["Playback mode: Realtime"]
        if not info.running and info.status == "Idle.":
            lines.append("Idle. Enhanced frames will be sent to the low-latency player.")
            return "\n".join(lines)
        lines.append(info.status)
        if info.source_size:
            lines.append(
                f"Source {info.source_size} -> DLSS input {info.input_size} -> output {info.output_size}"
            )
        if info.requested_gpu:
            lines.append(f"Requested AI GPU: {info.requested_gpu}")
        if info.source_fps:
            lines.append(
                f"Source {info.source_fps:.2f} fps | target {info.target_fps:.2f} fps | "
                f"effective {info.effective_fps:.2f} fps"
            )
            lines.append(
                f"Motion guides {info.guide_ms:.1f} ms | DLSS roundtrip {info.dlss_ms:.1f} ms | "
                f"player transport {info.transport_ms:.1f} ms"
            )
        if info.feature_18_confirmed:
            lines.append("Signed NVIDIA feature 18 confirmed.")
        if info.report_path:
            lines.append(f"Diagnostics: {info.report_path}")
        return "\n".join(lines)

    lines = ["Playback mode: Buffered"]
    if not info.running and info.status == "Idle.":
        lines.append("Idle. Buffered mode uses HLS/NVENC and the same post-DLSS browser player.")
        return "\n".join(lines)
    lines.append(info.status)
    if info.output_size:
        lines.append(
            f"Received {info.source_size} -> Processing {info.input_size} -> "
            f"Output {info.output_size} | {info.encoder}"
        )
    if info.mpv_running:
        lines.append(
            f"MPV: {info.player_dropped_frames} dropped | {info.rebuffer_events} rebuffer events | "
            f"A/V offset {info.av_sync_ms:+.1f} ms"
        )
    if info.source_quality_note:
        lines.append(info.source_quality_note)
    lines.append(f"DLSS effects: {info.effects_status}")
    if info.effects_error:
        lines.append(f"Effect update: {info.effects_error}")
    if info.processing and info.source_fps:
        lines.append(
            f"Source {info.source_fps:.2f} fps | guides {info.guide_ms:.1f} ms | "
            f"DLSS {info.dlss_ms:.1f} ms | encode transport {info.encode_ms:.1f} ms"
        )
    if info.report_path:
        lines.append(f"Diagnostics: {info.report_path}")
    return "\n".join(lines)


def start_unified_live(
    playback_mode,
    source_mode,
    online_source,
    local_video,
    nr_preset,
    nr_style,
    nr_intensity,
    local_tone_strength,
    local_structure_strength,
    skin_structure_strength,
    upscaling_factor,
    automatic_mask,
    dlss_model_preset,
    source_quality,
    max_height,
    target_fps,
    guide_quality,
    segment_seconds,
    buffer_seconds,
    open_mpv,
):
    global _LAST_MODE
    try:
        if is_live_running() or is_realtime_running():
            raise RuntimeError("A Live session is already running. Stop it before starting another mode.")
        source = _selected_source(source_mode, online_source, local_video)
        height, factor, auto_mask = _common_values(max_height, upscaling_factor, automatic_mask)

        if playback_mode == MODE_BUFFERED:
            try:
                segment = int(segment_seconds)
            except (TypeError, ValueError):
                segment = 2
            options = LiveOptions(
                source=source,
                source_quality=source_quality,
                max_height=height,
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
                segment_seconds=segment if segment in (1, 2, 4, 6) else 2,
                buffer_seconds=float(buffer_seconds),
                open_mpv=bool(open_mpv),
            )
            info = start_live_session(options)
            _LAST_MODE = MODE_BUFFERED
            return _format_status(MODE_BUFFERED, info), preview_html(
                "live", "DLSS 5 enhanced Live output"
            )

        options = RealtimeOptions(
            source=source,
            source_quality=source_quality,
            max_height=height,
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
        info = start_realtime_session(options)
        _LAST_MODE = MODE_REALTIME
        return _format_status(MODE_REALTIME, info), preview_html(
            "realtime", "DLSS 5 enhanced Live output"
        )
    except Exception as exc:
        _log_live_ui_error("start", exc)
        # Do not let the portable Gradio queue turn a callback exception into two
        # anonymous Error panels. Surface the backend failure in the status box.
        return (
            f"Playback failed to start: {type(exc).__name__}: {exc}\n"
            f"Diagnostic: {LOGS / 'live_ui_error.log'}",
            preview_html("live" if playback_mode == MODE_BUFFERED else "realtime", "DLSS 5 enhanced Live output"),
        )


def stop_unified_live():
    global _LAST_MODE
    try:
        if is_realtime_running():
            info = stop_realtime_session()
            _LAST_MODE = MODE_REALTIME
            return _format_status(MODE_REALTIME, info), preview_html(
                "realtime", "DLSS 5 enhanced Live output"
            )
        if is_live_running():
            info = stop_live_session()
            _LAST_MODE = MODE_BUFFERED
            return _format_status(MODE_BUFFERED, info), preview_html(
                "live", "DLSS 5 enhanced Live output"
            )
        return refresh_unified_status()
    except Exception as exc:
        _log_live_ui_error("stop", exc)
        return f"Stop failed: {type(exc).__name__}: {exc}", preview_html(
            "realtime", "DLSS 5 enhanced Live output"
        )


def refresh_unified_status():
    if is_realtime_running():
        return _format_status(MODE_REALTIME, realtime_status()), preview_html(
            "realtime", "DLSS 5 enhanced Live output"
        )
    if is_live_running():
        return _format_status(MODE_BUFFERED, live_status()), preview_html(
            "live", "DLSS 5 enhanced Live output"
        )
    if _LAST_MODE == MODE_BUFFERED:
        return _format_status(MODE_BUFFERED, live_status()), preview_html(
            "live", "DLSS 5 enhanced Live output"
        )
    return _format_status(MODE_REALTIME, realtime_status()), preview_html(
        "realtime", "DLSS 5 enhanced Live output"
    )


@dataclass(slots=True)
class LiveTab:
    playback_mode: object
    source_mode: object
    source: object
    local_video: object
    neural: list[object]
    model_preset: object
    source_quality: object
    max_height: object
    target_fps: object
    guide_quality: object
    segment: object
    buffer: object
    open_mpv: object
    start: object
    stop: object
    refresh: object
    preview: object
    status: object

    @property
    def settings_inputs(self):
        return [*self.neural, self.model_preset]


def build_live_tab(settings: UISettings) -> LiveTab:
    height_labels = {"1440": "1440p (2K)", "2160": "2160p (4K)"}
    gr.Markdown(
        "### Unified DLSS 5 Live\n"
        "Realtime and buffered playback share **one source and one set of DLSS parameters**. "
        "Use Realtime for the lowest latency, or Buffered for HLS/MPV buffering. The in-app "
        "post-feature-18 player follows the actual video aspect ratio and includes play/pause "
        "plus a rolling scrub bar."
    )
    with gr.Row():
        with gr.Column(scale=3):
            playback_mode = gr.Radio(
                choices=[MODE_REALTIME, MODE_BUFFERED], value=MODE_REALTIME, label="Playback mode"
            )
            source_mode = gr.Radio(choices=["Online", "Local"], value="Local", label="Source")
            source = gr.Textbox(
                label="Online URL", placeholder="Direct stream URL, YouTube or Twitch URL"
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
                        for value in LIVE_SOURCE_QUALITY_CHOICES
                    ],
                    value="Auto",
                    label="Source quality",
                )
                max_height = gr.Dropdown(
                    choices=[
                        (height_labels.get(value, f"{value}p"), value)
                        for value in LIVE_MAX_HEIGHT_CHOICES
                    ],
                    value="720",
                    label="Max DLSS input height",
                )
            with gr.Row():
                target_fps = gr.Dropdown(
                    choices=list(LIVE_FPS_CHOICES), value="Auto", label="Live frame rate"
                )
                guide_quality = gr.Dropdown(
                    choices=list(LIVE_GUIDE_CHOICES), value="Fast", label="Motion guide quality"
                )
            with gr.Accordion("Buffered-mode options", open=False):
                with gr.Row():
                    segment = gr.Dropdown(
                        choices=list(LIVE_SEGMENT_CHOICES), value="2", label="HLS segment length (s)"
                    )
                    buffer = gr.Slider(
                        minimum=2,
                        maximum=30,
                        step=1,
                        value=6,
                        label="Playback buffer (seconds)",
                    )
                open_mpv = gr.Checkbox(value=True, label="Open external MPV in Buffered mode")
                gr.Markdown(
                    "These controls apply only to Buffered mode. There are no duplicate source or "
                    "DLSS controls for the Realtime backend."
                )
            with gr.Row():
                start = gr.Button("Start DLSS 5 Live", variant="primary")
                stop = gr.Button("Stop", variant="stop")
                refresh = gr.Button("Refresh Status")
        with gr.Column(scale=4):
            gr.Markdown("### DLSS 5 enhanced playback")
            preview = gr.HTML(value=preview_html("realtime", "DLSS 5 enhanced Live output"))
            status = gr.Textbox(
                label="Live status",
                value="Playback mode: Realtime\nIdle. Enhanced frames will appear here.",
                lines=11,
                interactive=False,
            )

    tab = LiveTab(
        playback_mode,
        source_mode,
        source,
        local_video,
        neural,
        model_preset,
        source_quality,
        max_height,
        target_fps,
        guide_quality,
        segment,
        buffer,
        open_mpv,
        start,
        stop,
        refresh,
        preview,
        status,
    )

    # These handlers only start/stop background session threads. Running them
    # through Gradio's portable queue is unnecessary and on the user's bundled
    # build triggers ``'float' object has no attribute 'is_set'``. Bypass the
    # queue completely for this control surface.
    start.click(
        start_unified_live,
        inputs=[
            playback_mode,
            source_mode,
            source,
            local_video,
            *neural,
            model_preset,
            source_quality,
            max_height,
            target_fps,
            guide_quality,
            segment,
            buffer,
            open_mpv,
        ],
        outputs=[status, preview],
        queue=False,
        show_progress="hidden",
    )
    stop.click(
        stop_unified_live,
        outputs=[status, preview],
        queue=False,
        show_progress="hidden",
    )
    refresh.click(
        refresh_unified_status,
        outputs=[status, preview],
        queue=False,
        show_progress="hidden",
    )
    return tab
