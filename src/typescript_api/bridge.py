from __future__ import annotations

import json
import shutil
import uuid
from dataclasses import asdict, fields, replace
from pathlib import Path
from typing import Any, Callable, Iterable

from ..core.ffmpeg import HDR_ALLOWED_CODECS
from ..core.gpu_detection import detect_gpus
from ..core.naming import RENAME_MODES
from ..core.paths import CONFIG_PATH, JOBS, LOGS, OUTPUTS
from ..core.runtime import (
    DLSS_MODEL_PRESETS,
    NR_PRESETS,
    NR_STYLES,
    UPSCALING_MODES,
    prepare_runtime,
)
from ..frame_interpolation.batch import interpolate_videos
from ..frame_interpolation.models import ENGINE_CHOICES, FPS_CHOICES, FrameInterpolationOptions
from ..live.models import (
    LIVE_FPS_CHOICES,
    LIVE_GUIDE_CHOICES,
    LIVE_MAX_HEIGHTS,
    LIVE_SEGMENT_CHOICES,
    LIVE_SOURCE_QUALITY_CHOICES,
    LiveOptions,
)
from ..live.pipeline import is_live_running, live_status, start_live_session, stop_live_session
from ..model_viewer.converter import prepare_for_viewer, viewer_capabilities
from ..model_viewer.live_dlss import (
    MODEL_LIVE_RESOLUTIONS,
    ModelLiveOptions,
    is_model_live_running,
    model_live_status,
    start_model_live,
    stop_model_live,
)
from ..neural_rendering.image.batch import convert_images
from ..neural_rendering.image.models import ImageConversionOptions
from ..neural_rendering.video.batch import convert_videos
from ..neural_rendering.video.models import ConversionOptions
from ..realtime.models import RealtimeOptions
from ..realtime.pipeline import (
    is_realtime_running,
    realtime_status,
    start_realtime_session,
    stop_realtime_session,
)
from ..settings.models import (
    CODEC_CHOICES,
    CONTAINER_CHOICES,
    IMAGE_FORMAT_CHOICES,
    PREVIEW_ENCODING_CHOICES,
    QUALITY_CHOICES,
    UISettings,
    _validate,
)
from ..settings.presets import import_settings_preset, preset_document
from ..settings.storage import load_settings, save_settings
from ..upscale.image.batch import upscale_images
from ..upscale.image.models import ImageUpscaleOptions
from ..upscale.video.batch import upscale_videos
from ..upscale.video.models import (
    HDR_PRECISION_CHOICES,
    SCALE_FACTORS,
    SIZE_MODES,
    VSR_QUALITIES,
    UpscaleOptions,
)


