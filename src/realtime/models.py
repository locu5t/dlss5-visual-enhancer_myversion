from __future__ import annotations

from dataclasses import dataclass, field


REALTIME_MAX_HEIGHTS = (480, 720, 1080, 1440, 2160)
REALTIME_HEIGHT_CHOICES = tuple(str(value) for value in REALTIME_MAX_HEIGHTS)
REALTIME_FPS_CHOICES = ("Auto", "Source", "60", "30", "24")
REALTIME_GUIDE_CHOICES = ("Fast", "Quality")
REALTIME_SOURCE_QUALITY_CHOICES = ("Auto", *REALTIME_HEIGHT_CHOICES)

# The native streaming protocol accepts a finite uint32 frame count. A very
# large count is informational for open-ended sessions.
REALTIME_FRAME_COUNT = 1_000_000_000


@dataclass(slots=True)
class RealtimeOptions:
    source: str = ""
    source_quality: str = "Auto"
    max_height: int = 720
    target_fps: str = "Auto"
    guide_quality: str = "Fast"
    upscaling_factor: float = 1.5
    nr_preset: str = "Default"
    nr_style: str = "Default"
    nr_intensity: float = 1.0
    local_tone_strength: float = 1.0
    local_structure_strength: float = 1.0
    skin_structure_strength: float = -1.0
    automatic_mask: bool = False
    dlss_model_preset: str = "Default"
    network_timeout: float = 20.0
    queue_frames: int = 2
    mpv_args: tuple[str, ...] = ()


@dataclass(slots=True)
class RealtimeInfo:
    running: bool = False
    status: str = "Idle."
    title: str = ""
    requested_gpu: str = ""
    source_size: str = ""
    input_size: str = ""
    output_size: str = ""
    source_fps: float = 0.0
    target_fps: float = 0.0
    effective_fps: float = 0.0
    source_frames: int = 0
    processed_frames: int = 0
    sampled_frames: int = 0
    guide_ms: float = 0.0
    dlss_ms: float = 0.0
    transport_ms: float = 0.0
    player_running: bool = False
    player_dropped_frames: int = 0
    av_sync_ms: float = 0.0
    elapsed_seconds: float = 0.0
    report_path: str = ""
    feature_18_confirmed: bool = False
    failures: list[str] = field(default_factory=list)
