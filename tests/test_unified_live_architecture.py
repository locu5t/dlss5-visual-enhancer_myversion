from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class UnifiedLiveArchitectureTests(unittest.TestCase):
    def text(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_realtime_is_not_a_separate_top_level_tab(self):
        app = self.text("app.py")
        self.assertNotIn('gr.Tab("Realtime"', app)
        self.assertIn('gr.Tab("Live"', app)
        self.assertIn("build_model_viewer_tab(settings)", app)

    def test_live_ui_has_one_shared_parameter_surface(self):
        source = self.text("src/live/ui.py")
        self.assertIn("MODE_REALTIME", source)
        self.assertIn("MODE_BUFFERED", source)
        self.assertIn("start_realtime_session", source)
        self.assertIn("start_live_session", source)
        self.assertEqual(source.count("build_neural_controls(settings)"), 1)

    def test_live_start_bypasses_portable_gradio_queue(self):
        source = self.text("src/live/ui.py")
        self.assertIn("start.click(", source)
        self.assertIn("queue=False", source)
        self.assertNotIn("concurrency_limit=1", source)
        self.assertIn("live_ui_error.log", source)

    def test_live_player_uses_runtime_aspect_and_transport_bar(self):
        source = self.text("src/live/browser_preview.py")
        self.assertIn("meta.width", source)
        self.assertIn("meta.height", source)
        self.assertIn('id=\"timeline\"', source)
        self.assertIn("history_seconds", source)
        self.assertIn("showPosition", source)

    def test_3d_viewer_uses_persistent_live_dlss_not_static_overlay(self):
        ui = self.text("src/model_viewer/ui.py")
        live = self.text("src/model_viewer/live_dlss.py")
        self.assertIn("Start DLSS 5 Live 3D", ui)
        self.assertNotIn("Render DLSS 5 Overlay", ui)
        self.assertIn("BlenderViewportWorker", live)
        self.assertIn("pixels.foreach_get", live)
        self.assertIn("DLSSFrameSession", live)
        self.assertNotIn("write_still=True", live)

    def test_3d_upload_becomes_active_model_without_second_click(self):
        ui = self.text("src/model_viewer/ui.py")
        self.assertIn("_extract_file_paths", ui)
        self.assertIn("_prepare_uploaded_model", ui)
        self.assertIn('change = getattr(files, "change", None)', ui)
        self.assertIn("uploaded_files", ui)
        self.assertIn("outputs=[status, live_viewer, current_path]", ui)
        self.assertIn("queue=False", ui)


if __name__ == "__main__":
    unittest.main()
