# Unified Live and DLSS 5 Live 3D

## Unified Live tab

The former Live and Realtime tabs now share one **Live** UI. The Playback mode selector chooses the existing backend without duplicating source, Neural Rendering, model-preset, source-quality, input-size, frame-rate, or motion-guide controls.

- **Realtime (lowest latency):** direct post-feature-18 transport to MPV; no HLS output encode before display.
- **Buffered (HLS + larger buffer):** the existing HLS/NVENC path with optional external MPV. Segment length, buffer length, and external-MPV launch are the only buffered-only controls.

The post-DLSS browser player derives its stage aspect ratio from the actual enhanced frame dimensions instead of forcing 16:9. Because DLSS output preserves the selected source/render aspect ratio, portrait, square, ultrawide, and standard landscape inputs are displayed without stretching.

The browser player now includes a Windows-media-player-style transport bar. It stores only a bounded rolling history of recent enhanced JPEG preview frames (30 seconds, also bounded by frame count and memory), so pause/review/scrubbing cannot back-pressure the DLSS worker. The main Realtime/Buffered playback pipelines remain authoritative; the in-app review buffer is a monitor, not a replacement encoded media file. Audio continues through the existing MPV/HLS path.

## DLSS 5 Live 3D

The old one-shot camera-image overlay UI is removed from the 3D Viewer. The main output is now an interactive **DLSS 5 Live 3D Viewer**.

Pipeline:

`persistent Blender scene -> in-memory RGBA camera frame -> temporal motion guides -> signed feature 18 -> live interactive browser viewport`

The model is loaded once into a persistent Blender background process. Orbit/pan/zoom gestures in the enhanced browser viewport send camera state to that process over loopback TCP. Blender renders the requested view to its in-memory Render Result; no PNG/JPEG source frame is written as the processing input. The raw RGBA buffer is sent to the existing signed Neural Rendering worker, and the resulting enhanced frame is streamed back to the viewer.

Controls in the enhanced 3D viewport:

- left drag: orbit
- right-drag or Shift-drag: pan
- mouse wheel: zoom
- reset view
- freeze/resume monitor
- snapshot
- fullscreen and pop-out

The normal Gradio Model3D viewport remains in a collapsed section as an **unprocessed source-geometry reference**, not the DLSS result.

## Important native limitation

This is live/interactively updated DLSS 5 rendering, but it is not a game-engine zero-copy D3D12 swapchain. The repository's current signed feature-18 worker accepts host RGBA/motion buffers and returns host RGBA, so native texture-in/texture-out presentation would require native worker/interface changes. Native DLSS adapter binding also remains unverified by this Python layer.

Blender is required for the live 3D render stage. Meshes that the existing model loader converts to GLB can use this path. SPLAT remains available in the source Model3D viewer unless a compatible Blender splat importer/converter is installed.