# The TypeScript UI uses camelCase; the runtime keeps the original Python/config
# names. Only persistent settings are mapped here. Live source/buffer and 3D
# session controls intentionally remain session-local, matching the Python UI.
PY_TO_TS = {
    "ai_gpu_uuid": "aiGpuId",
    "video_gpu_uuid": "videoGpuId",
    "nr_preset": "nrPreset",
    "nr_style": "nrStyle",
    "nr_intensity": "nrIntensity",
    "local_tone_strength": "localToneStrength",
    "local_structure_strength": "localStructureStrength",
    "skin_structure_strength": "skinStructureStrength",
    "upscaling_factor": "upscalingFactor",
    "automatic_mask": "automaticMask",
    "dlss_model_preset": "dlssModelPreset",
    "codec": "codec",
    "container": "container",
    "quality": "quality",
    "hdr_mode": "hdrMode",
    "preview_encoding": "previewEncoding",
    "image_format": "imageFormat",
    "image_quality": "imageQuality",
    "image_rename_mode": "imageRenameMode",
    "image_custom_suffix": "imageCustomSuffix",
    "video_rename_mode": "videoRenameMode",
    "video_custom_suffix": "videoCustomSuffix",
    "frame_interpolation_target_fps": "frameTargetFps",
    "frame_interpolation_engine": "frameEngine",
    "frame_interpolation_codec": "frameCodec",
    "frame_interpolation_container": "frameContainer",
    "frame_interpolation_quality": "frameQuality",
    "frame_interpolation_hdr_mode": "frameHdrMode",
    "frame_interpolation_rename_mode": "frameRenameMode",
    "frame_interpolation_custom_suffix": "frameCustomSuffix",
    "upscale_mode": "upscaleMode",
    "upscale_image_vsr_quality": "upscaleImageVsrQuality",
    "upscale_image_size_mode": "upscaleImageSizeMode",
    "upscale_image_scale_factor": "upscaleImageScaleFactor",
    "upscale_image_width": "upscaleImageWidth",
    "upscale_image_height": "upscaleImageHeight",
    "upscale_image_aspect_lock": "upscaleImageAspectLock",
    "upscale_image_output_format": "upscaleImageOutputFormat",
    "upscale_image_quality": "upscaleImageQuality",
    "upscale_image_preserve_metadata": "upscaleImagePreserveMetadata",
    "upscale_image_rename_mode": "upscaleImageRenameMode",
    "upscale_image_custom_suffix": "upscaleImageCustomSuffix",
    "upscale_vsr_enabled": "upscaleVsrEnabled",
    "upscale_vsr_quality": "upscaleVsrQuality",
    "upscale_size_mode": "upscaleSizeMode",
    "upscale_scale_factor": "upscaleScaleFactor",
    "upscale_width": "upscaleWidth",
    "upscale_height": "upscaleHeight",
    "upscale_aspect_lock": "upscaleAspectLock",
    "upscale_hdr_enabled": "upscaleHdrEnabled",
    "upscale_hdr_contrast": "upscaleHdrContrast",
    "upscale_hdr_saturation": "upscaleHdrSaturation",
    "upscale_hdr_middle_gray": "upscaleHdrMiddleGray",
    "upscale_hdr_peak_luminance": "upscaleHdrPeakLuminance",
    "upscale_hdr_precision": "upscaleHdrPrecision",
    "upscale_codec": "upscaleCodec",
    "upscale_container": "upscaleContainer",
    "upscale_quality": "upscaleQuality",
    "upscale_rename_mode": "upscaleRenameMode",
    "upscale_custom_suffix": "upscaleCustomSuffix",
}
TS_TO_PY = {value: key for key, value in PY_TO_TS.items()}

SESSION_DEFAULTS: dict[str, Any] = {
    "livePlaybackMode": "Realtime",
    "liveSourceMode": "Local",
    "liveSourceQuality": "Auto",
    "liveMaxHeight": 720,
    "liveFpsMode": "Auto",
    "liveGuideQuality": "Fast",
    "liveSegmentSeconds": 2,
    "liveBufferSeconds": 6,
    "liveOpenMpv": True,
    "modelLiveResolution": "720p",
}


def frontend_settings(settings: UISettings) -> dict[str, Any]:
    data = {ts_name: getattr(settings, py_name) for py_name, ts_name in PY_TO_TS.items()}
    data.update(SESSION_DEFAULTS)
    return data


def settings_from_frontend(payload: dict[str, Any] | None, current: UISettings | None = None) -> UISettings:
    current = current or load_settings(CONFIG_PATH)
    payload = payload or {}
    changes: dict[str, Any] = {}
    field_names = {field.name for field in fields(UISettings)}
    for ts_name, raw in payload.items():
        py_name = TS_TO_PY.get(ts_name)
        if py_name and py_name in field_names:
            changes[py_name] = raw
    return _validate(replace(current, **changes))


def persist_frontend_settings(payload: dict[str, Any]) -> dict[str, Any]:
    settings = settings_from_frontend(payload)
    save_settings(CONFIG_PATH, settings)
    return frontend_settings(settings)


def _gpu_label(gpu: dict[str, Any]) -> str:
    return str(gpu.get("display_name") or gpu.get("name") or "NVIDIA RTX GPU")


