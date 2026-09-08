"""Bounded video preparation, timestamp handling and user-visible stage timings."""
from __future__ import annotations

import json
import os
import time
from fractions import Fraction
from pathlib import Path

import numpy as np

from ...core.ffmpeg.decoder import iter_source_frames, source_pts
from ...core.ffmpeg.preview import normalize_preview_encoding, is_user_playable_request
from ...core.ffmpeg.codecs import _is_nvenc_codec
from ...core.jobs import Cancelled
from .guides import TemporalGuideGenerator


def nr_wants_compat_preview(codec: str, container: str, mode: object) -> bool:
    """Describe browser/HDR compatibility, independently of CPU vs GPU choice.

    The shared helper was changed in PR #4 to mean CPU-only compatibility.
    NR now resolves its encoder explicitly, so do not inherit that coupling.
    """
    normalized = normalize_preview_encoding(mode)
    return normalized != "Disabled" and (
        normalized == "Always H.264" or not is_user_playable_request(codec, container)
    )


def resolve_nr_preview_codec(codec: str, container: str, mode: object) -> tuple[str, str]:
    """Retain NVENC requests without forcing explicit CPU requests onto a GPU."""
    if not nr_wants_compat_preview(codec, container, mode):
        return codec, container
    # Honour the old launcher's explicit opt-out, including on updated installs.
    enabled = os.environ.get("DLSS5_FAST_PREVIEW_NVENC", "1").strip().lower()
    use_nvenc = _is_nvenc_codec(codec) and enabled not in {"0", "false", "no", "off"}
    return ("H.264 (NVIDIA NVENC)" if use_nvenc else "H.264"), "MP4"


def resolve_nr_encoder(gpus, gpu_uuid, codec, width, height, compat_preview, warnings):
    from ...core.ffmpeg.encoder import resolve_video_gpu

    try:
        return codec, resolve_video_gpu(gpus, gpu_uuid, codec, width, height)
    except Cancelled:
        raise
    except RuntimeError as exc:
        # Only an automatically selected browser-compatibility encode can fall
        # back. Never move an explicit NVENC render onto a different GPU.
        if not (compat_preview and codec == "H.264 (NVIDIA NVENC)"):
            raise
        warnings.append(f"Preview NVENC unavailable; using CPU H.264: {exc}")
        return "H.264", None



def prepare_video_frames(source, metadata, gpu, render_width, render_height,
                         preview_seconds, preview_frames, controller, stop,
                         put, stats: dict) -> None:
    # Import here to keep diagnostics/tests independent of native runtime setup.
    from ...core.runtime import resize_fit, rotate_frame

    started = time.perf_counter()
    stats.update(decoded_frames=0, transform_seconds=0.0, guide_seconds=0.0,
                 queue_wait_seconds=0.0, completion_reason="not_finished", decoder={})
    iterator = iter_source_frames(source, metadata, gpu, controller, stop, stats["decoder"])
    guides = TemporalGuideGenerator(render_width, render_height)
    first_time = None
    limit = Fraction(str(preview_seconds)) if preview_seconds is not None else None
    try:
        for index, frame in enumerate(iterator):
            if controller.cancel.is_set() or stop.is_set():
                raise Cancelled("Render stopped by user.")
            if preview_frames is not None and index >= preview_frames:
                stats["completion_reason"] = "preview_limit"
                break
            pts = source_pts(frame, index, metadata)
            timestamp = pts * Fraction(metadata["time_base"])
            if first_time is None:
                first_time = timestamp
            if limit is not None and index and timestamp - first_time >= limit:
                stats["completion_reason"] = "preview_limit"
                break
            if frame.is_corrupt:
                raise RuntimeError(f"Decoder marked source frame {index} as corrupt.")
            tick = time.perf_counter()
            rgba = rotate_frame(frame.to_ndarray(format="rgba"), metadata["rotation"])
            if rgba.shape[:2] != (render_height, render_width):
                rgba = resize_fit(rgba, render_width, render_height)
            rgba = np.ascontiguousarray(rgba, dtype=np.uint8)
            stats["transform_seconds"] += time.perf_counter() - tick
            tick = time.perf_counter()
            guide = guides.process(rgba)
            stats["guide_seconds"] += time.perf_counter() - tick
            tick = time.perf_counter()
            accepted = put((index, rgba, guide, pts))
            stats["queue_wait_seconds"] += time.perf_counter() - tick
            if not accepted:
                return
            stats["decoded_frames"] += 1
        else:
            stats["completion_reason"] = "eof"
    finally:
        # Break on a preview limit must terminate/reap FFmpeg, not leave it
        # decoding the remaining movie into a blocked stdout pipe.
        iterator.close()
        stats["seconds"] = time.perf_counter() - started


