"""CUDA pipeline regression tests without an NVIDIA device or native DLLs.

Runtime/UI/encoder policy dependencies are isolated with test doubles. Tests
with local ffmpeg/ffprobe also exercise the REAL software variant of the NUT
transport command. They do not claim to execute NVDEC or the native DLSS worker.
Run: python -m unittest discover -s tests -p test_cuda_pipeline.py -v
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from fractions import Fraction
from unittest.mock import Mock, patch

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "_cuda_pipeline_tests"
for name in ("", ".core", ".core.ffmpeg", ".neural_rendering", ".neural_rendering.video"):
    module = types.ModuleType(PREFIX + name)
    module.__path__ = []
    sys.modules[module.__name__] = module


def load(name, path):
    spec = importlib.util.spec_from_file_location(PREFIX + "." + name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


jobs = load("core.jobs", "src/core/jobs.py")
paths = types.ModuleType(PREFIX + ".core.paths")
paths.FFMPEG = Path("ffmpeg.exe")
sys.modules[paths.__name__] = paths
shared_preview = types.ModuleType(PREFIX + ".core.ffmpeg.preview")
shared_preview.resolve_preview_codec = Mock(return_value=("H.264", "MP4"))
shared_preview.wants_compat_preview = Mock(return_value=True)
sys.modules[shared_preview.__name__] = shared_preview
codecs = types.ModuleType(PREFIX + ".core.ffmpeg.codecs")
codecs._is_nvenc_codec = lambda value: value in {"H.264 (NVIDIA NVENC)", "H.265 (NVIDIA NVENC)", "AV1 (NVIDIA NVENC)"}
sys.modules[codecs.__name__] = codecs
encoder = types.ModuleType(PREFIX + ".core.ffmpeg.encoder")
encoder.resolve_video_gpu = Mock()
sys.modules[encoder.__name__] = encoder
runtime = types.ModuleType(PREFIX + ".core.runtime")
runtime.resize_fit = Mock(side_effect=lambda rgba, w, h: np.zeros((h, w, 4), np.uint8))
runtime.rotate_frame = lambda rgba, angle: np.rot90(rgba, -(angle // 90)).copy()
sys.modules[runtime.__name__] = runtime
guides = types.ModuleType(PREFIX + ".neural_rendering.video.guides")
guides.TemporalGuideGenerator = Mock(return_value=Mock(process=Mock(return_value="guide")))
sys.modules[guides.__name__] = guides
D = load("core.ffmpeg.decoder", "src/core/ffmpeg/decoder.py")
P = load("neural_rendering.video.pipeline_io", "src/neural_rendering/video/pipeline_io.py")

GPU = {"uuid": "GPU-4090", "index": 0, "cuda_ordinal": 1, "cuda_identity_verified": True}
META = dict(codec="h264", pix_fmt="yuv420p", hdr=False, color_transfer="bt709",
            color_range="tv", field_order="progressive", time_base=Fraction(1, 15360),
            rate=Fraction(30), coded_width=128, coded_height=64, rotation=0)


def frame(pts=0, time_base=Fraction(1, 15360), corrupt=False):
    return types.SimpleNamespace(pts=pts, time_base=time_base, width=128, height=64,
        is_corrupt=corrupt, to_ndarray=lambda **kw: np.zeros((64, 128, 4), np.uint8))


class DecoderPolicyTests(unittest.TestCase):
    def test_modes(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(D.decode_mode(), "auto")
        self.assertEqual(D.decode_mode(" CUDA "), "cuda")
        with self.assertRaises(ValueError): D.decode_mode("gpu0")

    def test_cuda_device_mapping_and_one_stream(self):
        cmd = D.build_decode_command(Path('G:/My video/test.mp4'), META, GPU)
        self.assertEqual(cmd[cmd.index("-hwaccel_device") + 1], "1")
        self.assertEqual(cmd.count("-i"), 1)
        self.assertIn("-copyts", cmd)
        self.assertIn("-noautorotate", cmd)
        self.assertIn("hwdownload,format=nv12,format=rgba", cmd)
        self.assertEqual(cmd[-1], "pipe:1")
        self.assertNotIn("-r", cmd)
        self.assertNotIn("-t", cmd)  # Preview cutoff is timestamp-based in the consumer.

    def test_does_not_mutate_cuda_visibility(self):
        with patch.dict(os.environ, {"CUDA_VISIBLE_DEVICES": "GPU-A,GPU-B"}):
            D.build_decode_command(Path("source.mp4"), META, GPU)
            self.assertEqual(os.environ["CUDA_VISIBLE_DEVICES"], "GPU-A,GPU-B")

    def test_conservative_format_gate(self):
        for changes in ({"hdr": True}, {"pix_fmt": "yuv420p10le"}, {"pix_fmt": "yuva420p"},
                        {"field_order": "tt"}, {"color_range": "pc"}, {"codec": "prores"}, {"color_space": "bt2020nc"}):
            with self.subTest(changes=changes):
                self.assertTrue(D.cuda_ineligibility(dict(META, **changes), GPU))
        self.assertEqual(D.cuda_ineligibility(META, GPU), "")

    def test_unverified_device_rejected(self):
        self.assertTrue(D.cuda_ineligibility(META, dict(GPU, cuda_identity_verified=False)))
        with self.assertRaises(ValueError):
            D.build_decode_command(Path("x"), META, dict(GPU, cuda_ordinal=-1))

    def test_rescale_nut_time_base(self):
        self.assertEqual(D.source_pts(frame(8192, Fraction(1, 61440)), 0, META), 2048)

    def test_nonzero_and_negative_pts(self):
        self.assertEqual(D.source_pts(frame(3200, Fraction(1, 1000)), 0, META), 49152)
        self.assertEqual(D.source_pts(frame(-1000, Fraction(1, 1000)), 0, META), -15360)

    def test_missing_pts_uses_fps_not_frame_index_as_ticks(self):
        self.assertEqual(D.source_pts(frame(None), 3, META), 1536)

    def test_pts_rounding_is_signed_nearest(self):
        meta = dict(META, time_base=Fraction(1))
        self.assertEqual(D.source_pts(frame(1, Fraction(1, 2)), 0, meta), 1)
        self.assertEqual(D.source_pts(frame(-1, Fraction(1, 2)), 0, meta), -1)


class FallbackTests(unittest.TestCase):
    def setUp(self):
        self.controller, self.stop, self.stats = jobs.JobController(), threading.Event(), {}

    def collect(self, mode="auto", metadata=META):
        return list(D.iter_source_frames(Path("test.mp4"), metadata, GPU,
                    self.controller, self.stop, self.stats, mode=mode))

    def session(self, factory):
        session = Mock()
        session.frames.side_effect = factory
        session.logs.snapshot.return_value = ["diagnostic"]
        return session

    def test_auto_fallback_before_first_frame(self):
        def fail():
            raise RuntimeError("NVDEC unavailable")
            yield
        session = self.session(fail)
        with patch.object(D, "FFmpegDecodeSession", return_value=session), \
             patch.object(D, "_cpu_frames", return_value=(item for item in [frame()])) as cpu:
            self.assertEqual(len(self.collect()), 1)
            cpu.assert_called_once()
        self.assertEqual(self.stats["backend"], "pyav_cpu")
        self.assertIn("NVDEC unavailable", self.stats["fallback_reason"])
        session.close.assert_called_once()

    def test_midstream_failure_never_replays_cpu(self):
        def fail_after_one():
            yield frame()
            raise RuntimeError("device removed")
        session = self.session(fail_after_one)
        with patch.object(D, "FFmpegDecodeSession", return_value=session), patch.object(D, "_cpu_frames") as cpu:
            with self.assertRaisesRegex(RuntimeError, "no midstream"):
                self.collect()
            cpu.assert_not_called()

    def test_forced_cuda_never_silently_falls_back(self):
        session = self.session(lambda: (_ for _ in ()))
        with patch.object(D, "FFmpegDecodeSession", return_value=session), patch.object(D, "_cpu_frames") as cpu:
            with self.assertRaises(RuntimeError): self.collect("cuda")
            cpu.assert_not_called()

    def test_success_reports_cuda_only_after_a_frame(self):
        session = self.session(lambda: (item for item in [frame()]))
        with patch.object(D, "FFmpegDecodeSession", return_value=session):
            self.assertEqual(len(self.collect()), 1)
        self.assertEqual(self.stats["backend"], "ffmpeg_cuda_nvdec")
        self.assertEqual(self.stats["cuda_gpu_uuid"], "GPU-4090")

    def test_cpu_mode_never_starts_ffmpeg(self):
        with patch.object(D, "FFmpegDecodeSession") as start, \
             patch.object(D, "_cpu_frames", return_value=(item for item in [frame()])):
            self.collect("cpu")
            start.assert_not_called()

    def test_unsupported_input_auto_uses_cpu(self):
        with patch.object(D, "FFmpegDecodeSession") as start, \
             patch.object(D, "_cpu_frames", return_value=(item for item in [frame()])):
            self.collect(metadata=dict(META, hdr=True))
            start.assert_not_called()
        self.assertIn("HDR", self.stats["fallback_reason"])

    def test_unsupported_input_forced_cuda_errors(self):
        with self.assertRaisesRegex(RuntimeError, "HDR"):
            self.collect("cuda", dict(META, hdr=True))

    def test_cancel_never_falls_back(self):
        def cancelled():
            self.controller.cancel.set()
            raise jobs.Cancelled("cancelled")
            yield
        with patch.object(D, "FFmpegDecodeSession", return_value=self.session(cancelled)), patch.object(D, "_cpu_frames") as cpu:
            with self.assertRaises(jobs.Cancelled): self.collect()
            cpu.assert_not_called()

    def test_corrupt_cpu_frame_rejected(self):
        with patch.object(D, "_cpu_frames", return_value=(item for item in [frame(corrupt=True)])):
            with self.assertRaisesRegex(RuntimeError, "corrupt"): self.collect("cpu")


class PreviewTests(unittest.TestCase):
    def setUp(self):
        shared_preview.resolve_preview_codec.reset_mock()
        shared_preview.resolve_preview_codec.return_value = ("H.264", "MP4")
        shared_preview.wants_compat_preview.return_value = True
        encoder.resolve_video_gpu.reset_mock(side_effect=True)
        encoder.resolve_video_gpu.return_value = GPU

    def test_nvenc_preview_not_downgraded_to_slow_cpu(self):
        for codec in ("H.265 (NVIDIA NVENC)", "AV1 (NVIDIA NVENC)"):
            self.assertEqual(P.resolve_nr_preview_codec(codec, "MKV", "Auto"), ("H.264 (NVIDIA NVENC)", "MP4"))

    def test_explicit_cpu_stays_cpu(self):
        self.assertEqual(P.resolve_nr_preview_codec("H.265", "MP4", "Auto"), ("H.264", "MP4"))

    def test_disabled_retains_user_codec(self):
        shared_preview.wants_compat_preview.return_value = False
        shared_preview.resolve_preview_codec.return_value = ("AV1 (NVIDIA NVENC)", "MKV")
        self.assertEqual(P.resolve_nr_preview_codec("AV1 (NVIDIA NVENC)", "MKV", "Disabled"), ("AV1 (NVIDIA NVENC)", "MKV"))

    def test_preview_gpu_resolution_uses_effective_nvenc_codec(self):
        self.assertEqual(P.resolve_nr_encoder((GPU,), "GPU-4090", "H.264 (NVIDIA NVENC)", 2112, 3696, True, []), ("H.264 (NVIDIA NVENC)", GPU))
        encoder.resolve_video_gpu.assert_called_once_with((GPU,), "GPU-4090", "H.264 (NVIDIA NVENC)", 2112, 3696)

    def test_compat_probe_failure_has_explicit_cpu_warning(self):
        encoder.resolve_video_gpu.side_effect = RuntimeError("unavailable")
        warnings = []
        self.assertEqual(P.resolve_nr_encoder((GPU,), "GPU-4090", "H.264 (NVIDIA NVENC)", 2112, 3696, True, warnings), ("H.264", None))
        self.assertIn("CPU", warnings[0])

    def test_final_nvenc_failure_stays_an_error(self):
        encoder.resolve_video_gpu.side_effect = RuntimeError("unavailable")
        with self.assertRaises(RuntimeError):
            P.resolve_nr_encoder((GPU,), "GPU-4090", "H.264 (NVIDIA NVENC)", 2112, 3696, False, [])

    def test_cancel_is_not_a_cpu_fallback(self):
        encoder.resolve_video_gpu.side_effect = jobs.Cancelled("cancelled")
        with self.assertRaises(jobs.Cancelled):
            P.resolve_nr_encoder((GPU,), "GPU-4090", "H.264 (NVIDIA NVENC)", 2112, 3696, True, [])

    def test_three_second_limit_and_timestamp_rescaling(self):
        items, stats = [], {}
        def frames(*args):
            for i in range(100):
                yield frame(i * 2048, Fraction(1, 61440))
        with patch.object(P, "iter_source_frames", side_effect=frames):
            P.prepare_video_frames(Path("x"), META, GPU, 128, 64, 3.0, None,
                jobs.JobController(), threading.Event(), lambda item: items.append(item) or True, stats)
        self.assertEqual(len(items), 90)
        self.assertEqual(items[1][-1], 512)
        self.assertEqual(stats["completion_reason"], "preview_limit")

    def test_fractional_rate_vfr_and_nonzero_start(self):
        items, stats = [], {}
        meta = dict(META, time_base=Fraction(1, 1000), rate=Fraction(25))
        pts = [20000, 20040, 20120, 21000, 22999, 23000]
        with patch.object(P, "iter_source_frames", return_value=(frame(x, Fraction(1, 1000)) for x in pts)):
            P.prepare_video_frames(Path("x"), meta, GPU, 128, 64, 3.0, None,
                jobs.JobController(), threading.Event(), lambda item: items.append(item) or True, stats)
        self.assertEqual([x[-1] for x in items], pts[:-1])

    def test_preview_closes_decoder_early(self):
        closed, stats = [], {}
        def frames(*args):
            try:
                for i in range(100): yield frame(i * 512)
            finally: closed.append(True)
        with patch.object(P, "iter_source_frames", side_effect=frames):
            P.prepare_video_frames(Path("x"), META, GPU, 128, 64, None, 1,
                jobs.JobController(), threading.Event(), lambda item: True, stats)
        self.assertEqual(closed, [True])
        self.assertEqual(stats["decoded_frames"], 1)

    def test_rotation_applied_once_after_decode(self):
        items, stats = [], {}
        runtime.resize_fit.reset_mock()
        with patch.object(P, "iter_source_frames", return_value=(item for item in [frame()])):
            P.prepare_video_frames(Path("x"), dict(META, rotation=90), GPU, 64, 128, None, None,
                jobs.JobController(), threading.Event(), lambda item: items.append(item) or True, stats)
        self.assertEqual(items[0][1].shape, (128, 64, 4))
        runtime.resize_fit.assert_not_called()

    def test_performance_labels_overlap_and_native_affinity(self):
        result = P.performance_report({"dlss_seconds": 17}, {"decoder": {"read_seconds": 2}}, {}, 90, 26, "h264_nvenc")
        self.assertTrue(result["stages_overlap"])
        self.assertFalse(result["native_adapter_verified"])
        self.assertAlmostEqual(result["end_to_end_fps"], 90 / 26)
        self.assertEqual(result["seconds"]["native_roundtrip"], 17)

    def test_status_tolerates_missing_report(self):
        self.assertIn("Diagnostic report", P.performance_status("/missing/report.json"))


class WatchdogTests(unittest.TestCase):
    def session(self, timeout=0.15):
        return D.FFmpegDecodeSession([sys.executable, "-c", "import time; time.sleep(20)"],
                                    jobs.JobController(), threading.Event(), timeout=timeout)

    @staticmethod
    def blocked_open(stream, **kwargs):
        stream.read(1)
        raise RuntimeError("pipe closed")

    def test_read_stall_kills_child_and_unregisters(self):
        s = self.session()
        with patch.dict(sys.modules, {"av": types.SimpleNamespace(open=self.blocked_open)}):
            with self.assertRaisesRegex(RuntimeError, "no read progress"):
                list(s.frames())
        self.assertIsNotNone(s.process.poll())
        self.assertEqual(s.controller._processes, [])
        self.assertTrue(s.closed)

    def test_cancel_releases_a_blocked_read(self):
        s = self.session(timeout=5)
        timer = threading.Timer(0.15, s.controller.cancel.set)
        timer.start()
        try:
            with patch.dict(sys.modules, {"av": types.SimpleNamespace(open=self.blocked_open)}):
                with self.assertRaises(jobs.Cancelled): list(s.frames())
        finally:
            timer.cancel()
        self.assertEqual(s.controller._processes, [])

    def test_downstream_backpressure_is_not_a_decode_timeout(self):
        s = self.session()
        fake = Mock()
        fake.streams.video = [Mock()]
        fake.decode.return_value = iter([frame(), frame(512)])
        with patch.dict(sys.modules, {"av": types.SimpleNamespace(open=lambda *a, **k: fake)}):
            iterator = s.frames()
            next(iterator)
            time.sleep(0.35)
            self.assertFalse(s.timed_out)
            self.assertIsNone(s.process.poll())
            iterator.close()
        self.assertTrue(s.closed)
        self.assertEqual(s.controller._processes, [])


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "Local FFmpeg/ffprobe not installed")
class NutTransportIntegrationTests(unittest.TestCase):
    def run_transport(self, vf=None, rate="30", rotated=False):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source = root / "source with spaces.mp4"
            cmd = [shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i",
                   f"testsrc2=size=128x64:rate={rate}:duration=0.5"]
            if vf: cmd += ["-vf", vf]
            cmd += ["-fps_mode", "passthrough", "-c:v", "libx264", "-threads", "1", "-y", str(source)]
            subprocess.run(cmd, check=True, capture_output=True, timeout=15)
            if rotated:
                other = root / "rotated.mp4"
                subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-i", str(source), "-c", "copy", "-metadata:s:v:0", "rotate=90", str(other)], check=True, capture_output=True, timeout=15)
                source = other
            def probe(path):
                return json.loads(subprocess.run([shutil.which("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_streams", "-show_frames", "-of", "json", str(path)], check=True, capture_output=True, timeout=15).stdout)
            original = probe(source)
            tb = Fraction(original["streams"][0]["time_base"])
            meta = dict(META, time_base=tb)
            cmd = D.build_decode_command(source, meta, None, executable=Path(shutil.which("ffmpeg")), cuda=False)
            output = root / "decoded.nut"
            with output.open("wb") as stream:
                subprocess.run(cmd, stdout=stream, stderr=subprocess.PIPE, check=True, timeout=15)
            decoded = probe(output)
            dtb = Fraction(decoded["streams"][0]["time_base"])
            self.assertEqual(len(decoded["frames"]), len(original["frames"]))
            self.assertEqual((decoded["streams"][0]["width"], decoded["streams"][0]["height"]), (128, 64))
            self.assertEqual(decoded["streams"][0]["pix_fmt"], "rgba")
            a = [Fraction(x["pts"]) * tb for x in original["frames"]]
            b = [Fraction(x["pts"]) * dtb for x in decoded["frames"]]
            self.assertEqual(a, b)

    @unittest.skipUnless(importlib.util.find_spec("av"), "PyAV not installed in this test environment")
    def test_actual_pyav_bridge_with_software_ffmpeg(self):
        # Same NUT consumer used by CUDA, but no GPU is needed for this case.
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "input.mp4"
            subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i",
                "testsrc2=size=128x64:rate=30:duration=0.5", "-c:v", "libx264", "-threads", "1", str(source)],
                check=True, capture_output=True, timeout=15)
            command = D.build_decode_command(source, META, None,
                executable=Path(shutil.which("ffmpeg")), cuda=False)
            controller = jobs.JobController()
            session = D.FFmpegDecodeSession(command, controller, threading.Event())
            frames = list(session.frames())
            self.assertEqual(len(frames), 15)
            self.assertEqual([D.source_pts(item, i, META) for i, item in enumerate(frames)],
                             [512 * i for i in range(15)])
            self.assertEqual(frames[0].to_ndarray(format="rgba").shape, (64, 128, 4))
            self.assertEqual(controller._processes, [])

    def test_cfr_transport(self): self.run_transport()
    def test_fractional_rate_transport(self): self.run_transport(rate="30000/1001")
    def test_vfr_transport(self): self.run_transport(vf="select='not(eq(mod(n,3),1))'")
    def test_nonzero_start_transport(self): self.run_transport(vf="setpts=PTS+2/TB")
    def test_no_autorotation_transport(self): self.run_transport(rotated=True)


if __name__ == "__main__":
    unittest.main()
