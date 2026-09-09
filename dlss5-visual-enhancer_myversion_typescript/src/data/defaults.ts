import { GPUInfo, UISettings, BatchItem } from '../types';

export const DETECTED_GPUS: GPUInfo[] = [
  {
    id: 'gpu-0-4090',
    name: 'NVIDIA GeForce RTX 4090',
    arch: 'Ada Lovelace (AD102)',
    vram: '24 GB GDDR6X',
    driver: '560.81 WHQL',
    hags: true,
    nvenc: true,
    tensorCores: 512,
  },
  {
    id: 'gpu-1-5090',
    name: 'NVIDIA GeForce RTX 5090 (Blackwell Simulation)',
    arch: 'Blackwell (GB202)',
    vram: '32 GB GDDR7',
    driver: '570.12 Next-Gen',
    hags: true,
    nvenc: true,
    tensorCores: 640,
  },
  {
    id: 'gpu-2-3090',
    name: 'NVIDIA GeForce RTX 3090',
    arch: 'Ampere (GA102)',
    vram: '24 GB GDDR6X',
    driver: '560.81 WHQL',
    hags: true,
    nvenc: true,
    tensorCores: 328,
  },
  {
    id: 'gpu-auto',
    name: 'Auto (Best Detected NVIDIA RTX)',
    arch: 'Auto-detect',
    vram: 'Optimal',
    driver: 'Active System Driver',
    hags: true,
    nvenc: true,
    tensorCores: 512,
  }
];

export const DEFAULT_SETTINGS: UISettings = {
  aiGpuId: 'gpu-0-4090',
  videoGpuId: 'gpu-0-4090',
  nrPreset: 'Quality',
  nrStyle: 'Default',
  nrIntensity: 1.0,
  localToneStrength: 1.0,
  localStructureStrength: 1.0,
  skinStructureStrength: -1.0,
  upscalingFactor: 2.0,
  automaticMask: false,
  dlssModelPreset: 'Default',
  dlssArchitecture: 'Auto',
  
  codec: 'H.264 (NVIDIA NVENC)',
  container: 'MP4',
  quality: 'Auto (Default)',
  hdrMode: false,
  previewEncoding: 'Auto',
  
  imageFormat: 'PNG',
  imageQuality: 95,
  imageRenameMode: 'Auto',
  imageCustomSuffix: '_DLSS5',
  
  upscaleMode: 'Image',
  upscaleVsrQuality: 4,
  upscaleScaleFactor: 2.0,
  upscaleHdrEnabled: false,
  upscaleHdrContrast: 100,
  upscaleHdrSaturation: 100,
  upscaleHdrMiddleGray: 50,
  upscaleHdrPeakLuminance: 1000,
  
  frameTargetFps: '60',
  frameEngine: 'DLSS Frame Generation (Ada+)',
  frameMotionGuide: 'Quality',
  frameMultiplier: 2,
  frameDuplicateRemoval: true,
  frameCodec: 'H.264 (NVIDIA NVENC)',
  
  liveSource: 'demo-gameplay',
  liveResolution: '1080p',
  liveFpsMode: 'Auto',
  liveBufferMs: 120,
};

export const SAMPLE_IMAGES = [
  {
    id: 'cyberpunk-city',
    title: 'Night City Architecture (1080p)',
    url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=80',
    type: 'Gaming / 3D Render'
  },
  {
    id: 'portrait-character',
    title: 'Character Skin Detail (720p)',
    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=1200&q=80',
    type: 'Portrait / Skin Structure'
  },
  {
    id: 'sci-fi-vehicle',
    title: 'Metallic Surface & Reflections (1080p)',
    url: 'https://images.unsplash.com/photo-1508974239320-0a029497e820?auto=format&fit=crop&w=1200&q=80',
    type: 'Ray Tracing / Reflections'
  }
];

export const INITIAL_BATCH_ITEMS: BatchItem[] = [
  {
    id: 'batch-1',
    name: 'night_city_exterior_frame01.png',
    size: '4.2 MB',
    type: 'image',
    status: 'Complete',
    progress: 100,
    elapsedTime: '0.42s',
    outputPath: 'outputs/night_city_exterior_frame01_DLSS5.png',
    inputUrl: SAMPLE_IMAGES[0].url,
    outputUrl: SAMPLE_IMAGES[0].url,
    details: 'DLSS 5 Neural Render [Quality | Preset G] · 2.0x Scale · 0.42s'
  },
  {
    id: 'batch-2',
    name: 'cyber_mech_hero_render.png',
    size: '6.8 MB',
    type: 'image',
    status: 'Queued',
    progress: 0,
    elapsedTime: '0.00s',
    inputUrl: SAMPLE_IMAGES[2].url,
    details: 'Pending GPU worker queue'
  }
];
