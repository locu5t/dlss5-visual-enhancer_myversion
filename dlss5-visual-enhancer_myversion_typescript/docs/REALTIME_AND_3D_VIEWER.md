# Realtime DLSS playback and 3D Model Viewer

## Realtime tab

The new **Realtime** tab is separate from the existing buffered **Live** tab.

The buffered Live path intentionally encodes HLS segments and waits for a
playback buffer. Realtime instead uses:

`source -> FFmpeg raw RGBA/PCM -> motion guides -> signed DLSS feature 18 -> raw NUT -> MPV`

There is no HLS segment wait and no output video re-encode. The MPV window is
started before the first enhanced frame is returned and consumes the processed
RGBA + PCM stream directly from a pipe.

This is the closest low-latency path possible with the native worker interface
currently present in this repository. It is **not** the same as an in-engine
DLSS swapchain: the signed feature-18 worker still accepts host-memory RGBA and
motion buffers and returns host-memory RGBA. A genuine game-engine path would
keep D3D12 textures GPU-resident and present them directly from a native render
loop. That requires native worker source/interface changes.

Realtime retains:
- local videos, direct network streams, YouTube and Twitch resolution through
  the existing source resolver;
- automatic source-frame sampling when processing cannot sustain source FPS;
- Fast/Quality motion guides;
- all Neural Rendering controls and DLSS model preset;
- signed feature-18 verification;
- source/audio timestamps and MPV A/V sync diagnostics.

The output is playback-only. Use Neural Rendering / Live when a saved video or
buffered HLS endpoint is required.

## 3D Viewer tab

The **3D Viewer** uses Gradio Model3D for the interactive orbit/pan/zoom
viewport. Its default formats are supported directly:

- `.obj`
- `.glb`
- `.gltf`
- `.stl`
- `.ply`
- `.splat`

The upload control also accepts common interchange/DCC/CAD files:

`.fbx .dae .3ds .blend .abc .usd .usda .usdc .usdz .x3d .wrl .3mf .amf
.off .vtk .vtp .pcd .xyz .vox .lwo .lwob .lws .md2`

Those non-native files are converted to GLB when an available local backend can
read them. The converter tries `trimesh` first, then Blender. Blender is detected
from `BLENDER_EXE`, PATH, or normal Windows Program Files locations and is
started with `--disable-autoexec`.

A format being accepted by the upload control does not mean every optional
converter build can import every variant of that format. The status panel
reports whether the model was loaded directly, converted, or which conversion
backend is missing.

For OBJ/GLTF assets with MTL/BIN/texture companions, upload all companion files
together. The viewer tries to pack the bundle to a self-contained GLB when a
converter is available.

Converted files are stored under `outputs/model_viewer` so they are already
within the application's allowed Gradio output path. Cache directories older
than 24 hours are removed on application startup.

## Security / file behavior

3D files are data, not trusted code. Blender conversion disables embedded
auto-execution. The converter never invokes a shell command with model-derived
text and never executes scripts contained in a model file.

## Validation

The new Python modules were syntax-compiled before publishing. Core model-file
selection and filename sanitization were also exercised locally without
requiring Blender, trimesh, Gradio, an RTX GPU, or the native DLLs.

Realtime D3D12/DLSS execution and MPV low-latency playback still need validation
on the Windows portable runtime. The status panel reports the requested AI GPU;
native feature-18 adapter binding is not independently proven by this source
tree.