def _gpu_arch(name: str) -> str:
    text = name.upper()
    if "RTX 50" in text:
        return "Blackwell"
    if "RTX 40" in text:
        return "Ada Lovelace"
    if "RTX 30" in text:
        return "Ampere"
    if "RTX 20" in text:
        return "Turing"
    return "RTX"


def gpu_payload() -> list[dict[str, Any]]:
    gpus = [
        {
            "id": "auto",
            "uuid": "auto",
            "name": "Automatic (best compatible RTX)",
            "arch": "Auto",
            "vram": "Automatic",
            "driver": "",
            "index": None,
            "cudaOrdinal": None,
            "compatible": True,
        }
    ]
    for gpu in detect_gpus():
        name = _gpu_label(gpu)
        memory = int(gpu.get("memory_mb") or 0)
        gpus.append(
            {
                "id": str(gpu.get("uuid") or "auto"),
                "uuid": str(gpu.get("uuid") or ""),
                "name": name,
                "arch": _gpu_arch(name),
                "vram": f"{memory / 1024:.1f} GB" if memory else "Unknown",
                "driver": str(gpu.get("driver") or ""),
                "index": gpu.get("index"),
                "cudaOrdinal": gpu.get("cuda_ordinal"),
                "compatible": bool(gpu.get("ai_compatible", True)),
                "compatibilityError": str(gpu.get("compatibility_error") or ""),
                "pciBusId": str(gpu.get("pci_bus_id") or ""),
            }
        )
    return gpus


def bootstrap_payload() -> dict[str, Any]:
    runtime_error = ""
    runtime_ready = False
    try:
        prepare_runtime()
        runtime_ready = True
    except Exception as exc:
        runtime_error = f"{type(exc).__name__}: {exc}"
    return {
        "settings": frontend_settings(load_settings(CONFIG_PATH)),
        "gpus": gpu_payload(),
        "runtime": {"ready": runtime_ready, "error": runtime_error},
        "choices": {
            "nrPresets": list(NR_PRESETS),
            "nrStyles": list(NR_STYLES),
            "dlssModelPresets": list(DLSS_MODEL_PRESETS),
            "dlssUpscaling": [
                {"value": factor, "label": str(mode["label"]), "name": str(mode["name"])}
                for factor, mode in UPSCALING_MODES.items()
            ],
            "codecs": list(CODEC_CHOICES),
            "containers": list(CONTAINER_CHOICES),
            "qualities": list(QUALITY_CHOICES),
            "imageFormats": list(IMAGE_FORMAT_CHOICES),
            "previewEncoding": list(PREVIEW_ENCODING_CHOICES),
            "renameModes": list(RENAME_MODES),
            "hdrCodecs": sorted(HDR_ALLOWED_CODECS),
            "frameFps": list(FPS_CHOICES),
            "frameEngines": list(ENGINE_CHOICES),
            "vsrQualities": [{"label": label, "value": value} for label, value in VSR_QUALITIES],
            "rtxScaleFactors": [{"label": label, "value": value} for label, value in SCALE_FACTORS],
            "sizeModes": list(SIZE_MODES),
            "hdrPrecisions": [{"label": label, "value": value} for label, value in HDR_PRECISION_CHOICES],
            "liveSourceQuality": list(LIVE_SOURCE_QUALITY_CHOICES),
            "liveMaxHeights": list(LIVE_MAX_HEIGHTS),
            "liveFps": list(LIVE_FPS_CHOICES),
            "liveGuideQuality": list(LIVE_GUIDE_CHOICES),
            "liveSegments": [int(value) for value in LIVE_SEGMENT_CHOICES],
            "modelLiveResolutions": list(MODEL_LIVE_RESOLUTIONS),
        },
        "modelViewer": viewer_capabilities(),
    }


def save_uploaded_file(filename: str, source, *, group: str) -> Path:
    safe_name = Path(filename or "upload.bin").name
    folder = JOBS / "typescript-ui" / group / uuid.uuid4().hex
    folder.mkdir(parents=True, exist_ok=False)
    destination = folder / safe_name
    with destination.open("wb") as stream:
        shutil.copyfileobj(source, stream, length=1024 * 1024)
    return destination.resolve()