def performance_report(timings: dict, producer: dict, writer: dict,
                       frames: int, elapsed: float, encoder: str) -> dict:
    """Overlapping wall-clock measurements, not a fabricated GPU kernel profile."""
    decoder = producer.get("decoder", {})
    return {
        "decoder": decoder,
        "encoder": encoder,
        "end_to_end_fps": frames / elapsed if elapsed > 0 else 0.0,
        "stages_overlap": True,
        "native_adapter_verified": False,
        "native_frame_timing_scope": "Host write + native evaluation + readback; not GPU kernel time alone.",
        "seconds": {
            "setup_overlapped": timings.get("setup_seconds", 0.0),
            "decoder_read_and_startup": decoder.get("read_seconds", 0.0),
            "color_rotation_resize": producer.get("transform_seconds", 0.0),
            "motion_guides": producer.get("guide_seconds", 0.0),
            "producer_queue_backpressure": producer.get("queue_wait_seconds", 0.0),
            "native_input_wait": timings.get("native_input_wait_seconds", 0.0),
            "native_roundtrip": timings.get("dlss_seconds", 0.0),
            "encoder_queue_backpressure": timings.get("encoder_queue_wait_seconds", 0.0),
            "encoder_feed_active": writer.get("active_seconds", 0.0),
            "encoder_drain": timings.get("encoder_drain_seconds", 0.0),
            "native_close": timings.get("native_close_seconds", 0.0),
            "mux": timings.get("final_mux_seconds", 0.0),
            "verification": timings.get("verification_seconds", 0.0) + timings.get("source_verification_seconds", 0.0),
        },
        "note": "Stage totals overlap and must not be added to estimate elapsed time. "
                "CUDA decode still downloads frames for the host-memory native DLSS protocol.",
    }


def performance_status(report_path: str) -> str:
    """A missing diagnostic must never hide a successfully completed render."""
    try:
        report = json.loads(Path(report_path).read_text(encoding="utf-8"))
        performance = report["performance"]
        stages = performance["seconds"]
        decoder = performance["decoder"]
        name = {"ffmpeg_cuda_nvdec": "FFmpeg CUDA/NVDEC", "pyav_cpu": "PyAV CPU"}.get(
            decoder.get("backend"), "unknown")
        fallback = " (CUDA fallback; see report)" if decoder.get("fallback_reason") else ""
        return (f" Decoder: {name}{fallback}; encoder: {performance['encoder']}. "
                f"Overall: {performance['end_to_end_fps']:.2f} fps. "
                f"Setup {stages['setup_overlapped']:.2f}s; decode/read {stages['decoder_read_and_startup']:.2f}s; "
                f"guides {stages['motion_guides']:.2f}s; DLSS + transfers {stages['native_roundtrip']:.2f}s; "
                f"encode drain {stages['encoder_drain']:.2f}s. Stages overlap. "
                f"GPU name is the requested adapter, not native-worker verification. Report: {report_path}")
    except (OSError, ValueError, TypeError, KeyError):
        return f" Diagnostic report: {report_path}"
