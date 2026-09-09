# TypeScript primary UI

The React/TypeScript application in `dlss5-visual-enhancer_myversion_typescript/` is the primary user interface. The previous Gradio UI is retained only as a recovery/legacy frontend.

## Architecture

The browser is **not** a replacement for NVIDIA's native runtime. It is the presentation and control layer:

```text
React / TypeScript UI
        |
        |  JSON + multipart on 127.0.0.1
        v
src.typescript_api.server (FastAPI)
        |
        +-- existing settings + preset validation
        +-- image/video Neural Rendering batches
        +-- RTX Video VSR/HDR image/video batches
        +-- DLSS Frame Generation / Cascade batches
        +-- unified Realtime / Buffered Live backend
        +-- persistent Blender-backed DLSS 5 Live 3D
        |
        v
existing Python/native NVIDIA workers + FFmpeg + MPV + Blender
```

The production UI is served by the Python API host on `http://127.0.0.1:8765/`. Node.js is required to install/type-check/build the frontend; it is **not** required during normal playback/rendering after `dist/` has been produced.

The server binds to loopback only. Vite development mode also binds to `127.0.0.1` and proxies `/api` to port 8765.

## Real runtime controls

The TypeScript app loads its choices from `/api/bootstrap` instead of maintaining a second hard-coded DLSS model list. The response comes from the Python runtime and includes:

- detected RTX GPU UUIDs, PCI identity and CUDA ordinal mapping;
- Neural Rendering presets: `Default`, `Preset #1`, `Preset #2`, `Preset #3`;
- NR styles: `Default`, `Natural`, `Cinematic`;
- DLSS Model Presets: `Default`, `J`, `K`, `L`, `M`;
- DLSS scaling modes: DLAA/native, Quality, Balanced, Performance and Ultra Performance;
- actual video codecs, containers, quality modes and Preview Encoding values;
- RTX Video VSR quality, sizing and HDR controls;
- actual Frame Interpolation target FPS and engine choices;
- Live source quality, processing height, cadence and motion-guide choices;
- 3D conversion capabilities and Live 3D render resolutions.

This removes the previous TypeScript prototype's simulated GPUs, invented architecture choices, made-up NR styles/model presets and timer-based fake rendering.

## Processing tabs

### Neural Rendering

Image and Video jobs call the existing signed feature-18 pipeline. Image format/quality/naming and Video codec/container/quality/HDR/naming are mapped into the same option dataclasses used by the Python UI. Video can run a three-second preview without changing the full render settings.

### Upscale

Image mode uses the RTX Video Super Resolution image worker. Video mode exposes VSR, 1x/1.5x/2x/3x/4x sizing, custom dimensions/aspect lock, RTX Video HDR controls, HDR precision, codec/container/quality and naming.

### Frame Interpolation

Uses the existing `FrameInterpolationOptions` and DLSSG/Cascade pipeline. It exposes the runtime's target frame-rate grid, engine, codec/container/quality, HDR and naming options.

### Live

The separate Realtime/Live parameter surfaces remain merged into one TypeScript tab. `Realtime` uses the low-latency direct backend; `Buffered` uses HLS/MPV. Both share one source and one set of Neural Rendering controls.

The embedded player is the existing post-feature-18 loopback player, so it receives frames only after `DLSSFrameSession.process()` returns. Its dynamic aspect ratio, rolling history bar, play/pause, Go Live, Snapshot, Fullscreen and pop-out controls remain intact.

### 3D Viewer

Model files are uploaded as one bundle so OBJ/GLTF dependency paths remain together. Existing conversion logic normalizes supported formats for the viewer. Live 3D keeps one Blender scene loaded, renders camera changes to an in-memory RGBA buffer, generates temporal motion guides and runs signed feature 18 before the enhanced frame enters the interactive viewport.

This is not described as a game-engine zero-copy swapchain: the current native worker still accepts/returns host RGBA and motion buffers.

## Settings and presets

The TypeScript settings screen reads/writes the same `config/config.ini` data through `src.settings.models.UISettings` and `_validate()`. It does not maintain a competing config format.

Preset Import/Export uses the existing versioned `dlss5-visual-enhancer-settings-preset` JSON schema and the existing Python migration/validation code. Presets therefore remain compatible between the TypeScript UI and legacy Python UI.

## Launchers

### Main UI

```bat
start.bat
```

or directly:

```bat
run_typescript_ui.bat
```

### RTX 4090 profile + TypeScript UI

```bat
start_4090.bat
```

With no arguments this applies the balanced 4090 best-settings profile and launches the TypeScript primary UI. Existing profile commands are still available, for example:

```bat
start_4090.bat --diagnose
start_4090.bat --restore
```

### Legacy Python UI

```bat
start_python_legacy.bat
```

or with the 4090 profile:

```bat
start_4090_python_legacy.bat
```

## TypeScript-only installer/update

For an existing portable runtime:

```bat
install_typescript_ui.bat
```

The installer:

1. validates the packaged Python/FastAPI backend;
2. uses a suitable system Node.js installation or downloads the current Windows x64 Node LTS ZIP;
3. verifies the downloaded Node archive against Node.js's official `SHASUMS256.txt`;
4. keeps npm cache under this application folder rather than the user's normal npm cache;
5. runs `npm install`, TypeScript type-checking and the Vite production build;
6. verifies `dist/index.html`;
7. launches the TypeScript UI.

## Clean RTX 4090 install

`install_clean_4090.bat` now creates the complete TypeScript build in staging. The existing portable install is not moved until all of the following have succeeded:

- v7 runtime download;
- v7 SHA-256 verification;
- native/runtime layout verification;
- source overlay;
- RTX 4090 profile setup;
- Python TypeScript-backend import check;
- Node verification/download;
- npm install;
- TypeScript type-check;
- Vite production build;
- final TypeScript/native layout verification.

Only then is an existing target renamed to a timestamped backup and the staged build moved into its place.