def _neural_image_options(settings: UISettings) -> ImageConversionOptions:
    return ImageConversionOptions(
        ai_gpu_uuid=settings.ai_gpu_uuid,
        nr_preset=settings.nr_preset,
        nr_style=settings.nr_style,
        nr_intensity=settings.nr_intensity,
        local_tone_strength=settings.local_tone_strength,
        local_structure_strength=settings.local_structure_strength,
        skin_structure_strength=settings.skin_structure_strength,
        upscaling_factor=settings.upscaling_factor,
        automatic_mask=settings.automatic_mask,
        dlss_model_preset=settings.dlss_model_preset,
        output_format=settings.image_format,
        quality=settings.image_quality,
        preserve_metadata=True,
        rename_mode=settings.image_rename_mode,
        custom_suffix=settings.image_custom_suffix,
    )


def _neural_video_options(settings: UISettings, *, preview_seconds=None, preview_frames=None) -> ConversionOptions:
    return ConversionOptions(
        ai_gpu_uuid=settings.ai_gpu_uuid,
        video_gpu_uuid=settings.video_gpu_uuid,
        nr_preset=settings.nr_preset,
        nr_style=settings.nr_style,
        nr_intensity=settings.nr_intensity,
        local_tone_strength=settings.local_tone_strength,
        local_structure_strength=settings.local_structure_strength,
        skin_structure_strength=settings.skin_structure_strength,
        upscaling_factor=settings.upscaling_factor,
        automatic_mask=settings.automatic_mask,
        dlss_model_preset=settings.dlss_model_preset,
        codec=settings.codec,
        container=settings.container,
        quality=settings.quality,
        preserve_hdr=settings.hdr_mode,
        rename_mode=settings.video_rename_mode,
        custom_suffix=settings.video_custom_suffix,
        preview_seconds=preview_seconds,
        preview_frames=preview_frames,
        preview_compat=True,
    )


def _image_upscale_options(settings: UISettings) -> ImageUpscaleOptions:
    return ImageUpscaleOptions(
        vsr_quality=settings.upscale_image_vsr_quality,
        size_mode=settings.upscale_image_size_mode,
        scale_factor=settings.upscale_image_scale_factor,
        width=settings.upscale_image_width,
        height=settings.upscale_image_height,
        aspect_lock=settings.upscale_image_aspect_lock,
        output_format=settings.upscale_image_output_format,
        quality=settings.upscale_image_quality,
        preserve_metadata=settings.upscale_image_preserve_metadata,
        rename_mode=settings.upscale_image_rename_mode,
        custom_suffix=settings.upscale_image_custom_suffix,
        ai_gpu_uuid=settings.ai_gpu_uuid,
    )


def _video_upscale_options(settings: UISettings, *, preview_seconds=None, preview_frames=None) -> UpscaleOptions:
    return UpscaleOptions(
        vsr_enabled=settings.upscale_vsr_enabled,
        vsr_quality=settings.upscale_vsr_quality,
        size_mode=settings.upscale_size_mode,
        scale_factor=settings.upscale_scale_factor,
        width=settings.upscale_width,
        height=settings.upscale_height,
        aspect_lock=settings.upscale_aspect_lock,
        hdr_enabled=settings.upscale_hdr_enabled,
        hdr_contrast=settings.upscale_hdr_contrast,
        hdr_saturation=settings.upscale_hdr_saturation,
        hdr_middle_gray=settings.upscale_hdr_middle_gray,
        hdr_peak_luminance=settings.upscale_hdr_peak_luminance,
        hdr_precision=settings.upscale_hdr_precision,
        codec=settings.upscale_codec,
        container=settings.upscale_container,
        quality=settings.upscale_quality,
        rename_mode=settings.upscale_rename_mode,
        custom_suffix=settings.upscale_custom_suffix,
        ai_gpu_uuid=settings.ai_gpu_uuid,
        video_gpu_uuid=settings.video_gpu_uuid,
        preview_seconds=preview_seconds,
        preview_frames=preview_frames,
    )


