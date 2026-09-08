# Live UI and 3D Viewer compatibility fix

This update addresses two runtime issues reported against the bundled portable Gradio build:

- `File.__init__() got an unexpected keyword argument 'info'` in the 3D Viewer.
- `'float' object has no attribute 'is_set'` from Timer-driven Live/Realtime UI polling.

## 3D Viewer

The uploader no longer relies on newer `gr.File` constructor keywords. It is built with progressively simpler argument sets and model extension validation remains in the application. Pressing **Load Model** sends the resulting model path directly to the actual `Model3D` viewport. Native viewer formats remain OBJ, GLB, GLTF, STL, PLY and SPLAT. Other accepted DCC/interchange formats are normalized to GLB through the existing Blender/trimesh conversion path when available.

## Live and Realtime

Gradio Timer polling has been removed from both tabs for compatibility with the portable UI runtime. Each tab now has a manual **Refresh Status** button.

More importantly, both tabs now include a real in-app enhanced preview surface. A local loopback MJPEG server receives only frames returned by the signed `DLSSFrameSession.process()` call. JPEG conversion runs on a separate bounded latest-frame thread, so a slow browser cannot back-pressure DLSS processing. The browser viewport therefore displays post-DLSS feature-18 frames while the existing MPV/HLS audio/playback path remains unchanged.

The preview bridge is installed once, uses thread-local routing so offline renders are unaffected, and is shut down with its Live/Realtime session.
