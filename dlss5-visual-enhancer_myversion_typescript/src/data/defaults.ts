import { GPUInfo, UISettings, BatchItem } from '../types';

// Replaced by /api/bootstrap at runtime. Keeping only Automatic here prevents
// the offline UI from inventing GPUs that are not installed on the machine.
export const DETECTED_GPUS: GPUInfo[] = [
  {
    id: 'auto',
    uuid: 'auto',
    name: 'Automatic (best compatible RTX)',
    arch: 'Auto',
    vram: 'Automatic',
    driver: '',
    compatible: true,
  },
];

// These mirror src/settings/models.py. /api/bootstrap overlays the user's saved
// config.ini values, so Python remains the validation/source of truth.
export const DEFAULT_SETTINGS: UISettings = {
  aiGpuId: 'auto',
  videoGpuId: 'auto',
  nrPreset: 'Default',
  nrStyle: 'Default',
  nrIntensity: 1.0,
  localToneStrength: 1.0,
  localStructureStrength: 1.0,
  skinStructureStrength: -1.0,
  upscalingFactor: 1.0,
  automaticMask: false,
  dlssModelPreset: 'Default',
  dlssArchitecture: 'Universal runtime',

  codec: 'H.264',
  container: 'MP4',
  quality: 'Auto (Default)',
  hdrMode: false,
  previewEncoding: 'Auto',
  videoRenameMode: 'Auto',
  videoCustomSuffix: '_DLSS5',

  imageFormat: 'PNG',
  imageQuality: 95,
  imageRenameMode: 'Auto',
  imageCustomSuffix: '_DLSS5',

  upscaleMode: 'Image',
  upscaleImageVsrQuality: 4,
  upscaleImageSizeMode: 'Scale factor',
  upscaleImageScaleFactor: 2.0,
  upscaleImageWidth: 3840,
  upscaleImageHeight: 2160,
  upscaleImageAspectLock: true,
  upscaleImageOutputFormat: 'PNG',
  upscaleImageQuality: 95,
  upscaleImagePreserveMetadata: true,
  upscaleImageRenameMode: 'Auto',
  upscaleImageCustomSuffix: '_RTXIMAGE',

  upscaleVsrEnabled: true,
  upscaleVsrQuality: 4,
  upscaleSizeMode: 'Scale factor',
  upscaleScaleFactor: 2.0,
  upscaleWidth: 3840,
  upscaleHeight: 2160,
  upscaleAspectLock: true,
  upscaleHdrEnabled: false,
  upscaleHdrContrast: 100,
  upscaleHdrSaturation: 100,
  upscaleHdrMiddleGray: 50,
  upscaleHdrPeakLuminance: 1000,
  upscaleHdrPrecision: 'Packed 10-bit',
  upscaleCodec: 'H.265 (NVIDIA NVENC)',
  upscaleContainer: 'MP4',
  upscaleQuality: 'Auto (Default)',
  upscaleRenameMode: 'Auto',
  upscaleCustomSuffix: '_RTXVIDEO',

  frameTargetFps: '60',
  frameEngine: 'Auto',
  frameMotionGuide: 'Fast',
  frameMultiplier: 2,
  frameDuplicateRemoval: true,
  frameCodec: 'H.264',
  frameContainer: 'MP4',
  frameQuality: 'Auto (Default)',
  frameHdrMode: false,
  frameRenameMode: 'Auto',
  frameCustomSuffix: '_DLSSFG',

  livePlaybackMode: 'Realtime',
  liveSourceMode: 'Local',
  liveSourceQuality: 'Auto',
  liveMaxHeight: 720,
  liveFpsMode: 'Auto',
  liveGuideQuality: 'Fast',
  liveSegmentSeconds: 2,
  liveBufferSeconds: 6,
  liveOpenMpv: true,
  modelLiveResolution: '720p',

  liveSource: '',
  liveResolution: '720p',
  liveBufferMs: 6000,
};

// Kept only so the original prototype components remain type-checkable. The
// production TypeScript UI never submits these remote demo assets to DLSS.
export const SAMPLE_IMAGES = [
  { id: 'placeholder', title: 'Upload an image', url: '', type: 'Local input' },
];

export const INITIAL_BATCH_ITEMS: BatchItem[] = [];