def _frame_options(settings: UISettings, *, preview_seconds=None) -> FrameInterpolationOptions:
    return FrameInterpolationOptions(
        ai_gpu_uuid=settings.ai_gpu_uuid,
        video_gpu_uuid=settings.video_gpu_uuid,
        target_fps=settings.frame_interpolation_target_fps,
        engine=settings.frame_interpolation_engine,
        codec=settings.frame_interpolation_codec,
        container=settings.frame_interpolation_container,
        quality=settings.frame_interpolation_quality,
        hdr_mode=settings.frame_interpolation_hdr_mode,
        rename_mode=settings.frame_interpolation_rename_mode,
        custom_suffix=settings.frame_interpolation_custom_suffix,
        preview_seconds=preview_seconds,
        preview_compat=True,
    )


def _normalise_result(result) -> dict[str, Any]:
    data = asdict(result)
    outputs: list[dict[str, Any]] = []
    for success in data.get("successes", []):
        candidate = success.get("result") if isinstance(success, dict) else None
        if candidate is None:
            candidate = success
        if not isinstance(candidate, dict):
            continue
        path = candidate.get("output_path")
        if path:
            outputs.append(
                {
                    "path": str(path),
                    "reportPath": str(candidate.get("report_path") or ""),
                    "details": candidate,
                }
            )
    return {"batch": data, "outputs": outputs}


def render_job(
    kind: str,
    paths: Iterable[str | Path],
    payload: dict[str, Any],
    *,
    controller,
    progress: Callable[[float, str], None] | None = None,
    preview_seconds: float | None = None,
    preview_frames: int | None = None,
) -> dict[str, Any]:
    settings = settings_from_frontend(payload)
    paths = [str(Path(path).resolve()) for path in paths]
    if kind == "neural-image":
        result = convert_images(
            paths,
            _neural_image_options(settings),
            progress,
            output_dir=OUTPUTS,
            controller=controller,
            generate_previews=False,
            create_zip=False,
        )
    elif kind == "neural-video":
        result = convert_videos(
            paths,
            _neural_video_options(settings, preview_seconds=preview_seconds, preview_frames=preview_frames),
            progress,
            output_dir=OUTPUTS,
            controller=controller,
        )
    elif kind == "upscale-image":
        result = upscale_images(
            paths,
            _image_upscale_options(settings),
            progress,
            output_dir=OUTPUTS,
            controller=controller,
            generate_previews=False,
        )
    elif kind == "upscale-video":
        result = upscale_videos(
            paths,
            _video_upscale_options(settings, preview_seconds=preview_seconds, preview_frames=preview_frames),
            progress,
            output_dir=OUTPUTS,
            controller=controller,
        )
    elif kind == "frame-interpolation":
        result = interpolate_videos(
            paths,
            _frame_options(settings, preview_seconds=preview_seconds),
            progress,
            output_dir=OUTPUTS,
            controller=controller,
        )
    else:
        raise ValueError(f"Unknown render kind: {kind!r}.")
    return _normalise_result(result)


_LIVE_MODE = "Realtime"


def _shared_neural_kwargs(settings: UISettings) -> dict[str, Any]:
    return {
        "nr_preset": settings.nr_preset,
        "nr_style": settings.nr_style,
        "nr_intensity": settings.nr_intensity,
        "local_tone_strength": settings.local_tone_strength,
        "local_structure_strength": settings.local_structure_strength,
        "skin_structure_strength": settings.skin_structure_strength,
        "upscaling_factor": settings.upscaling_factor,
        "automatic_mask": settings.automatic_mask,
        "dlss_model_preset": settings.dlss_model_preset,
    }


