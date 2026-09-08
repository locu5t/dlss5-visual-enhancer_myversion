"""Persistent NVDEC -> timestamped NUT pipe for the host-memory DLSS worker.

CUDA decodes compressed video; the current native DLSS protocol still needs CPU
RGBA buffers. This is deliberately not advertised as zero-copy CUDA inference.
"""
from __future__ import annotations

import os
import subprocess
import threading
import time
from contextlib import suppress
from fractions import Fraction
from pathlib import Path
from typing import Any, Iterator

from ..jobs import BoundedLogBuffer, Cancelled, JobController, drain_bounded_text
from ..paths import FFMPEG


def decode_mode(value: str | None = None) -> str:
    # Keep the launcher switches introduced in PR #4 working. The newer name
    # wins when both are set, which makes explicit A/B tests predictable.
    if value is None and "DLSS5_VIDEO_DECODE" not in os.environ:
        legacy = os.environ.get("DLSS5_CUDA_DECODE", "auto").strip().lower()
        value = {"on": "cuda", "off": "cpu"}.get(legacy, legacy)
    mode = (os.environ["DLSS5_VIDEO_DECODE"] if value is None else value).strip().lower()
    if mode not in {"auto", "cuda", "cpu"}:
        raise ValueError("DLSS5_VIDEO_DECODE must be auto, cuda, or cpu.")
    return mode


def cuda_ineligibility(metadata: dict, gpu: dict | None) -> str:
    """Conservative first implementation: progressive, 8-bit 4:2:0 SDR only.

    Never relabel HDR as SDR or guess a CUDA ordinal from Task Manager/DXGI.
    The hardware filter also fails if FFmpeg silently uses a software decoder.
    """
    if not gpu or gpu.get("cuda_ordinal") is None or not gpu.get("cuda_identity_verified"):
        return "The selected AI GPU has no verified PCI-to-CUDA device mapping."
    if metadata.get("hdr") or metadata.get("color_transfer") in {"smpte2084", "arib-std-b67"}:
        return "HDR input retains the existing decoder/color path."
    if metadata.get("pix_fmt") not in {"yuv420p", "nv12"}:
        return "CUDA streaming currently accepts 8-bit yuv420p/nv12 input only."
    if metadata.get("field_order", "unknown") not in {"progressive", "unknown"}:
        return "Interlaced input retains the existing decoder path."
    if metadata.get("codec") not in {"h264", "hevc", "vp8", "vp9", "av1"}:
        return "This input codec is not enabled for CUDA streaming."
    # Full-range and unusual matrices remain on the known color conversion path.
    if metadata.get("color_range", "unknown") not in {"tv", "unknown"}:
        return "Full-range input retains the existing decoder/color path."
    if metadata.get("color_space", "unknown") not in {"unknown", "bt709", "bt470bg", "smpte170m"}:
        return "This color matrix retains the existing decoder/color path."
    return ""


def build_decode_command(source: Path, metadata: dict, gpu: dict | None,
                         *, executable: Path = FFMPEG, cuda: bool = True) -> list[str]:
    """One FFmpeg invocation per stream, not one invocation per frame.

    The software variant is for the regression harness. Automatic fallback in
    production uses the original PyAV decoder, not this command's CPU variant.
    """
    if cuda:
        reason = cuda_ineligibility(metadata, gpu)
        if reason:
            raise ValueError(reason)
        ordinal = gpu["cuda_ordinal"]
        if isinstance(ordinal, bool) or not isinstance(ordinal, int) or ordinal < 0:
            raise ValueError("A verified nonnegative CUDA ordinal is required.")
    time_base = Fraction(metadata["time_base"])
    if time_base <= 0:
        raise ValueError("Decoder time base must be positive.")
    command = [str(executable), "-hide_banner", "-nostdin", "-loglevel", "error",
               "-xerror", "-copyts", "-noautorotate", "-err_detect", "explode"]
    if cuda:
        command += ["-hwaccel", "cuda", "-hwaccel_device", str(ordinal),
                    "-hwaccel_output_format", "cuda", "-extra_hw_frames", "4",
                    "-c:v", metadata["codec"]]
    command += ["-i", str(source), "-map", "0:v:0", "-an", "-sn", "-dn",
                "-vf", "hwdownload,format=nv12,format=rgba" if cuda else "format=rgba",
                "-c:v", "rawvideo", "-pix_fmt", "rgba", "-threads:v", "1",
                "-fps_mode", "passthrough", "-enc_time_base:v", str(time_base),
                "-avoid_negative_ts", "disabled", "-f", "nut", "-flush_packets", "1", "pipe:1"]
    return command


