from __future__ import annotations

import atexit
import json
import math
import os
import queue
import re
import subprocess
import threading
import time
from dataclasses import asdict, replace
from fractions import Fraction
from pathlib import Path
from typing import Any

import av
import numpy as np

from ..core.gpu_selection import resolve_runtime_ai_gpu
from ..core.jobs import BoundedLogBuffer, Cancelled, JobController, active_job, drain_bounded_text
from ..core.paths import FFMPEG, LOGS, MPV, YTDLP
from ..core.runtime import (
    DLSSFrameSession,
    prepare_runtime,
    resolve_native_settings,
    resolve_output_size,
    resolve_upscaling_mode,
    verify_feature_18,
)
from ..settings.storage import processing_gpu_settings
from ..live.models import ResolvedSource
from ..live.source_resolver import _classify, input_args, probe_source, resolve_source
from ..live.transport import (
    TIME_BASE,
    AdaptiveRate,
    PipeReader,
    TimestampMuxer,
    VideoFrame,
    get,
    put,
)
from ..neural_rendering.video.guides import TemporalGuideGenerator
from .models import (
    REALTIME_FPS_CHOICES,
    REALTIME_FRAME_COUNT,
    REALTIME_GUIDE_CHOICES,
    REALTIME_MAX_HEIGHTS,
    REALTIME_SOURCE_QUALITY_CHOICES,
    RealtimeInfo,
    RealtimeOptions,
)


_LOCK = threading.Lock()
_CURRENT: "RealtimeSession | None" = None
_LAST: RealtimeInfo | None = None


def _redact(text: str) -> str:
    return re.sub(r"(https?://[^\s?]+)\?[^\s'\"]+", r"\1?<redacted>", text)


def _fit_height(width: int, height: int, max_height: int) -> tuple[int, int]:
    scale = min(1.0, max_height / max(1, height))
    return max(2, round(width * scale / 2) * 2), max(2, round(height * scale / 2) * 2)


def validate_options(options: RealtimeOptions) -> None:
    if not options.source.strip():
        raise ValueError("Enter a video file or stream URL.")
    if options.max_height not in REALTIME_MAX_HEIGHTS:
        raise ValueError("Choose a valid maximum input height.")
    if options.source_quality not in REALTIME_SOURCE_QUALITY_CHOICES:
        raise ValueError("Choose a valid source quality.")
    if options.target_fps not in REALTIME_FPS_CHOICES:
        raise ValueError("Choose a valid realtime frame rate.")
    if options.guide_quality not in REALTIME_GUIDE_CHOICES:
        raise ValueError("Choose a valid motion-guide quality.")
    if not 1 <= options.queue_frames <= 8:
        raise ValueError("Realtime queue size must be between 1 and 8.")
    if not 5 <= options.network_timeout <= 60:
        raise ValueError("Realtime network timeout must be between 5 and 60 seconds.")
    resolve_upscaling_mode(options.upscaling_factor)
    resolve_native_settings(options)


def _check_binaries(source_kind: str) -> None:
    if not MPV.is_file():
        raise RuntimeError(f"Realtime playback requires the bundled MPV player: {MPV}")
    if source_kind in {"youtube", "twitch"} and not YTDLP.is_file():
        raise RuntimeError(f"yt-dlp is required for this page URL: {YTDLP}")


def _decoder_command(
    source: ResolvedSource,
    width: int,
    height: int,
    rate: Fraction,
    target_choice: str,
    timeout: float,
) -> list[str]:
    command = [
        str(FFMPEG),
        "-hide_banner",
        "-loglevel",
        "warning",
        "-nostdin",
        "-filter_threads",
        "2",
    ]
    command += (
        ["-dts_delta_threshold", "2"]
        if source.is_live
        else ["-copyts", "-start_at_zero"]
    )
    command += [
        *input_args(source.video_url, source.video_headers, timeout),
        "-thread_queue_size",
        "32",
        "-i",
        source.video_url,
    ]
    audio_input = "0"
    if source.audio_url and source.audio_url != source.video_url:
        command += [
            *input_args(source.audio_url, source.audio_headers, timeout),
            "-thread_queue_size",
            "32",
            "-i",
            source.audio_url,
        ]
        audio_input = "1"

    filters = [] if target_choice == "Source" else [f"fps={rate}"]
    filters += [f"scale={width}:{height}:flags=fast_bilinear", "setsar=1"]
    command += [
        "-map",
        "0:v:0",
        "-map",
        f"{audio_input}:a:0?",
        "-sn",
        "-dn",
        "-vf",
        ",".join(filters),
        "-c:v",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-threads:v",
        "1",
        "-c:a",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-af",
        "aresample=async=1:first_pts=0",
        "-fps_mode",
        "passthrough",
        "-f",
        "nut",
        "-write_index",
        "0",
        "pipe:1",
    ]
    return command


