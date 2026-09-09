export type TabId =
  | 'neural-rendering'
  | 'upscale'
  | 'frame-interpolation'
  | 'model-viewer'
  | 'settings'
  | 'live'
  | 'about';

// Runtime choices come from /api/bootstrap. Keep these aliases open so the
// TypeScript UI cannot drift out of sync when NVIDIA/runtime choices change.
export type NRPreset = string;
export type NRStyle = string;
export type DLSSModelPreset = string;
export type DLSSArchitecture = string;
export type CodecChoice = string;
export type ContainerChoice = string;
export type ImageFormatChoice = string;
export type PreviewEncodingChoice = string;
export type FrameRateChoice = string;
export type FrameEngineChoice = string;
export type MotionGuideChoice = 'Fast' | 'Quality';

export interface GPUInfo {
  id: string;
  uuid?: string;
  name: string;
  arch: string;
  vram: string;
  driver: string;
  index?: number | null;
  cudaOrdinal?: number | null;
  compatible?: boolean;
  compatibilityError?: string;
  pciBusId?: string;
  // Retained for compatibility with the original visual-only TS components.
  hags?: boolean;
  nvenc?: boolean;
  tensorCores?: number;
}

export interface UISettings {
  aiGpuId: string;
  videoGpuId: string;
  nrPreset: NRPreset;
  nrStyle: NRStyle;
  nrIntensity: number;
  localToneStrength: number;
  localStructureStrength: number;
  skinStructureStrength: number;
  upscalingFactor: number;
  automaticMask: boolean;
  dlssModelPreset: DLSSModelPreset;
  // Legacy display-only field. The current universal runtime does not expose a
  // user-selectable architecture control; the production UI does not render it.
  dlssArchitecture: DLSSArchitecture;

  codec: CodecChoice;
  container: ContainerChoice;
  quality: string;
  hdrMode: boolean;
  previewEncoding: PreviewEncodingChoice;
  videoRenameMode: string;
  videoCustomSuffix: string;

  imageFormat: ImageFormatChoice;
  imageQuality: number;
  imageRenameMode: string;
  imageCustomSuffix: string;

  upscaleMode: 'Image' | 'Video';
  upscaleImageVsrQuality: number;
  upscaleImageSizeMode: string;
  upscaleImageScaleFactor: number;
  upscaleImageWidth: number;
  upscaleImageHeight: number;
  upscaleImageAspectLock: boolean;
  upscaleImageOutputFormat: string;
  upscaleImageQuality: number;
  upscaleImagePreserveMetadata: boolean;
  upscaleImageRenameMode: string;
  upscaleImageCustomSuffix: string;

  upscaleVsrEnabled: boolean;
  upscaleVsrQuality: number;
  upscaleSizeMode: string;
  upscaleScaleFactor: number;
  upscaleWidth: number;
  upscaleHeight: number;
  upscaleAspectLock: boolean;
  upscaleHdrEnabled: boolean;
  upscaleHdrContrast: number;
  upscaleHdrSaturation: number;
  upscaleHdrMiddleGray: number;
  upscaleHdrPeakLuminance: number;
  upscaleHdrPrecision: string;
  upscaleCodec: CodecChoice;
  upscaleContainer: ContainerChoice;
  upscaleQuality: string;
  upscaleRenameMode: string;
  upscaleCustomSuffix: string;

  frameTargetFps: FrameRateChoice;
  frameEngine: FrameEngineChoice;
  frameMotionGuide: MotionGuideChoice;
  frameMultiplier: number;
  frameDuplicateRemoval: boolean;
  frameCodec: CodecChoice;
  frameContainer: ContainerChoice;
  frameQuality: string;
  frameHdrMode: boolean;
  frameRenameMode: string;
  frameCustomSuffix: string;

  livePlaybackMode: 'Realtime' | 'Buffered';
  liveSourceMode: 'Local' | 'Online';
  liveSourceQuality: string;
  liveMaxHeight: number;
  liveFpsMode: string;
  liveGuideQuality: MotionGuideChoice;
  liveSegmentSeconds: number;
  liveBufferSeconds: number;
  liveOpenMpv: boolean;
  modelLiveResolution: string;

  // Compatibility fields used by the original prototype components.
  liveSource: string;
  liveResolution: '480p' | '720p' | '1080p' | '1440p' | '4K';
  liveBufferMs: number;
}

export interface RuntimeChoices {
  nrPresets: string[];
  nrStyles: string[];
  dlssModelPresets: string[];
  dlssUpscaling: Array<{ value: number; label: string; name: string }>;
  codecs: string[];
  containers: string[];
  qualities: string[];
  imageFormats: string[];
  previewEncoding: string[];
  renameModes: string[];
  hdrCodecs: string[];
  frameFps: string[];
  frameEngines: string[];
  vsrQualities: Array<{ label: string; value: number }>;
  rtxScaleFactors: Array<{ label: string; value: number }>;
  sizeModes: string[];
  hdrPrecisions: Array<{ label: string; value: string }>;
  liveSourceQuality: string[];
  liveMaxHeights: number[];
  liveFps: string[];
  liveGuideQuality: string[];
  liveSegments: number[];
  modelLiveResolutions: string[];
}

export interface BootstrapPayload {
  settings: Partial<UISettings>;
  gpus: GPUInfo[];
  runtime: { ready: boolean; error: string };
  choices: RuntimeChoices;
  modelViewer: Record<string, unknown>;
}

export interface JobOutput {
  path: string;
  reportPath: string;
  details: Record<string, unknown>;
}

export interface JobState {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  error: string;
  result?: {
    outputs?: JobOutput[];
    batch?: Record<string, unknown>;
  } | null;
}

export interface BatchItem {
  id: string;
  name: string;
  size: string;
  type: 'image' | 'video';
  status: 'Queued' | 'Running' | 'Complete' | 'Failed';
  progress: number;
  elapsedTime: string;
  outputPath?: string;
  inputUrl: string;
  outputUrl?: string;
  details?: string;
}
