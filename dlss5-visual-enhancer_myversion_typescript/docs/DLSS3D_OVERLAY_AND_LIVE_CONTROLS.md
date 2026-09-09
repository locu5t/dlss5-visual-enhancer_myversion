# DLSS 5 3D Overlay and Live Viewport Controls

## 3D Viewer

The 3D Viewer now exposes the same Neural Rendering controls used by the image/video paths: NR preset/style/intensity, local tone/structure, skin structure, upscaling factor, automatic mask and DLSS model preset.

The interactive `Model3D` viewport itself remains the browser WebGL orbit/pan/zoom surface. The bundled signed feature-18 worker does not accept that browser GPU texture directly, so the app does **not** pretend a CSS/WebGL filter is DLSS.

Instead, **Render DLSS 5 Overlay** performs a real pipeline:

1. render the loaded model from a selectable camera with local Blender;
2. send that PNG through the existing signed Neural Rendering image pipeline;
3. show the source camera render, the signed DLSS 5 result and a user-controlled blend/overlay composite.

The overlay uses the selected AI Processing GPU and writes its normal feature-18 diagnostic report. Camera choices are Three-quarter, Front, Right and Top. Base render choices are 720p and 1080p; the selected DLSS upscaling factor controls the final feature-18 output size.

Mesh overlays support GLB/GLTF/OBJ/STL/PLY directly after the viewer conversion stage. Other DCC formats continue to normalize to GLB through the existing Blender/trimesh loader. SPLAT remains interactive-only unless a local splat import/conversion plug-in is installed.

Set `BLENDER_EXE` if Blender is not installed in a normal Windows Program Files location.

## Live and Realtime

The in-app post-DLSS viewport is now a real controlled viewer served from the same loopback preview bridge. The browser window has:

- Pause / Play
- Go Live (reconnect to the newest post-DLSS frames)
- Snapshot
- Fullscreen
- Pop-out full player
- double-click fullscreen
- Space to pause/play and `F` for fullscreen

The visual stream is still fed only after `DLSSFrameSession.process()` returns. Pausing the browser viewer pauses only the monitor; it never blocks or pauses the DLSS worker. The latest-frame JPEG queue remains bounded to one frame, so browser rendering cannot create DLSS pipeline backpressure.

This is a live monitor, not a rewind buffer. Historical seeking would require storing/encoding a timeline separately and is intentionally not mislabeled as zero-latency playback.