def source_pts(frame: Any, index: int, metadata: dict) -> int:
    """Rescale NUT/PyAV frame PTS back to the source's time base, including VFR.

    NUT can select a different time base. Reusing its integer PTS unchanged
    would change playback speed. Missing timestamps use the source frame rate.
    """
    target = Fraction(metadata["time_base"])
    if target <= 0:
        raise ValueError("Source time base must be positive.")
    if frame.pts is None:
        value = Fraction(index, 1) / Fraction(metadata["rate"]) / target
    else:
        value = Fraction(frame.pts) * Fraction(frame.time_base or target) / target
    # Nearest integer, ties away from zero (AV_ROUND_NEAR_INF).
    sign = -1 if value < 0 else 1
    value = abs(value)
    return sign * ((2 * value.numerator + value.denominator) // (2 * value.denominator))


class FFmpegDecodeSession:
    """Cancellable streaming decoder with a watchdog only during blocked reads.

    Downstream DLSS/encoding backpressure does NOT count as a decoder timeout.
    Killing the process before closing the demuxer releases blocked pipe reads.
    """

    def __init__(self, command: list[str], controller: JobController,
                 stop: threading.Event, *, timeout: float = 45.0) -> None:
        if timeout <= 0:
            raise ValueError("Decoder timeout must be positive.")
        self.command, self.controller, self.stop = command, controller, stop
        self.timeout = timeout
        self.logs = BoundedLogBuffer(max_tail=60, max_important=10)
        self.process = None
        self.container = None
        self.closed = False
        self.timed_out = False
        self.deadline = float("inf")
        self._done = threading.Event()
        self._reader = None
        self._guard = None

    def _watchdog(self) -> None:
        while not self._done.wait(0.1):
            if self.controller.cancel.is_set() or self.stop.is_set() or time.monotonic() > self.deadline:
                self.timed_out = time.monotonic() > self.deadline
                if self.process is not None:
                    with suppress(OSError):
                        self.process.kill()
                return

    def _check(self) -> None:
        if self.controller.cancel.is_set() or self.stop.is_set():
            raise Cancelled("Video decoding stopped.")
        if self.timed_out:
            raise RuntimeError(f"FFmpeg decoder made no read progress for {self.timeout:g}s.")

    def frames(self) -> Iterator[Any]:
        import av

        self._check()
        try:
            self.process = subprocess.Popen(
                self.command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, bufsize=0,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            self.controller.register(self.process)
            self._reader = threading.Thread(target=drain_bounded_text,
                args=(self.process.stderr, self.logs), name="dlss5-nvdec-log", daemon=True)
            self._guard = threading.Thread(target=self._watchdog, name="dlss5-nvdec-guard", daemon=True)
            self._reader.start()
            self.deadline = time.monotonic() + self.timeout
            self._guard.start()
            self.container = av.open(self.process.stdout, mode="r", format="nut",
                                     options={"probesize": "32768", "analyzeduration": "0"})
            stream = self.container.streams.video[0]
            iterator = iter(self.container.decode(stream))
            while True:
                self._check()
                self.deadline = time.monotonic() + self.timeout
                try:
                    frame = next(iterator)
                except StopIteration:
                    break
                finally:
                    self.deadline = float("inf")
                self._check()
                if frame.is_corrupt:
                    raise RuntimeError("FFmpeg decoder returned a corrupt frame.")
                yield frame
            code = self.process.wait(timeout=10)
            self._reader.join(timeout=2)
            self._check()
            if code:
                raise RuntimeError(f"FFmpeg decoder exited with code {code}.")
        except Exception as exc:
            self._check()
            if self._reader is not None:
                self._reader.join(timeout=0.2)
            details = "\n".join(self.logs.snapshot())[-4000:]
            raise RuntimeError(f"FFmpeg decoding failed: {exc}\n{details}") from exc
        finally:
            self.close()

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        self._done.set()
        process = self.process
        if process is not None:
            if process.poll() is None:
                with suppress(OSError):
                    process.kill()
            with suppress(OSError, subprocess.TimeoutExpired):
                process.wait(timeout=5)
        if self.container is not None:
            with suppress(Exception):
                self.container.close()
        for thread in (self._reader, self._guard):
            if thread is not None:
                thread.join(timeout=2)
        if process is not None:
            for pipe in (process.stdout, process.stderr):
                if pipe is not None:
                    with suppress(OSError):
                        pipe.close()
            self.controller.unregister(process)


def _cpu_frames(source: Path) -> Iterator[Any]:
    import av

    with av.open(str(source)) as container:
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        yield from container.decode(stream)


def iter_source_frames(source: Path, metadata: dict, gpu: dict | None,
                       controller: JobController, stop: threading.Event, diagnostics: dict,
                       *, mode: str | None = None) -> Iterator[Any]:
    """Try CUDA once; fall back only BEFORE any CUDA frame is published.

    A midstream failure aborts the render rather than replaying frames or
    silently saving an incomplete video. Cancellation never triggers a retry.
    """
    requested = decode_mode(mode)
    diagnostics.update(requested=requested, backend="not_started", frames=0,
                       read_seconds=0.0, cuda_gpu_uuid=None, fallback_reason=None)
    if controller.cancel.is_set() or stop.is_set():
        raise Cancelled("Video decoding stopped.")
    reason = cuda_ineligibility(metadata, gpu) if requested != "cpu" else ""
    if requested == "cuda" and reason:
        raise RuntimeError("CUDA decoding requested: " + reason)
    if requested != "cpu" and not reason:
        command = build_decode_command(source, metadata, gpu)
        session = FFmpegDecodeSession(command, controller, stop)
        iterator = iter(session.frames())
        diagnostics["command"] = command
        try:
            while True:
                tick = time.perf_counter()
                try:
                    frame = next(iterator)
                except StopIteration:
                    if not diagnostics["frames"]:
                        raise RuntimeError("CUDA decoder returned no frames.")
                    return
                finally:
                    diagnostics["read_seconds"] += time.perf_counter() - tick
                if (frame.width, frame.height) != (metadata["coded_width"], metadata["coded_height"]):
                    raise RuntimeError("CUDA decoder changed dimensions; refusing an unexpected transform.")
                diagnostics.update(backend="ffmpeg_cuda_nvdec", cuda_gpu_uuid=gpu["uuid"])
                diagnostics["frames"] += 1
                yield frame
        except Cancelled:
            raise
        except Exception as exc:
            if controller.cancel.is_set() or stop.is_set():
                raise Cancelled("Video decoding stopped.") from exc
            if requested == "cuda" or diagnostics["frames"]:
                raise RuntimeError("CUDA decode failed; no midstream CPU replay is permitted. " + str(exc)) from exc
            reason = str(exc)[-4000:]
        finally:
            iterator.close()
            session.close()
            diagnostics["stderr_tail"] = session.logs.snapshot()
    if reason:
        diagnostics["fallback_reason"] = reason
    diagnostics["backend"] = "pyav_cpu"
    iterator = iter(_cpu_frames(source))
    try:
        while True:
            if controller.cancel.is_set() or stop.is_set():
                raise Cancelled("Video decoding stopped.")
            tick = time.perf_counter()
            try:
                frame = next(iterator)
            except StopIteration:
                return
            finally:
                diagnostics["read_seconds"] += time.perf_counter() - tick
            if frame.is_corrupt:
                raise RuntimeError("CPU decoder marked a source frame as corrupt.")
            diagnostics["frames"] += 1
            yield frame
    finally:
        iterator.close()