def _launch_direct_mpv(title: str, state_path: Path, extra_args: tuple[str, ...]) -> subprocess.Popen:
    env = os.environ.copy()
    env["PATH"] = str(YTDLP.parent) + os.pathsep + env.get("PATH", "")
    env["DLSS5_LIVE_PLAYER_STATE"] = str(state_path)
    command = [
        str(MPV),
        "--no-config",
        "--ytdl=no",
        "--cache=no",
        "--demuxer-readahead-secs=0",
        "--audio-buffer=0.05",
        "--video-sync=audio",
        "--framedrop=vo",
        "--hwdec=auto-safe",
        f"--script={Path(__file__).parents[1] / 'live' / 'player_status.lua'}",
        f"--title=DLSS 5 Realtime — {title}",
        "--terminal=no",
        *extra_args,
        "-",
    ]
    try:
        return subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError as exc:
        raise RuntimeError(f"Could not launch direct MPV playback: {exc}") from exc


class RealtimeSession(threading.Thread):
    """Decode -> motion guides -> signed DLSS feature 18 -> direct MPV NUT pipe.

    This path intentionally has no HLS segments and no video re-encode. Frames
    are displayed as soon as the native worker returns them. It is still not a
    game-engine zero-copy path: the existing native worker protocol exchanges
    host RGBA/motion buffers, so true GPU-texture presentation needs native
    worker changes.
    """

    def __init__(self, options: RealtimeOptions) -> None:
        super().__init__(daemon=True, name="dlss5-realtime-session")
        self.options = replace(options)
        self.controller = JobController()
        self.info = RealtimeInfo(running=True, status="Starting realtime playback...")
        self._info_lock = threading.Lock()
        self._error: str | None = None
        self._logs: dict[str, BoundedLogBuffer] = {}
        self._log_threads: list[threading.Thread] = []
        self._player: subprocess.Popen | None = None
        self._decoder: subprocess.Popen | None = None
        self._native: DLSSFrameSession | None = None
        self._rate: AdaptiveRate | None = None
        self._started = time.monotonic()
        self._player_state: dict[str, Any] = {}
        self._feature_evidence: dict[str, Any] = {}

    def _set(self, **values: Any) -> None:
        with self._info_lock:
            for key, value in values.items():
                setattr(self.info, key, value)

    def snapshot(self) -> RealtimeInfo:
        with self._info_lock:
            return replace(self.info, failures=list(self.info.failures))

    def stop(self) -> None:
        if self.info.running:
            self._set(status="Stopping realtime playback...")
        self.controller.stop()

    def _spawn_decoder(self, command: list[str]) -> subprocess.Popen:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        self.controller.register(process)
        log = self._logs["decoder"] = BoundedLogBuffer(max_tail=100)
        assert process.stderr is not None
        thread = threading.Thread(
            target=drain_bounded_text,
            args=(process.stderr, log),
            daemon=True,
            name="dlss5-realtime-decoder-log",
        )
        thread.start()
        self._log_threads.append(thread)
        return process

    def _decoder_error(self) -> RuntimeError:
        process = self._decoder
        code = process.returncode if process else None
        log = self._logs.get("decoder")
        detail = "\n".join(log.snapshot()[-12:]) if log is not None else ""
        return RuntimeError(_redact(f"Realtime decoder exited with code {code}.\n{detail}"))

    def _refresh_player_state(self) -> None:
        path = Path(self.info.report_path).with_suffix(".player.json") if self.info.report_path else None
        if path and path.is_file():
            try:
                self._player_state = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
        player = self._player
        if player is not None:
            code = player.poll()
            self._set(
                player_running=code is None,
                player_dropped_frames=int(self._player_state.get("dropped", 0))
                + int(self._player_state.get("decoder_dropped", 0)),
                av_sync_ms=float(self._player_state.get("avsync", 0.0)) * 1000,
            )
            if code not in (None, 0) and not self.controller.cancel.is_set():
                raise RuntimeError(f"Realtime MPV player exited with code {code}.")

    def _producer(
        self,
        decoder: subprocess.Popen,
        prepared: queue.Queue,
        width: int,
        height: int,
    ) -> None:
        assert self._rate is not None
        try:
            assert decoder.stdout is not None
            with av.open(
                PipeReader(decoder.stdout),
                format="nut",
                options={"probesize": "32768", "analyzeduration": "0"},
            ) as container:
                audio = next(iter(container.streams.audio), None)
                put(prepared, audio, self.controller.cancel)
                guides = TemporalGuideGenerator(
                    width,
                    height,
                    flow_width=320 if self.options.guide_quality == "Fast" else 640,
                )
                source_index = 0
                sampled = 0
                last_pts: int | None = None
                for packet in container.demux():
                    if self.controller.cancel.is_set():
                        raise Cancelled("Realtime playback stopped.")
                    if not packet.size:
                        continue
                    if packet.stream.type == "audio":
                        put(prepared, packet, self.controller.cancel)
                        continue
                    if packet.stream.type != "video":
                        continue
                    pts = round(packet.pts * packet.time_base / TIME_BASE)
                    current = source_index
                    source_index += 1
                    self._set(source_frames=source_index)
                    if not self._rate.accepts(current):
                        sampled += 1
                        self._set(sampled_frames=sampled)
                        continue
                    expected = width * height * 4
                    if packet.size != expected:
                        raise RuntimeError(
                            f"Realtime decoder returned {packet.size} RGBA bytes; expected {expected}."
                        )
                    rgba = np.frombuffer(packet, np.uint8).reshape(height, width, 4)
                    started = time.perf_counter()
                    guide = guides.process(rgba)
                    guide_ms = (time.perf_counter() - started) * 1000
                    old = self.snapshot().guide_ms
                    self._set(guide_ms=guide_ms if not old else old * 0.9 + guide_ms * 0.1)
                    discontinuity = (
                        last_pts is not None
                        and (pts <= last_pts or (pts - last_pts) * TIME_BASE > 0.5)
                    )
                    if discontinuity:
                        guides.previous_gray = None
                    duration = (
                        max(1, round(packet.duration * packet.time_base / TIME_BASE))
                        if self.options.target_fps == "Source" and packet.duration
                        else max(1, round(1 / self._rate.fps / TIME_BASE))
                    )
                    put(
                        prepared,
                        VideoFrame(
                            current,
                            pts,
                            duration,
                            rgba,
                            guide.motion,
                            guide.reset or discontinuity,
                        ),
                        self.controller.cancel,
                    )
                    last_pts = pts
                code = decoder.wait(timeout=5)
                if code:
                    raise self._decoder_error()
                if not source_index:
                    raise RuntimeError("The realtime decoder produced no video frames.")
                put(prepared, None, self.controller.cancel)
        except Cancelled:
            pass
        except Exception as exc:
            if not self.controller.cancel.is_set():
                self._error = _redact(f"Decode / motion guides: {exc}")
            self.controller.stop()

    def _write_report(self) -> None:
        if not self.info.report_path:
            return
        decoder_log = self._logs.get("decoder")
        payload = {
            "session": asdict(self.snapshot()),
            "settings": {key: value for key, value in asdict(self.options).items() if key != "source"},
            "feature_18": self._feature_evidence,
            "player": self._player_state,
            "rate_changes": self._rate.changes if self._rate else [],
            "decoder_log": [_redact(line) for line in decoder_log.snapshot()] if decoder_log else [],
            "limitations": {
                "native_adapter_verified": False,
                "zero_copy_gpu_present": False,
                "note": (
                    "Realtime removes HLS segmenting/re-encoding, but the bundled signed "
                    "feature-18 worker still accepts and returns host-memory buffers."
                ),
            },
        }
        try:
            Path(self.info.report_path).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        except OSError:
            pass

    def _run_pipeline(self) -> None:
        options = self.options
        self._set(status="Resolving realtime source...")
        resolved = resolve_source(
            options.source,
            options.max_height,
            self.controller,
            source_quality=options.source_quality,
        )
        self._set(title=resolved.title, status=f"Probing {resolved.title}...")
        metadata = probe_source(resolved, self.controller, options.network_timeout)
        self._rate = AdaptiveRate(metadata["rate"], options.target_fps)
        source_size = f"{metadata['width']}x{metadata['height']}"
        in_w, in_h = _fit_height(metadata["width"], metadata["height"], options.max_height)
        factor, mode = resolve_upscaling_mode(options.upscaling_factor)
        out_w, out_h = resolve_output_size(in_w, in_h, factor)
        self._set(
            source_size=source_size,
            input_size=f"{in_w}x{in_h}",
            output_size=f"{out_w}x{out_h}",
            source_fps=float(metadata["rate"]),
            target_fps=self._rate.fps,
            status=f"Starting direct DLSS: {in_w}x{in_h} → {out_w}x{out_h}...",
        )

        prepared_runtime = prepare_runtime()
        ai_uuid, _video_uuid = processing_gpu_settings()
        gpu = resolve_runtime_ai_gpu(
            prepared_runtime.gpus, prepared_runtime.runtime_bundle, ai_uuid
        )
        self._set(requested_gpu=str(gpu.get("display_name") or gpu.get("name") or "NVIDIA RTX GPU"))

        native = self._native = DLSSFrameSession(
            input_width=in_w,
            input_height=in_h,
            output_width=out_w,
            output_height=out_h,
            frame_count=REALTIME_FRAME_COUNT,
            warmup_frames=0,
            factor=factor,
            mode=mode,
            native_settings=resolve_native_settings(options),
            gpu=gpu,
            runtime_bundle=prepared_runtime.runtime_bundle,
            controller=self.controller,
        )

        decoder = self._decoder = self._spawn_decoder(
            _decoder_command(
                resolved,
                in_w,
                in_h,
                self._rate.rate,
                options.target_fps,
                options.network_timeout,
            )
        )
        player_state = Path(self.info.report_path).with_suffix(".player.json")
        player = self._player = _launch_direct_mpv(resolved.title, player_state, options.mpv_args)
        self.controller.register(player)
        assert player.stdin is not None

        prepared: queue.Queue = queue.Queue(maxsize=options.queue_frames)
        producer = threading.Thread(
            target=self._producer,
            args=(decoder, prepared, in_w, in_h),
            daemon=True,
            name="dlss5-realtime-producer",
        )
        producer.start()

        audio = get(prepared, self.controller.cancel)
        muxer = TimestampMuxer(player.stdin, out_w, out_h, self._rate.rate, audio)
        processing_started = time.perf_counter()
        processed = 0
        try:
            while not self.controller.cancel.is_set():
                item = get(prepared, self.controller.cancel)
                if item is None:
                    break
                self._refresh_player_state()
                if isinstance(item, VideoFrame):
                    started = time.perf_counter()
                    output, out_pts = native.process(
                        index=processed,
                        rgba=item.rgba,
                        motion=item.motion,
                        reset=item.reset,
                        pts=item.pts,
                    )
                    cost = time.perf_counter() - started
                    if out_pts != item.pts:
                        raise RuntimeError("Realtime DLSS worker changed a frame timestamp.")
                    processed += 1
                    if processed == 1:
                        evidence = verify_feature_18(
                            native.worker_logs, native.reshade_log_text()
                        )
                        self._feature_evidence = {
                            key: value for key, value in evidence.items() if key != "reshade_log"
                        }
                        self._set(feature_18_confirmed=True)
                    current = self.snapshot()
                    self._rate.observe(cost, current.guide_ms / 1000, 0.0)
                    dlss_ms = cost * 1000
                    self._set(
                        processed_frames=processed,
                        dlss_ms=dlss_ms
                        if not current.dlss_ms
                        else current.dlss_ms * 0.9 + dlss_ms * 0.1,
                        target_fps=self._rate.fps,
                        effective_fps=processed
                        / max(time.perf_counter() - processing_started, 0.001),
                        status=(
                            f"Realtime DLSS playing: {resolved.title}\n"
                            f"{self._rate.fps:.2f} fps target | {processed} enhanced | "
                            f"{self.snapshot().sampled_frames} sampled out"
                        ),
                    )
                    item = VideoFrame(item.index, item.pts, item.duration, output)
                started = time.perf_counter()
                muxer.write(item)
                if isinstance(item, VideoFrame):
                    transport_ms = (time.perf_counter() - started) * 1000
                    old = self.snapshot().transport_ms
                    self._set(
                        transport_ms=transport_ms
                        if not old
                        else old * 0.9 + transport_ms * 0.1
                    )
            self._refresh_player_state()
            if self._error:
                raise RuntimeError(self._error)
        finally:
            try:
                muxer.close()
            except Exception:
                pass
            try:
                if player.stdin and not player.stdin.closed:
                    player.stdin.close()
            except OSError:
                pass
            producer.join(timeout=3)

    def run(self) -> None:
        started = time.monotonic()
        self._started = started
        try:
            validate_options(self.options)
            kind = _classify(self.options.source)
            _check_binaries(kind)
            LOGS.mkdir(parents=True, exist_ok=True)
            live_logs = LOGS / "realtime"
            live_logs.mkdir(parents=True, exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{time.time_ns() % 1_000_000:06d}"
            self._set(report_path=str(live_logs / f"{stamp}.json"))
            with active_job(self.controller):
                self._run_pipeline()
            if self.controller.cancel.is_set():
                self._set(status="Stopped.")
            elif not self.snapshot().failures:
                self._set(
                    status=f"Finished realtime playback: {self.info.title}. "
                    f"{self.info.processed_frames} frames enhanced."
                )
        except Exception as exc:
            error = self._error or (
                None if self.controller.cancel.is_set() else _redact(str(exc))
            )
            if error:
                self._set(status=f"Failed: {error}", failures=[error])
            else:
                self._set(status="Stopped.")
        finally:
            self.controller.terminate_processes()
            native = self._native
            if native is not None and not native.closed:
                try:
                    native.abort()
                except Exception:
                    pass
            for process in (self._decoder, self._player):
                if process is None:
                    continue
                if process.poll() is None:
                    try:
                        process.terminate()
                        process.wait(timeout=3)
                    except (OSError, subprocess.TimeoutExpired):
                        try:
                            process.kill()
                            process.wait(timeout=3)
                        except Exception:
                            pass
                self.controller.unregister(process)
                for pipe in (process.stdin, process.stdout, process.stderr):
                    if pipe is not None and not getattr(pipe, "closed", True):
                        try:
                            pipe.close()
                        except OSError:
                            pass
            for thread in self._log_threads:
                thread.join(timeout=1)
            try:
                self._refresh_player_state()
            except Exception:
                pass
            self._set(
                running=False,
                player_running=False,
                elapsed_seconds=time.monotonic() - started,
            )
            self._write_report()
            with _LOCK:
                global _CURRENT, _LAST
                _LAST = self.snapshot()
                if _CURRENT is self:
                    _CURRENT = None


def start_realtime_session(options: RealtimeOptions) -> RealtimeInfo:
    try:
        validate_options(options)
        kind = _classify(options.source)
        _check_binaries(kind)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc
    global _CURRENT
    with _LOCK:
        if _CURRENT is not None and _CURRENT.is_alive():
            raise RuntimeError("A realtime session is already running; Stop it first.")
        session = RealtimeSession(options)
        _CURRENT = session
        session.start()
    return session.snapshot()


def stop_realtime_session() -> RealtimeInfo:
    with _LOCK:
        session = _CURRENT
    if session is None or not session.is_alive():
        return realtime_status()
    session.stop()
    session.join(timeout=3)
    return session.snapshot()


def is_realtime_running() -> bool:
    with _LOCK:
        return _CURRENT is not None and _CURRENT.is_alive()


def realtime_status() -> RealtimeInfo:
    with _LOCK:
        session, last = _CURRENT, _LAST
    if session is not None:
        return session.snapshot()
    return replace(last, failures=list(last.failures)) if last else RealtimeInfo()


def _shutdown() -> None:
    with _LOCK:
        session = _CURRENT
    if session is not None:
        session.stop()
        session.join(timeout=5)


atexit.register(_shutdown)