def start_live(payload: dict[str, Any], source: str) -> dict[str, Any]:
    global _LIVE_MODE
    if is_live_running() or is_realtime_running():
        raise RuntimeError("A Live session is already running; stop it first.")
    settings = settings_from_frontend(payload)
    mode = str(payload.get("livePlaybackMode") or "Realtime")
    source_quality = str(payload.get("liveSourceQuality") or "Auto")
    max_height = int(payload.get("liveMaxHeight") or 720)
    target_fps = str(payload.get("liveFpsMode") or "Auto")
    guide_quality = str(payload.get("liveGuideQuality") or "Fast")
    if mode == "Buffered":
        options = LiveOptions(
            source=source,
            source_quality=source_quality,
            max_height=max_height,
            target_fps=target_fps,
            guide_quality=guide_quality,
            segment_seconds=int(payload.get("liveSegmentSeconds") or 2),
            buffer_seconds=float(payload.get("liveBufferSeconds") or 6),
            open_mpv=bool(payload.get("liveOpenMpv", True)),
            **_shared_neural_kwargs(settings),
        )
        info = start_live_session(options)
        _LIVE_MODE = "Buffered"
        kind = "live"
    else:
        options = RealtimeOptions(
            source=source,
            source_quality=source_quality,
            max_height=max_height,
            target_fps=target_fps,
            guide_quality=guide_quality,
            **_shared_neural_kwargs(settings),
        )
        info = start_realtime_session(options)
        _LIVE_MODE = "Realtime"
        kind = "realtime"
    from ..live.browser_preview import preview_viewer_url
    return {"mode": _LIVE_MODE, "status": asdict(info), "previewUrl": preview_viewer_url(kind)}


def live_status_payload() -> dict[str, Any]:
    from ..live.browser_preview import preview_viewer_url
    if is_realtime_running():
        return {"mode": "Realtime", "status": asdict(realtime_status()), "previewUrl": preview_viewer_url("realtime")}
    if is_live_running():
        return {"mode": "Buffered", "status": asdict(live_status()), "previewUrl": preview_viewer_url("live")}
    if _LIVE_MODE == "Buffered":
        return {"mode": "Buffered", "status": asdict(live_status()), "previewUrl": preview_viewer_url("live")}
    return {"mode": "Realtime", "status": asdict(realtime_status()), "previewUrl": preview_viewer_url("realtime")}


def stop_live() -> dict[str, Any]:
    if is_realtime_running():
        stop_realtime_session()
    if is_live_running():
        stop_live_session()
    return live_status_payload()


def prepare_model(paths: list[str | Path]) -> dict[str, Any]:
    model_path, status = prepare_for_viewer([str(Path(path).resolve()) for path in paths], prefer_glb=True)
    return {"modelPath": str(Path(model_path).resolve()), "status": status}


def start_model_live_bridge(payload: dict[str, Any], model_path: str) -> dict[str, Any]:
    if is_model_live_running():
        raise RuntimeError("A DLSS 5 Live 3D session is already running; stop it first.")
    settings = settings_from_frontend(payload)
    resolution = str(payload.get("modelLiveResolution") or "720p")
    if resolution not in MODEL_LIVE_RESOLUTIONS:
        resolution = "720p"
    options = ModelLiveOptions(
        model_path=str(Path(model_path).resolve()),
        resolution=resolution,
        **_shared_neural_kwargs(settings),
    )
    info = start_model_live(options)
    from ..live.browser_preview import preview_viewer_url
    return {"status": asdict(info), "previewUrl": preview_viewer_url("model3d")}


def model_live_status_payload() -> dict[str, Any]:
    from ..live.browser_preview import preview_viewer_url
    return {"status": asdict(model_live_status()), "previewUrl": preview_viewer_url("model3d")}


def stop_model_live_bridge() -> dict[str, Any]:
    if is_model_live_running():
        stop_model_live()
    return model_live_status_payload()


def export_preset_payload(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    settings = settings_from_frontend(payload)
    return preset_document(name, settings)


def import_preset_path(path: str | Path) -> dict[str, Any]:
    current = load_settings(CONFIG_PATH)
    name, settings = import_settings_preset(path, current)
    save_settings(CONFIG_PATH, settings)
    return {"name": name, "settings": frontend_settings(settings)}
