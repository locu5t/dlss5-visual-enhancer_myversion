from __future__ import annotations

import threading
import unittest
from pathlib import Path

from src.typescript_api.job_manager import JobState


ROOT = Path(__file__).resolve().parents[1]


class TypeScriptMainUiTests(unittest.TestCase):
    def text(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_default_launcher_is_typescript_and_legacy_python_is_explicit(self):
        start = self.text("start.bat")
        self.assertIn("run_typescript_ui.bat", start)
        self.assertNotIn('"%~dp0app.py"', start)
        legacy = self.text("start_python_legacy.bat")
        self.assertIn("app.py", legacy)

    def test_production_app_uses_runtime_backed_tabs_not_mock_render_pipeline(self):
        app = self.text("dlss5-visual-enhancer_myversion_typescript/src/App.tsx")
        for component in (
            "NeuralRuntimeTab", "UpscaleRuntimeTab", "FrameRuntimeTab",
            "LiveRuntimeTab", "ModelRuntimeTab", "SettingsRuntimeTab",
        ):
            self.assertIn(component, app)
        self.assertIn("backend.bootstrap()", app)
        self.assertNotIn("INITIAL_BATCH_ITEMS", app)
        self.assertNotIn("handleStartJob", app)

    def test_typescript_defaults_do_not_invent_gpu_hardware(self):
        defaults = self.text("dlss5-visual-enhancer_myversion_typescript/src/data/defaults.ts")
        self.assertIn("Automatic (best compatible RTX)", defaults)
        self.assertNotIn("5090", defaults)
        self.assertNotIn("3090", defaults)
        self.assertNotIn("Blackwell Simulation", defaults)

    def test_bridge_uses_real_native_pipeline_entry_points(self):
        bridge = self.text("src/typescript_api/bridge.py")
        for symbol in (
            "convert_images", "convert_videos", "upscale_images", "upscale_videos",
            "interpolate_videos", "start_realtime_session", "start_live_session",
            "start_model_live", "preset_document", "import_settings_preset",
        ):
            self.assertIn(symbol, bridge)
        self.assertIn("DLSS_MODEL_PRESETS", bridge)
        self.assertIn("UPSCALING_MODES", bridge)

    def test_job_json_does_not_copy_thread_locks(self):
        job = JobState("test", "neural-image")
        self.assertTrue(hasattr(job.controller.cancel, "is_set"))
        data = job.public()
        self.assertNotIn("controller", data)
        self.assertEqual(data["id"], "test")
        self.assertEqual(data["kind"], "neural-image")

    def test_model_upload_bundle_keeps_companion_files_together(self):
        server = self.text("src/typescript_api/server.py")
        self.assertIn("def _save_upload_group", server)
        self.assertIn('return prepare_model(_save_upload_group(files, "models"))', server)
        self.assertIn("OBJ/GLTF references are relative", server)

    def test_installer_verifies_node_and_builds_before_target_swap(self):
        installer = self.text("tools/install_typescript_ui.ps1")
        self.assertIn("SHASUMS256.txt", installer)
        self.assertIn("Get-FileHash", installer)
        self.assertIn("npm run build", installer)
        clean = self.text("tools/install_clean_4090.ps1")
        build_position = clean.index("Installing and building TypeScript primary UI")
        move_position = clean.index("Installing atomically to")
        self.assertLess(build_position, move_position)
        self.assertIn("-RequireTypeScriptBuild", clean)

    def test_typescript_server_binds_loopback_by_default(self):
        server = self.text("src/typescript_api/server.py")
        self.assertIn('parser.add_argument("--host", default="127.0.0.1")', server)
        vite = self.text("dlss5-visual-enhancer_myversion_typescript/vite.config.ts")
        self.assertIn("host: '127.0.0.1'", vite)


if __name__ == "__main__":
    unittest.main()
