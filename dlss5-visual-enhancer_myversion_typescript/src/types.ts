export type TabId = 
  | 'neural-rendering'
  | 'upscale'
  | 'frame-interpolation'
  | 'model-viewer'
  | 'settings'
  | 'live'
  | 'about';


export type NRPreset = 'Ultra Performance' | 'Performance' | 'Balanced' | 'Quality' | 'Ultra Quality' | 'DLAA';
export type NRStyle = 'Default' | 'Cinematic' | 'Ultra Crisp' | 'Photorealistic' | 'High Dynamic' | 'Noise Suppressed';
export type DLSSModelPreset = 'Default' | 'Preset A' | 'Preset B' | 'Preset C' | 'Preset D' | 'Preset E' | 'Preset F' | 'Preset G' | 'Preset J' | 'Preset K';
export type DLSSArchitecture = 'Auto' | 'Turing+' | 'Ada Lovelace+' | 'Blackwell+';
export type CodecChoice = 'H.264' | 'H.264 (NVIDIA NVENC)' | 'H.265' | 'H.265 (NVIDIA NVENC)' | 'AV1' | 'AV1 (NVIDIA NVENC)' | 'ProRes Proxy';
export type ContainerChoice = 'MP4' | 'MKV' | 'MOV';
export type ImageFormatChoice = 'PNG' | 'JPEG' | 'WebP' | 'AVIF' | 'TIFF';
export type PreviewEncodingChoice = 'Auto' | 'Always H.264' | 'Disabled';
export type FrameRateChoice = '23.976' | '24' | '29.97' | '30' | '48' | '59.94' | '60' | '120' | '144' | '240' | '360' | '480';
export type FrameEngineChoice = 'Auto' | 'DLSS Frame Generation (Ada+)' | 'DLSS 5 Bidirectional Optical Flow' | 'RIFE CUDA Realtime';
export type MotionGuideChoice = 'Fast' | 'Quality';

export interface GPUInfo {
  id: string;
  name: string;
  arch: string;
  vram: string;
  driver: string;
  hags: boolean;
  nvenc: boolean;
  tensorCores: number;
}

export interface UISettings {
  aiGpuId: string;
  videoGpuId: string;
  nrPreset: NRPreset;
  nrStyle: NRStyle;
  nrIntensity: number; // 0.1 - 2.0
  localToneStrength: number; // 0.0 - 2.0
  localStructureStrength: number; // 0.0 - 2.0
  skinStructureStrength: number; // -1.0 - 2.0
  upscalingFactor: number;
  automaticMask: boolean;
  dlssModelPreset: DLSSModelPreset;
  dlssArchitecture: DLSSArchitecture;
  
  // Video & Codec settings
  codec: CodecChoice;
  container: ContainerChoice;
  quality: string;
  hdrMode: boolean;
  previewEncoding: PreviewEncodingChoice;
  
  // Image settings
  imageFormat: ImageFormatChoice;
  imageQuality: number;
  imageRenameMode: 'Auto' | 'Original' | 'Custom';
  imageCustomSuffix: string;
  
  // Upscale settings
  upscaleMode: 'Image' | 'Video';
  upscaleVsrQuality: number; // 1 - 4
  upscaleScaleFactor: number; // 1.5 - 4.0
  upscaleHdrEnabled: boolean;
  upscaleHdrContrast: number;
  upscaleHdrSaturation: number;
  upscaleHdrMiddleGray: number;
  upscaleHdrPeakLuminance: number;
  
  // Frame Interpolation settings
  frameTargetFps: FrameRateChoice;
  frameEngine: FrameEngineChoice;
  frameMotionGuide: MotionGuideChoice;
  frameMultiplier: number;
  frameDuplicateRemoval: boolean;
  frameCodec: CodecChoice;
  
  // Live settings
  liveSource: string;
  liveResolution: '480p' | '720p' | '1080p' | '1440p' | '4K';
  liveFpsMode: 'Auto' | 'Source' | '60' | '30' | '24';
  liveBufferMs: number;
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
