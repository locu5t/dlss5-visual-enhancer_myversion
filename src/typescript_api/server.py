from __future__ import annotations

import argparse
import json
import mimetypes
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from ..core.paths import JOBS, LOGS, OUTPUTS, ROOT
from ..live.browser_preview import install_browser_preview
from .bridge import (
    bootstrap_payload,
    export_preset_payload,
    import_preset_path,
    live_status_payload,
    model_live_status_payload,
    persist_frontend_settings,
    prepare_model,
    render_job,
    save_uploaded_file,
    start_live,
    start_model_live_bridge,
    stop_live,
    stop_model_live_bridge,
)
from .job_manager import cancel_job, get_job, prune_jobs, start_job, update


TS_ROOT = ROOT / "dlss5-visual-enhancer_myversion_typescript"
DIST = TS_ROOT / "dist"

app = FastAPI(title="DLSS 5 Visual Enhancer TypeScript API", version="1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:8765",
        "http://localhost:8765",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=str(DIST / "assets")), name="assets")


@app.on_event("startup")
def _startup() -> None:
    OUTPUTS.mkdir(exist_ok=True)
    LOGS.mkdir(exist_ok=True)
    JOBS.mkdir(exist_ok=True)
    install_browser_preview()
    prune_jobs()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "ui": "typescript",
        "distReady": (DIST / "index.html").is_file(),
        "root": str(ROOT),
    }


@app.get("/api/bootstrap")
def bootstrap() -> dict[str, Any]:
    try:
        return bootstrap_payload()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@app.put("/api/settings")
def save_settings(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        return {"settings": persist_frontend_settings(payload)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{type(exc).__name__}: {exc}") from exc


@app.post("/api/presets/export")
def export_preset(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        name = str(payload.get("name") or "DLSS5 Preset")
        settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
        return export_preset_payload(name, settings)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{type(exc).__name__}: {exc}") from exc


@app.post("/api/presets/import")
def import_preset(file: UploadFile = File(...)) -> dict[str, Any]:
    try:
        path = save_uploaded_file(file.filename or "preset.json", file.file, group="presets")
        return import_preset_path(path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{type(exc).__name__}: {exc}") from exc


@app.post("/api/jobs/{kind}")
def create_render_job(
    kind: str,
    files: list[UploadFile] = File(...),
    settings_json: str = Form("{}"),
    preview_seconds: float | None = Form(None),
    preview_frames: int | None = Form(None),
) -> dict[str, Any]:
    allowed = {"neural-image", "neural-video", "upscale-image", "upscale-video", "frame-interpolation"}
    if kind not in allowed:
        raise HTTPException(status_code=404, detail=f"Unknown render kind: {kind}")
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one input file.")
    try:
        settings = json.loads(settings_json or "{}")
        if not isinstance(settings, dict):
            raise ValueError("settings_json must contain a JSON object.")
        stored = [save_uploaded_file(item.filename or "input.bin", item.file, group=kind) for item in files]

        def runner(job):
            def progress(value: float, message: str) -> None:
                update(job, progress=value, message=message)
            return render_job(
                kind,
                stored,
                settings,
                controller=job.controller,
                progress=progress,
                preview_seconds=preview_seconds,
                preview_frames=preview_frames,
            )

        job = start_job(kind, runner)
        return job.public()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{type(exc).__name__}: {exc}") from exc


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job.")
    return job.public()


@app.post("/api/jobs/{job_id}/cancel")
def cancel(job_id: str) -> dict[str, Any]:
    try:
        return cancel_job(job_id).public()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Unknown job.") from exc


def _safe_runtime_file(raw: str) -> Path:
    try:
        candidate = Path(raw).resolve()
    except (TypeError, ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Invalid file path.") from exc
    roots = [ROOT.resolve(), OUTPUTS.resolve(), LOGS.resolve(), JOBS.resolve()]
    if not any(candidate == root or root in candidate.parents for root in roots):
        raise HTTPException(status_code=403, detail="That file is outside the DLSS 5 application directories.")
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="File does not exist.")
    return candidate


@app.get("/api/file")
def runtime_file(path: str) -> FileResponse:
    candidate = _safe_runtime_file(path)
    return FileResponse(
        candidate,
        filename=candidate.name,
        media_type=mimetypes.guess_type(candidate.name)[0] or "application/octet-stream",
    )


@app.post("/api/live/start")
def live_start(
    settings_json: str = Form("{}"),
    online_source: str = Form(""),
    file: UploadFile | None = File(None),
) -> dict[str, Any]:
    try:
        settings = json.loads(settings_json or "{}")
        if not isinstance(settings, dict):
            raise ValueError("settings_json must contain a JSON object.")
        if file is not None and file.filename:
            source = str(save_uploaded_file(file.filename, file.file, group="live"))
        else:
            source = online_source.strip()
        if not source:
            raise ValueError("Choose a local video or enter an online stream URL.")
        return start_live(settings, source)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{type(exc).__name__}: {exc}") from exc


@app.get("/api/live/status")
def live_status() -> dict[str, Any]:
    return live_status_payload()


@app.post("/api/live/stop")
def live_stop() -> dict[str, Any]:
    return stop_live()


@app.post("/api/model/prepare")
def model_prepare(files: list[UploadFile] = File(...)) -> dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail="Choose a 3D model file.")
    try:
        stored = [save_uploaded_file(item.filename or "model.bin", item.file, group="models") for item in files]
        return prepare_model(stored)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{type(exc).__name__}: {exc}") from exc


@app.post("/api/model/live/start")
def model_live_start(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        model_path = str(payload.get("modelPath") or "")
        settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
        if not model_path:
            raise ValueError("Prepare a 3D model before starting DLSS 5 Live 3D.")
        return start_model_live_bridge(settings, model_path)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{type(exc).__name__}: {exc}") from exc


@app.get("/api/model/live/status")
def model_status() -> dict[str, Any]:
    return model_live_status_payload()


@app.post("/api/model/live/stop")
def model_stop() -> dict[str, Any]:
    return stop_model_live_bridge()


@app.get("/{path:path}", response_class=HTMLResponse)
def static_app(path: str) -> HTMLResponse | FileResponse:
    index = DIST / "index.html"
    if not index.is_file():
        return HTMLResponse(
            """<!doctype html><html><body style='background:#0b0f17;color:#e5e7eb;font-family:Segoe UI;padding:32px'>
            <h2>DLSS 5 TypeScript UI is not built yet</h2>
            <p>Run <code>install_typescript_ui.bat</code>, then launch <code>run_typescript_ui.bat</code>.</p>
            </body></html>""",
            status_code=503,
        )
    requested = (DIST / path).resolve() if path else index.resolve()
    dist_root = DIST.resolve()
    if requested.is_file() and (requested == dist_root or dist_root in requested.parents):
        return FileResponse(requested)
    return FileResponse(index)


def _open_browser(url: str) -> None:
    time.sleep(1.25)
    try:
        webbrowser.open(url, new=1)
    except Exception:
        pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Serve the TypeScript UI and local DLSS runtime API.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)
    url = f"http://{args.host}:{args.port}/"
    if not args.no_browser:
        threading.Thread(target=_open_browser, args=(url,), daemon=True).start()
    print(f"DLSS 5 TypeScript UI: {url}", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
