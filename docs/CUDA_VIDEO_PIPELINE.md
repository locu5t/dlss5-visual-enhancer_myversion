# CUDA decoding and NVENC Neural Rendering previews

## Why this update

The reported 90-frame, 3-second preview took 26 seconds at 704x1232 ->
2112x3696. That is about 3.46 output fps including startup/encoding, not a
measurement of DLSS GPU kernel throughput. The output has 7,805,952 pixels per
frame (nine times the input pixel count).

The previous browser-preview policy converted an H.265/AV1 NVENC request to
plain H.264. In this application plain H.264 means CPU libx264, preset slow.
The NR processor also forced CPU GPU-resolution logic for compatibility
previews. Thus the saved NVENC selection could be lost specifically in previews.
This is a code-path finding, not proof of how the user's 26 seconds were split.

## Implemented

- NR compatibility previews of an NVENC request now use H.264 NVENC / MP4 and
  pass the selected video's verified CUDA device to the existing encoder.
  Explicit CPU choices stay CPU; Preview Encoding Disabled retains the user's
  codec/container. A failed compatibility-preview NVENC capability probe falls
  back to CPU with a report warning before rendering. A failed explicit final
  NVENC render still errors. No mid-render encoder restart is added.
- NR video rendering (including its one-frame/three-second previews and batch
  calls) can use a persistent FFmpeg CUDA/NVDEC decoder on the selected AI GPU.
  One process streams a timestamped NUT container of RGBA frames through a pipe;
  there are no temporary frame images and no FFmpeg subprocess per frame.
- Frames are prepared alongside native DLSS processing and encoder feeding
  using the existing bounded queues. This update does not claim to introduce
  concurrency that the original producer/worker/writer pipeline already had.
- Input CUDA selection uses the verified PCI-to-CUDA mapping, not the Windows
  Task Manager index. CUDA visibility and monitor settings are not changed.
- Source PTS is rescaled from the pipe time base back to the source time base.
  VFR intervals/nonzero origins are retained; missing PTS uses frame rate rather
  than accidentally interpreting the frame index as timestamp ticks. Rotation
  is disabled in FFmpeg and applied once by the existing Python transform.
- Auto falls back to the original CPU decoder only before any CUDA frame is
  published. A midstream error aborts rather than replaying frames, duplicating
  output, or publishing a partial video. Cancel never triggers a retry. A
  watchdog kills/reaps a stuck decoder; it pauses its deadline while downstream
  DLSS/encoding is busy. Early preview cutoff closes the decoder process.
- New performance reports separate decoder reads/startup, color/rotation/resize,
  guides, native roundtrip, queue backpressure, active encoder feed, encoder
  drain, mux, and verification. The completion message shows key timings and
  the actual decoder/encoder. Stage totals overlap and must not be added.

## Activate

These changes target this fork's existing v7.0 portable runtime. Close the app.
Merge the PR into `locu5t/dlss5-visual-enhancer_myversion`, update the code, and
copy the changed source files into the *running portable installation* as well
if that is separate from the Git checkout. Replacing the changed source files
is enough: a clean reinstall/redownload of the runtime is not required.

Alternatively, extract the provided source patch into the portable application
folder containing `app.py`, `start_4090.bat`, and `bin/`, preserving relative
paths. Back up the three replaced files first. Do not replace settings, outputs,
or runtime binaries. Start normally with `start_4090.bat`.

CUDA decode policy is controlled by a process environment variable:

```powershell
# Default: try CUDA on eligible media, otherwise use the original CPU path.
$env:DLSS5_VIDEO_DECODE = 'auto'
.\start_4090.bat

# A/B comparison: close the app before restarting with the other decoder.
# Keep the same clip, encoder, scaling mode, effect settings and preview duration.
$env:DLSS5_VIDEO_DECODE = 'cpu'
.\start_4090.bat

# Strict diagnostic: require CUDA; unsupported inputs/devices fail explicitly.
$env:DLSS5_VIDEO_DECODE = 'cuda'
.\start_4090.bat
```

For the accelerated preview path, select an `(NVIDIA NVENC)` output codec and
Preview Encoding Auto or Always H.264. The preview should report encoder
`h264_nvenc`. CUDA success is reported as `FFmpeg CUDA/NVDEC`; a CPU fallback is
reported with its reason in the JSON. No standalone CUDA toolkit, Torch,
TensorRT, or additional model installation is introduced.

Auto currently enables CUDA only for 8-bit, 4:2:0, progressive/unknown-field-order
SDR H.264/HEVC/VP8/VP9/AV1, with limited/unknown range and common/unknown SDR
matrices. HDR, 10-bit, alpha, full-range, interlaced, and unusual color formats
retain the old decoder path. This gate avoids silently changing HDR/color
semantics. Driver/build capabilities are ultimately determined by FFmpeg.

## Limits and interpreting timings

DLSS feature 18 still runs sequentially inside the existing D3D12/native worker.
FFmpeg CUDA/NVDEC decodes video; it does not perform feature-18 evaluation.
`native_roundtrip` / `DLSS + transfers` includes host writes, native evaluation,
and readback. It is not a GPU-kernel-only measurement.

This path still uses `hwdownload` to supply the CPU buffers required by the
worker protocol. It is not zero-copy GPU-resident processing; CUDA decode can
be slower than CPU decode for some media due to startup and transfer costs.
Compare auto/cpu with identical settings and look at actual elapsed time.

A large native-roundtrip time cannot be removed merely by changing the decoder.
Removing those transfers or increasing native in-flight work requires changes
to the native worker/interface, whose source is absent here. Native NR adapter
binding remains unverified: the application now describes its GPU name as the
requested GPU rather than treating the Settings choice as execution proof.

There is no artificial 24 GB allocation, memory pooling, or change to DLSS model
strength, output resolution, frame count, frame order, or warmup settings.

## Validation

Local Linux/Python 3.13.5, FFmpeg 7.1.5: 40 tests collected, 39 passed, 1 skipped.
Five real software-FFmpeg NUT transport cases check CFR, fractional rate, VFR,
nonzero starts, and disabled autorotation, including timestamp equality, RGBA
format, dimensions and frame counts. Other tests isolate runtime/UI/encoder
policy dependencies, exercise source logic with fake frames, and use real child
processes for cancellation/watchdog checks. The direct PyAV/NUT bridge test was
skipped because PyAV is not installed in the test environment; it is included
for the packaged Windows Python, which already contains PyAV. Python syntax
checks passed for all six new/modified Python files.

No Windows 10 / RTX 4090 / actual NVDEC / actual NVENC / native DLSS speed or
visual-quality benchmark was run here. There is no claimed end-to-end speedup
until measured on the target machine. This is not a run of every repository test.

```powershell
.\bin\python-3.13.15-embed-amd64\python.exe -m unittest discover -s tests -p test_cuda_pipeline.py -v
```

The FFmpeg transport integration cases require ffmpeg/ffprobe on PATH; prepend
this installation's `bin\ffmpeg\bin` directory when running that test suite.

## References

- NVIDIA: https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html
- FFmpeg device selection, timestamps and hardware-transfer caveat: https://ffmpeg.org/ffmpeg.html
- FFmpeg hardware download/format constraints: https://ffmpeg.org/ffmpeg-filters.html
