import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UISettings } from '../types';
import { SAMPLE_IMAGES } from '../data/defaults';
import { 
  Tv, 
  Upload, 
  Image as ImageIcon, 
  Film, 
  Play, 
  Pause, 
  RotateCcw, 
  Download, 
  ZoomIn, 
  Sliders, 
  Eye, 
  Check, 
  Layers, 
  Activity, 
  Sun, 
  Volume2, 
  VolumeX, 
  Move, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle,
  FileCheck,
  Link as LinkIcon
} from 'lucide-react';

interface UpscaleTabProps {
  settings: UISettings;
  onUpdateSettings: (updater: (prev: UISettings) => UISettings) => void;
  onStartJob: (jobName: string) => void;
  initialMode?: 'Image' | 'Video' | 'Live';
}

interface SampleVideo {
  id: string;
  title: string;
  category: string;
  url: string;
  defaultRes: string;
  fps: number;
}

const SAMPLE_VIDEOS: SampleVideo[] = [
  {
    id: 'sci-fi-cinema',
    title: 'Tears of Steel Sci-Fi VFX (Cinematic 1080p)',
    category: 'Sci-Fi VFX',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    defaultRes: '1920x1080',
    fps: 24,
  },
  {
    id: 'action-trailer',
    title: 'For Bigger Blazes (Fast Action 720p)',
    category: 'High Motion Action',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    defaultRes: '1280x720',
    fps: 30,
  },
  {
    id: 'animation-bunny',
    title: 'Big Buck Bunny (Clean Animation 1080p 60fps)',
    category: 'Animation & Edges',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    defaultRes: '1920x1080',
    fps: 60,
  },
];

const SAMPLE_YOUTUBE_LINKS = [
  {
    title: 'Cyberpunk 2077 RTX 4090 4K Gameplay',
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  },
  {
    title: 'Black Myth: Wukong 4K DLSS Showcase',
    url: 'https://www.youtube.com/watch?v=ScMzIvxBSi4',
  },
  {
    title: '4K 60FPS Nature HDR Demo',
    url: 'https://www.youtube.com/watch?v=EngW7tLk6R8',
  }
];

function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.trim().match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

export const UpscaleTab: React.FC<UpscaleTabProps> = ({
  settings,
  onUpdateSettings,
  onStartJob,
  initialMode,
}) => {
  // Mode: Image vs Video vs Live YouTube
  const [upscaleMode, setUpscaleMode] = useState<'Image' | 'Video' | 'Live'>(
    initialMode || (settings.upscaleMode as 'Image' | 'Video' | 'Live') || 'Image'
  );

  // View style: Split-Slider vs Side-by-Side
  const [viewStyle, setViewStyle] = useState<'split' | 'side-by-side'>('split');
  const [splitPos, setSplitPos] = useState<number>(50); // percentage 0 - 100
  const isDraggingSplitRef = useRef<boolean>(false);

  // Zoom & Pan for Image Mode
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const startPanPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Image Source State
  const [imageSourceChoice, setImageSourceChoice] = useState<'preset' | 'uploaded'>('preset');
  const [selectedImagePresetIndex, setSelectedImagePresetIndex] = useState<number>(0);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [uploadedImageName, setUploadedImageName] = useState<string>('');
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number }>({ width: 1920, height: 1080 });

  // Video Source State
  const [videoSourceChoice, setVideoSourceChoice] = useState<'preset' | 'uploaded'>('preset');
  const [selectedVideoPresetIndex, setSelectedVideoPresetIndex] = useState<number>(0);
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [uploadedVideoName, setUploadedVideoName] = useState<string>('');
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number }>({ width: 1920, height: 1080 });

  // Video Playback Controls
  const leftVideoRef = useRef<HTMLVideoElement | null>(null);
  const rightVideoRef = useRef<HTMLVideoElement | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState<boolean>(true);
  const [videoCurrentTime, setVideoCurrentTime] = useState<number>(0);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);

  // Processing & Feedback state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('Ready for RTX Super Resolution pass');
  const [dragOverZone, setDragOverZone] = useState<boolean>(false);

  // Additional tuning sliders
  const [deArtifactStrength, setDeArtifactStrength] = useState<number>(85); // 0 - 100
  const [edgeSharpness, setEdgeSharpness] = useState<number>(75); // 0 - 100

  // Live / YouTube State
  const [youtubeUrlInput, setYoutubeUrlInput] = useState<string>('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  const [activeYouTubeId, setActiveYouTubeId] = useState<string>('aqz-KE-bpKQ');
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [liveFps, setLiveFps] = useState<number>(60.0);
  const [liveLatencyMs, setLiveLatencyMs] = useState<number>(3.8);

  // Periodic FPS & Latency jitter for realistic live telemetry
  useEffect(() => {
    if (upscaleMode === 'Live') {
      const interval = setInterval(() => {
        setLiveFps(Math.round((59.3 + Math.random() * 1.4) * 10) / 10);
        setLiveLatencyMs(Math.round((3.5 + Math.random() * 0.6) * 10) / 10);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [upscaleMode]);

  const handleLoadYouTube = (customUrl?: string) => {
    const targetUrl = customUrl || youtubeUrlInput;
    const id = extractYouTubeId(targetUrl);
    if (!id) {
      setYoutubeError('Please enter a valid YouTube video URL or 11-character video ID');
      return;
    }
    setYoutubeError(null);
    setActiveYouTubeId(id);
    setStatusMessage(`Loaded stream: YouTube ID ${id}`);
  };

  // Active Media URLs
  const activeImageUrl = imageSourceChoice === 'uploaded' && uploadedImageUrl 
    ? uploadedImageUrl 
    : SAMPLE_IMAGES[selectedImagePresetIndex].url;

  const activeVideoUrl = videoSourceChoice === 'uploaded' && uploadedVideoUrl
    ? uploadedVideoUrl
    : SAMPLE_VIDEOS[selectedVideoPresetIndex].url;

  // Track image dimensions when activeImageUrl changes
  useEffect(() => {
    if (upscaleMode === 'Image') {
      const img = new Image();
      img.src = activeImageUrl;
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        }
      };
    }
  }, [activeImageUrl, upscaleMode]);

  // Synchronize both video elements
  const syncVideos = useCallback((targetTime?: number) => {
    const v1 = leftVideoRef.current;
    const v2 = rightVideoRef.current;
    if (!v1 || !v2) return;

    if (targetTime !== undefined) {
      v1.currentTime = targetTime;
      v2.currentTime = targetTime;
    } else {
      if (Math.abs(v1.currentTime - v2.currentTime) > 0.08) {
        v2.currentTime = v1.currentTime;
      }
    }
  }, []);

  // Sync play/pause
  useEffect(() => {
    const v1 = leftVideoRef.current;
    const v2 = rightVideoRef.current;
    if (!v1 || !v2) return;

    if (isVideoPlaying) {
      v1.play().catch(() => {});
      v2.play().catch(() => {});
    } else {
      v1.pause();
      v2.pause();
    }
  }, [isVideoPlaying, activeVideoUrl]);

  // Sync speed & mute
  useEffect(() => {
    const v1 = leftVideoRef.current;
    const v2 = rightVideoRef.current;
    if (v1 && v2) {
      v1.playbackRate = playbackSpeed;
      v2.playbackRate = playbackSpeed;
      v1.muted = isMuted;
      v2.muted = true; // only need sound from one video
    }
  }, [playbackSpeed, isMuted]);

  // Handle Video Metadata loaded
  const handleVideoLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (video.duration) {
      setVideoDuration(video.duration);
    }
    if (video.videoWidth && video.videoHeight) {
      setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
    }
  };

  const handleVideoTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    setVideoCurrentTime(e.currentTarget.currentTime);
    syncVideos();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setVideoCurrentTime(time);
    syncVideos(time);
  };

  // Image Upload Handler
  const handleImageUpload = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setUploadedImageUrl(url);
    setUploadedImageName(file.name);
    setImageSourceChoice('uploaded');
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setStatusMessage(`Loaded image: ${file.name}`);
  };

  // Video Upload Handler
  const handleVideoUpload = (file: File) => {
    if (!file.type.startsWith('video/')) return;
    const url = URL.createObjectURL(file);
    setUploadedVideoUrl(url);
    setUploadedVideoName(file.name);
    setVideoSourceChoice('uploaded');
    setIsVideoPlaying(true);
    setStatusMessage(`Loaded video: ${file.name}`);
  };

  // Unified File Input / Drop Handler
  const handleFileUploadEvent = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith('video/')) {
      setUpscaleMode('Video');
      handleVideoUpload(file);
    } else if (file.type.startsWith('image/')) {
      setUpscaleMode('Image');
      handleImageUpload(file);
    }
  };

  // Drag & Drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverZone(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (file.type.startsWith('video/')) {
      setUpscaleMode('Video');
      handleVideoUpload(file);
    } else if (file.type.startsWith('image/')) {
      setUpscaleMode('Image');
      handleImageUpload(file);
    }
  };

  // Split-screen drag interactions
  const handleMouseDownSplit = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitRef.current = true;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingSplitRef.current) return;
      const container = document.getElementById('upscale-split-viewport');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const relativeX = moveEvent.clientX - rect.left;
      const clampedPercent = Math.max(5, Math.min(95, (relativeX / rect.width) * 100));
      setSplitPos(clampedPercent);
    };

    const onMouseUp = () => {
      isDraggingSplitRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Panning when zoomed
  const handleMouseDownPan = (e: React.MouseEvent) => {
    if (zoomLevel <= 1) return;
    setIsPanning(true);
    startPanPos.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
  };

  const handleMouseMovePan = (e: React.MouseEvent) => {
    if (!isPanning || zoomLevel <= 1) return;
    setPanOffset({
      x: e.clientX - startPanPos.current.x,
      y: e.clientY - startPanPos.current.y,
    });
  };

  const handleMouseUpPan = () => {
    setIsPanning(false);
  };

  // Execute RTX Super Resolution
  const handleExecuteUpscale = () => {
    setIsProcessing(true);
    const targetW = Math.round((upscaleMode === 'Image' ? imageDimensions.width : videoDimensions.width) * settings.upscaleScaleFactor);
    const targetH = Math.round((upscaleMode === 'Image' ? imageDimensions.height : videoDimensions.height) * settings.upscaleScaleFactor);
    
    onStartJob(`RTX ${upscaleMode} Super Resolution: ${targetW}x${targetH} (VSR Level ${settings.upscaleVsrQuality}, ${settings.upscaleScaleFactor}x Scale)`);
    
    setTimeout(() => {
      setIsProcessing(false);
      setStatusMessage(`Super Resolution Complete: Output ${targetW}x${targetH} frame ready`);
    }, 750);
  };

  // Export / Download Upscaled Frame
  const handleExportFrame = () => {
    const canvas = document.createElement('canvas');
    const targetW = Math.round((upscaleMode === 'Image' ? imageDimensions.width : videoDimensions.width) * settings.upscaleScaleFactor);
    const targetH = Math.round((upscaleMode === 'Image' ? imageDimensions.height : videoDimensions.height) * settings.upscaleScaleFactor);
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (upscaleMode === 'Image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = activeImageUrl;
      img.onload = () => {
        ctx.filter = `contrast(${100 + settings.upscaleVsrQuality * 6}%) saturate(${settings.upscaleHdrEnabled ? 115 : 102}%) brightness(102%)`;
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const link = document.createElement('a');
        link.download = `RTX_VSR_${Date.now()}_${targetW}x${targetH}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      };
    } else if (leftVideoRef.current) {
      const video = leftVideoRef.current;
      ctx.filter = `contrast(${100 + settings.upscaleVsrQuality * 6}%) saturate(${settings.upscaleHdrEnabled ? 115 : 102}%) brightness(102%)`;
      ctx.drawImage(video, 0, 0, targetW, targetH);
      const link = document.createElement('a');
      link.download = `RTX_VSR_VideoFrame_${Date.now()}_${targetW}x${targetH}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  };

  // Compute Active Target Resolution
  const activeInputWidth = upscaleMode === 'Image' ? imageDimensions.width : videoDimensions.width;
  const activeInputHeight = upscaleMode === 'Image' ? imageDimensions.height : videoDimensions.height;
  const targetOutputWidth = Math.round(activeInputWidth * settings.upscaleScaleFactor);
  const targetOutputHeight = Math.round(activeInputHeight * settings.upscaleScaleFactor);

  // Compute CSS filter for the enhanced side
  const enhancedFilter = `
    contrast(${100 + settings.upscaleVsrQuality * 6 + (edgeSharpness - 50) * 0.2}%) 
    brightness(${settings.upscaleHdrEnabled ? 104 : 101}%) 
    saturate(${settings.upscaleHdrEnabled ? 116 : 104}%) 
    drop-shadow(0 0 0.5px rgba(0,0,0,0.6))
  `;

  return (
    <div 
      className="space-y-3"
      onDragOver={(e) => { e.preventDefault(); setDragOverZone(true); }}
      onDragLeave={() => setDragOverZone(false)}
      onDrop={handleDrop}
    >
      {/* Combined Unified Layout: Viewport on Left, Unified Control Panel on Right */}


      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* Left: Viewport Stage (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="rounded-lg bg-slate-900/90 border border-slate-800 overflow-hidden shadow-lg">
            {/* Viewport Header */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950 border-b border-slate-800 text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="text-slate-300 font-semibold flex items-center gap-1 text-[11px]">
                  <Activity className="w-3 h-3 text-[#76b900]" />
                  <span>{activeInputWidth}x{activeInputHeight}</span>
                </span>
                <span className="text-slate-600">&rarr;</span>
                <span className="text-emerald-400 font-bold text-[11px]">
                  {targetOutputWidth}x{targetOutputHeight} ({settings.upscaleScaleFactor}x)
                </span>
              </div>

              {/* Zoom Controls for Image Mode */}
              {upscaleMode === 'Image' ? (
                <div className="flex items-center gap-1">
                  <span className="text-slate-400 text-[10px]">Inspect Zoom:</span>
                  {[1, 2, 4, 8].map((z) => (
                    <button
                      key={z}
                      onClick={() => {
                        setZoomLevel(z);
                        if (z === 1) setPanOffset({ x: 0, y: 0 });
                      }}
                      className={`px-1.5 py-0.2 rounded text-[10px] font-mono transition ${
                        zoomLevel === z
                          ? 'bg-[#76b900] text-black font-bold'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {z}x
                    </button>
                  ))}
                </div>
              ) : (
                <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 text-[#76b900] text-[10px] font-bold">
                  RTX VSR Level {settings.upscaleVsrQuality} Active
                </span>
              )}
            </div>

            {/* Interactive Viewport Area */}
            <div 
              id="upscale-split-viewport"
              className="relative aspect-video w-full bg-slate-950 overflow-hidden select-none"
              onMouseDown={handleMouseDownPan}
              onMouseMove={handleMouseMovePan}
              onMouseUp={handleMouseUpPan}
              style={{ cursor: zoomLevel > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default' }}
            >
              {/* ================= IMAGE MODE ================= */}
              {upscaleMode === 'Image' && (
                viewStyle === 'split' ? (
                  // Split Slider Image Mode
                  <div className="relative w-full h-full">
                    {/* Left Base Image (Standard Interpolation) */}
                    <div 
                      className="absolute inset-0 overflow-hidden transition-transform duration-75"
                      style={{ 
                        transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
                        transformOrigin: 'center center'
                      }}
                    >
                      <img
                        src={activeImageUrl}
                        alt="Standard Bilinear"
                        className="w-full h-full object-cover filter blur-[0.4px]"
                      />
                    </div>

                    {/* Right Enhanced Image (Clipped by splitPos) */}
                    <div 
                      className="absolute inset-0 overflow-hidden transition-transform duration-75 pointer-events-none"
                      style={{ 
                        clipPath: `inset(0 0 0 ${splitPos}%)`,
                        transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
                        transformOrigin: 'center center'
                      }}
                    >
                      <img
                        src={activeImageUrl}
                        alt="RTX Super Resolution"
                        className="w-full h-full object-cover"
                        style={{ filter: enhancedFilter }}
                      />
                    </div>

                    {/* Split Line Divider */}
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-[#76b900] shadow-[0_0_10px_#76b900] cursor-ew-resize z-20 flex items-center justify-center"
                      style={{ left: `${splitPos}%` }}
                      onMouseDown={handleMouseDownSplit}
                    >
                      <div className="w-7 h-7 rounded-full bg-black border-2 border-[#76b900] flex items-center justify-center text-[#76b900] shadow-lg">
                        <Move className="w-3.5 h-3.5" />
                      </div>
                    </div>

                    {/* Overlay Badges */}
                    <div className="absolute top-3 left-3 pointer-events-none px-2 py-0.5 rounded bg-black/75 backdrop-blur text-[10px] font-mono text-slate-400 border border-slate-800">
                      Standard Interpolation (Bilinear)
                    </div>
                    <div className="absolute top-3 right-3 pointer-events-none px-2.5 py-0.5 rounded bg-[#76b900]/90 backdrop-blur text-[10px] font-mono text-black font-bold shadow-md">
                      RTX VSR {settings.upscaleScaleFactor}x (Level {settings.upscaleVsrQuality})
                    </div>
                  </div>
                ) : (
                  // Side-by-Side Image Mode
                  <div className="grid grid-cols-2 w-full h-full divide-x divide-slate-800">
                    <div 
                      className="relative overflow-hidden w-full h-full"
                      style={{ 
                        transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
                        transformOrigin: 'center center'
                      }}
                    >
                      <img
                        src={activeImageUrl}
                        alt="Standard"
                        className="w-full h-full object-cover filter blur-[0.4px]"
                      />
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur text-[10px] font-mono text-slate-400">
                        Standard Bilinear
                      </div>
                    </div>

                    <div 
                      className="relative overflow-hidden w-full h-full"
                      style={{ 
                        transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
                        transformOrigin: 'center center'
                      }}
                    >
                      <img
                        src={activeImageUrl}
                        alt="RTX VSR"
                        className="w-full h-full object-cover"
                        style={{ filter: enhancedFilter }}
                      />
                      <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-[#76b900]/90 backdrop-blur text-[10px] font-mono text-black font-bold">
                        RTX Super Resolution ({targetOutputWidth}x{targetOutputHeight})
                      </div>
                    </div>
                  </div>
                )
              )}

              {/* ================= VIDEO MODE ================= */}
              {upscaleMode === 'Video' && (
                viewStyle === 'split' ? (
                  // Split Slider Video Mode
                  <div className="relative w-full h-full">
                    {/* Left Base Video */}
                    <div className="absolute inset-0 overflow-hidden">
                      <video
                        ref={leftVideoRef}
                        src={activeVideoUrl}
                        crossOrigin="anonymous"
                        playsInline
                        loop
                        muted={isMuted}
                        onLoadedMetadata={handleVideoLoadedMetadata}
                        onTimeUpdate={handleVideoTimeUpdate}
                        className="w-full h-full object-cover filter blur-[0.3px]"
                      />
                    </div>

                    {/* Right Enhanced Video (Clipped by splitPos) */}
                    <div 
                      className="absolute inset-0 overflow-hidden pointer-events-none"
                      style={{ clipPath: `inset(0 0 0 ${splitPos}%)` }}
                    >
                      <video
                        ref={rightVideoRef}
                        src={activeVideoUrl}
                        crossOrigin="anonymous"
                        playsInline
                        loop
                        muted
                        className="w-full h-full object-cover"
                        style={{ filter: enhancedFilter }}
                      />
                    </div>

                    {/* Split Line Divider */}
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-[#76b900] shadow-[0_0_10px_#76b900] cursor-ew-resize z-20 flex items-center justify-center"
                      style={{ left: `${splitPos}%` }}
                      onMouseDown={handleMouseDownSplit}
                    >
                      <div className="w-7 h-7 rounded-full bg-black border-2 border-[#76b900] flex items-center justify-center text-[#76b900] shadow-lg">
                        <Move className="w-3.5 h-3.5" />
                      </div>
                    </div>

                    {/* Badges */}
                    <div className="absolute top-3 left-3 pointer-events-none px-2 py-0.5 rounded bg-black/75 backdrop-blur text-[10px] font-mono text-slate-400 border border-slate-800">
                      Standard Video Stream ({activeInputWidth}x{activeInputHeight})
                    </div>
                    <div className="absolute top-3 right-3 pointer-events-none px-2.5 py-0.5 rounded bg-[#76b900]/90 backdrop-blur text-[10px] font-mono text-black font-bold shadow-md">
                      RTX Video Super Resolution ({targetOutputWidth}x{targetOutputHeight})
                    </div>
                  </div>
                ) : (
                  // Side-by-Side Video Mode
                  <div className="grid grid-cols-2 w-full h-full divide-x divide-slate-800">
                    <div className="relative overflow-hidden w-full h-full">
                      <video
                        ref={leftVideoRef}
                        src={activeVideoUrl}
                        crossOrigin="anonymous"
                        playsInline
                        loop
                        muted={isMuted}
                        onLoadedMetadata={handleVideoLoadedMetadata}
                        onTimeUpdate={handleVideoTimeUpdate}
                        className="w-full h-full object-cover filter blur-[0.3px]"
                      />
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur text-[10px] font-mono text-slate-400">
                        Native Compressed Stream
                      </div>
                    </div>

                    <div className="relative overflow-hidden w-full h-full">
                      <video
                        ref={rightVideoRef}
                        src={activeVideoUrl}
                        crossOrigin="anonymous"
                        playsInline
                        loop
                        muted
                        className="w-full h-full object-cover"
                        style={{ filter: enhancedFilter }}
                      />
                      <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-[#76b900]/90 backdrop-blur text-[10px] font-mono text-black font-bold">
                        RTX VSR Enhanced ({targetOutputWidth}x{targetOutputHeight})
                      </div>
                    </div>
                  </div>
                )
              )}

              {/* ================= LIVE YOUTUBE MODE ================= */}
              {upscaleMode === 'Live' && (
                viewStyle === 'split' ? (
                  // Split Slider Live YouTube Mode
                  <div className="relative w-full h-full">
                    {/* Left Base YouTube Video */}
                    <div className="absolute inset-0 overflow-hidden pointer-events-auto">
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${activeYouTubeId}?autoplay=1&mute=1&controls=1&enablejsapi=1&rel=0&modestbranding=1`}
                        title="Standard Stream"
                        className="w-full h-full border-0 filter blur-[0.25px]"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>

                    {/* Right Enhanced YouTube Video with Split Mask */}
                    <div 
                      className="absolute inset-0 overflow-hidden pointer-events-none"
                      style={{ clipPath: `inset(0 0 0 ${splitPos}%)` }}
                    >
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${activeYouTubeId}?autoplay=1&mute=1&controls=0&enablejsapi=1&rel=0&modestbranding=1`}
                        title="RTX VSR Stream"
                        className="w-full h-full border-0 pointer-events-none"
                        style={{ filter: enhancedFilter }}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      />
                    </div>

                    {/* Split Line Divider */}
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-[#76b900] shadow-[0_0_10px_#76b900] cursor-ew-resize z-20 flex items-center justify-center pointer-events-auto"
                      style={{ left: `${splitPos}%` }}
                      onMouseDown={handleMouseDownSplit}
                    >
                      <div className="w-7 h-7 rounded-full bg-black border-2 border-[#76b900] flex items-center justify-center text-[#76b900] shadow-lg">
                        <Move className="w-3.5 h-3.5" />
                      </div>
                    </div>

                    {/* Overlay Badges */}
                    <div className="absolute top-3 left-3 pointer-events-none px-2 py-0.5 rounded bg-black/80 backdrop-blur text-[10px] font-mono text-slate-400 border border-slate-800">
                      Raw Stream (YouTube)
                    </div>
                    <div className="absolute top-3 right-3 pointer-events-none px-2.5 py-0.5 rounded bg-[#76b900]/90 backdrop-blur text-[10px] font-mono text-black font-bold shadow-md">
                      RTX VSR Level {settings.upscaleVsrQuality} (Real-Time)
                    </div>
                  </div>
                ) : (
                  // Side-by-Side Live Mode
                  <div className="grid grid-cols-2 w-full h-full divide-x divide-slate-800">
                    <div className="relative w-full h-full overflow-hidden">
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${activeYouTubeId}?autoplay=1&mute=1&controls=1&enablejsapi=1&rel=0`}
                        title="Standard Stream"
                        className="w-full h-full border-0 filter blur-[0.2px]"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                      <div className="absolute bottom-2 left-2 pointer-events-none px-2 py-0.5 rounded bg-black/80 backdrop-blur text-[10px] font-mono text-slate-400">
                        Raw Video Stream
                      </div>
                    </div>

                    <div className="relative w-full h-full overflow-hidden">
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${activeYouTubeId}?autoplay=1&mute=1&controls=0&enablejsapi=1&rel=0`}
                        title="RTX VSR Stream"
                        className="w-full h-full border-0 pointer-events-none"
                        style={{ filter: enhancedFilter }}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      />
                      <div className="absolute bottom-2 right-2 pointer-events-none px-2 py-0.5 rounded bg-[#76b900]/90 backdrop-blur text-[10px] font-mono text-black font-bold">
                        RTX VSR Level {settings.upscaleVsrQuality} Enhanced
                      </div>
                    </div>
                  </div>
                )
              )}

              {/* Drag/Drop Overlay Notice */}
              {dragOverZone && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-30 flex flex-col items-center justify-center text-emerald-400 border-2 border-dashed border-[#76b900] m-3 rounded-lg">
                  <Upload className="w-10 h-10 mb-2 animate-bounce" />
                  <p className="font-bold text-sm">Drop your Image or Video here to upscale</p>
                  <p className="text-xs text-slate-400">Supports PNG, JPG, WEBP, MP4, WebM, MOV</p>
                </div>
              )}
            </div>

            {/* Video Playback Scrubber (when in Video mode) */}
            {upscaleMode === 'Video' && (
              <div className="p-2 bg-slate-950 border-t border-slate-800 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max={videoDuration || 100}
                    step="0.05"
                    value={videoCurrentTime}
                    onChange={handleSeek}
                    className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-[#76b900]"
                  />
                  <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
                    {Math.floor(videoCurrentTime)}s / {Math.floor(videoDuration)}s
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setIsVideoPlaying(!isVideoPlaying)}
                      className="p-1 rounded bg-[#76b900] hover:bg-lime-400 text-black font-bold transition"
                      title={isVideoPlaying ? 'Pause' : 'Play'}
                    >
                      {isVideoPlaying ? <Pause className="w-3.5 h-3.5 fill-black" /> : <Play className="w-3.5 h-3.5 fill-black" />}
                    </button>

                    <button
                      onClick={() => syncVideos(0)}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                      title="Restart"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => setIsMuted(!isMuted)}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                      title={isMuted ? 'Unmute' : 'Mute'}
                    >
                      {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-400 text-[10px]">Speed:</span>
                    {[0.5, 1.0, 1.5, 2.0].map((spd) => (
                      <button
                        key={spd}
                        onClick={() => setPlaybackSpeed(spd)}
                        className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                          playbackSpeed === spd
                            ? 'bg-emerald-500/20 text-[#76b900] font-bold border border-emerald-500/40'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Actions Bar */}
            <div className="p-2.5 bg-slate-950/80 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-[#76b900]" />
                <span className="truncate max-w-[240px]">{statusMessage}</span>
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportFrame}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition border border-slate-700"
                  title="Capture and save high-resolution frame"
                >
                  <Download className="w-3 h-3" />
                  <span>Save Frame</span>
                </button>

                <button
                  onClick={handleExecuteUpscale}
                  disabled={isProcessing}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#76b900] hover:bg-lime-400 text-black text-xs font-bold transition disabled:opacity-50 shadow-md shadow-emerald-950/40"
                >
                  <Play className="w-3 h-3 fill-black" />
                  <span>{isProcessing ? 'Upscaling...' : 'Execute Super Resolution'}</span>
                </button>
              </div>
            </div>

            {/* Integrated Real-time Telemetry Strip */}
            <div className="p-2 bg-slate-950/90 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs font-mono">
              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase block">Input Format</span>
                <span className="text-[#76b900] font-bold text-[11px] truncate block">
                  {upscaleMode === 'Image' ? 'RGBA 8-BIT' : upscaleMode === 'Live' ? 'VP9 / H.264' : 'NV12 / YUV420'}
                </span>
                <span className="text-[9px] text-slate-500 block mt-0.5">
                  {upscaleMode === 'Live' ? '1080p Stream' : `${activeInputWidth}x${activeInputHeight}`}
                </span>
              </div>

              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase block">Reconstruction</span>
                <span className="text-emerald-400 font-bold text-[11px] block">
                  VSR Level {settings.upscaleVsrQuality}
                </span>
                <span className="text-[9px] text-slate-500 block mt-0.5">CNN De-artifacting</span>
              </div>

              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase block">Output Canvas</span>
                <span className="text-slate-200 font-bold text-[11px] block">
                  {upscaleMode === 'Live' ? '3840x2160 (4K)' : `${targetOutputWidth}x${targetOutputHeight}`}
                </span>
                <span className="text-[9px] text-slate-500 block mt-0.5">
                  {settings.upscaleScaleFactor}x Neural Scaling
                </span>
              </div>

              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase block">Tensor Core Load</span>
                <span className="text-slate-200 font-bold text-[11px] block">
                  {upscaleMode === 'Live' ? `${liveFps} FPS` : '84% Occupancy'}
                </span>
                <span className="text-[9px] text-emerald-400 block mt-0.5">
                  {upscaleMode === 'Live' ? `${liveLatencyMs}ms Latency` : '3.8ms Latency'}
                </span>
              </div>
            </div>
          </div>
        </div>


        {/* Right: Unified Upscale & VSR Control Panel (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 space-y-3 shadow-lg">
            {/* Header: Title, Tensor Core badge & Upload Action */}
            <div className="pb-2.5 border-b border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-[#76b900] shrink-0">
                    <Tv className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h2 className="text-xs font-bold text-slate-100">
                        RTX Super Resolution (VSR)
                      </h2>
                      <span className="px-1 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/20 text-[#76b900] text-[8px] font-mono font-bold">
                        TENSOR CORE
                      </span>
                    </div>
                  </div>
                </div>

                {/* Upload Button directly in panel header */}
                {upscaleMode !== 'Live' && (
                  <label className="cursor-pointer flex items-center justify-center gap-1 px-2.5 py-1 rounded bg-[#76b900] hover:bg-lime-400 text-black text-[11px] font-bold transition shadow-sm shrink-0">
                    <Upload className="w-3 h-3" />
                    <span>Upload {upscaleMode === 'Image' ? 'Image' : 'Video'}</span>
                    <input
                      type="file"
                      accept={upscaleMode === 'Image' ? "image/png,image/jpeg,image/webp,image/bmp" : "video/mp4,video/webm,video/ogg,video/quicktime,video/x-matroska"}
                      onChange={handleFileUploadEvent}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {/* Mode Switcher Tabs */}
              <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-950 rounded-md border border-slate-800">
                <button
                  onClick={() => {
                    setUpscaleMode('Image');
                    onUpdateSettings(s => ({ ...s, upscaleMode: 'Image' }));
                  }}
                  className={`flex items-center justify-center gap-1 py-1 rounded text-[11px] font-medium transition ${
                    upscaleMode === 'Image'
                      ? 'bg-[#76b900] text-black font-bold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ImageIcon className="w-3 h-3" />
                  <span>Image</span>
                </button>
                <button
                  onClick={() => {
                    setUpscaleMode('Video');
                    onUpdateSettings(s => ({ ...s, upscaleMode: 'Video' }));
                  }}
                  className={`flex items-center justify-center gap-1 py-1 rounded text-[11px] font-medium transition ${
                    upscaleMode === 'Video'
                      ? 'bg-[#76b900] text-black font-bold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Film className="w-3 h-3" />
                  <span>Video</span>
                </button>
                <button
                  onClick={() => {
                    setUpscaleMode('Live');
                    onUpdateSettings(s => ({ ...s, upscaleMode: 'Video' }));
                  }}
                  className={`flex items-center justify-center gap-1 py-1 rounded text-[11px] font-medium transition ${
                    upscaleMode === 'Live'
                      ? 'bg-[#76b900] text-black font-bold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Tv className="w-3 h-3" />
                  <span>Live Stream</span>
                </button>
              </div>
            </div>

            {/* Source Selection & View Mode Controls */}
            <div className="pb-2.5 border-b border-slate-800 space-y-2">
              {upscaleMode === 'Live' ? (
                <div className="space-y-2">
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        placeholder="Paste YouTube stream or video URL..."
                        value={youtubeUrlInput}
                        onChange={(e) => setYoutubeUrlInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleLoadYouTube()}
                        className="w-full pl-7 pr-2 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-200 placeholder:text-slate-500 focus:border-[#76b900] focus:outline-none font-mono"
                      />
                      <LinkIcon className="w-3 h-3 text-slate-500 absolute left-2 top-2" />
                    </div>
                    <button
                      onClick={() => handleLoadYouTube()}
                      className="px-2.5 py-1 rounded bg-[#76b900] hover:bg-lime-400 text-black text-[11px] font-bold transition shrink-0"
                    >
                      Load
                    </button>
                  </div>

                  {youtubeError && (
                    <p className="text-[10px] text-red-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>{youtubeError}</span>
                    </p>
                  )}

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-slate-400">Preset Streams:</span>
                      <div className="flex items-center gap-2 font-mono text-slate-400">
                        <span className="text-[#76b900] font-bold">{liveFps} FPS</span>
                        <span>|</span>
                        <span className="text-emerald-400">{liveLatencyMs}ms</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {SAMPLE_YOUTUBE_LINKS.map((link, idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setYoutubeUrlInput(link.url);
                            handleLoadYouTube(link.url);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] transition border ${
                            activeYouTubeId === extractYouTubeId(link.url)
                              ? 'bg-emerald-500/20 text-[#76b900] border-emerald-500/40 font-bold'
                              : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                          }`}
                        >
                          {link.title.split(' (')[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-400">
                      {upscaleMode === 'Image' ? 'Source Media:' : 'Video Stream:'}
                    </span>

                    {/* View Mode Switcher (Split Slider vs Side-by-Side) */}
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-400">View:</span>
                      <div className="inline-flex rounded bg-slate-950 p-0.5 border border-slate-800 text-[10px]">
                        <button
                          onClick={() => setViewStyle('split')}
                          className={`px-1.5 py-0.2 rounded transition ${
                            viewStyle === 'split' ? 'bg-[#76b900] text-black font-bold' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Split
                        </button>
                        <button
                          onClick={() => setViewStyle('side-by-side')}
                          className={`px-1.5 py-0.2 rounded transition ${
                            viewStyle === 'side-by-side' ? 'bg-[#76b900] text-black font-bold' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Side-by-Side
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {/* Uploaded File Pill (if exists) */}
                    {upscaleMode === 'Image' && uploadedImageUrl && (
                      <button
                        onClick={() => setImageSourceChoice('uploaded')}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition border ${
                          imageSourceChoice === 'uploaded'
                            ? 'bg-[#76b900] text-black font-bold border-[#76b900]'
                            : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                        }`}
                      >
                        <FileCheck className="w-3 h-3" />
                        <span className="truncate max-w-[120px]">{uploadedImageName || 'Uploaded Image'}</span>
                      </button>
                    )}

                    {upscaleMode === 'Video' && uploadedVideoUrl && (
                      <button
                        onClick={() => setVideoSourceChoice('uploaded')}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition border ${
                          videoSourceChoice === 'uploaded'
                            ? 'bg-[#76b900] text-black font-bold border-[#76b900]'
                            : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                        }`}
                      >
                        <FileCheck className="w-3 h-3" />
                        <span className="truncate max-w-[120px]">{uploadedVideoName || 'Uploaded Video'}</span>
                      </button>
                    )}

                    {/* Presets */}
                    {upscaleMode === 'Image' ? (
                      SAMPLE_IMAGES.map((sample, idx) => (
                        <button
                          key={sample.id}
                          onClick={() => {
                            setImageSourceChoice('preset');
                            setSelectedImagePresetIndex(idx);
                            setZoomLevel(1);
                            setPanOffset({ x: 0, y: 0 });
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition border ${
                            imageSourceChoice === 'preset' && selectedImagePresetIndex === idx
                              ? 'bg-[#76b900] text-black font-bold border-[#76b900]'
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {sample.title.split(' (')[0]}
                        </button>
                      ))
                    ) : (
                      SAMPLE_VIDEOS.map((sample, idx) => (
                        <button
                          key={sample.id}
                          onClick={() => {
                            setVideoSourceChoice('preset');
                            setSelectedVideoPresetIndex(idx);
                            setIsVideoPlaying(true);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition border ${
                            videoSourceChoice === 'preset' && selectedVideoPresetIndex === idx
                              ? 'bg-[#76b900] text-black font-bold border-[#76b900]'
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {sample.category}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Tuning Controls Section Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#76b900]" />
                <h3 className="text-xs font-bold text-slate-200">RTX Super Resolution Tuning</h3>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                RTX Video SDK
              </span>
            </div>

            {/* VSR Quality Level */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-semibold text-slate-300">
                  RTX VSR Quality Level
                </label>
                <span className="text-[11px] font-mono text-[#76b900] font-bold">
                  Quality {settings.upscaleVsrQuality}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => onUpdateSettings(s => ({ ...s, upscaleVsrQuality: lvl }))}
                    className={`py-1 rounded text-xs font-bold transition border ${
                      settings.upscaleVsrQuality === lvl
                        ? 'bg-[#76b900] text-black border-[#76b900] shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    Level {lvl}
                  </button>
                ))}
              </div>
            </div>

            {/* Scale Factor */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-semibold text-slate-300">Target Scale Factor</label>
                <span className="text-[11px] font-mono text-[#76b900] font-bold">
                  {settings.upscaleScaleFactor}x &rarr; {targetOutputWidth}x{targetOutputHeight}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[1.5, 2.0, 3.0, 4.0].map((factor) => (
                  <button
                    key={factor}
                    onClick={() => onUpdateSettings(s => ({ ...s, upscaleScaleFactor: factor }))}
                    className={`py-1 rounded text-xs font-semibold transition border ${
                      settings.upscaleScaleFactor === factor
                        ? 'bg-emerald-500/20 text-[#76b900] border-emerald-500/40 font-bold'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {factor}x
                  </button>
                ))}
              </div>
            </div>

            {/* Fine Edge Sharpness & De-artifacting */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-slate-300">Artifact Suppression</span>
                  <span className="font-mono text-[#76b900] font-semibold">{deArtifactStrength}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={deArtifactStrength}
                  onChange={(e) => setDeArtifactStrength(parseInt(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-[#76b900]"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-slate-300">Edge Sharpening / Texture Clarity</span>
                  <span className="font-mono text-[#76b900] font-semibold">{edgeSharpness}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="100"
                  value={edgeSharpness}
                  onChange={(e) => setEdgeSharpness(parseInt(e.target.value))}
                  className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-[#76b900]"
                />
              </div>
            </div>

            {/* RTX Video HDR (Auto-HDR) Section */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-200 font-semibold flex items-center gap-1">
                    <Sun className="w-3.5 h-3.5 text-[#76b900]" />
                    <span>RTX Video HDR (Auto-HDR)</span>
                  </span>
                  <p className="text-[9px] text-slate-400">Expands SDR color gamut to 10-bit Rec.2020</p>
                </div>
                <button
                  onClick={() => onUpdateSettings(s => ({ ...s, upscaleHdrEnabled: !s.upscaleHdrEnabled }))}
                  className={`w-8 h-4 rounded-full transition flex items-center px-0.5 ${
                    settings.upscaleHdrEnabled ? 'bg-[#76b900]' : 'bg-slate-800'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full bg-black transition transform ${
                    settings.upscaleHdrEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {settings.upscaleHdrEnabled && (
                <div className="p-2 rounded bg-slate-950 border border-slate-800/80 space-y-1.5 text-xs">
                  <div>
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-slate-400">Peak Luminance</span>
                      <span className="font-mono text-emerald-400">{settings.upscaleHdrPeakLuminance} nits</span>
                    </div>
                    <input
                      type="range"
                      min="400"
                      max="2000"
                      step="100"
                      value={settings.upscaleHdrPeakLuminance}
                      onChange={(e) => onUpdateSettings(s => ({ ...s, upscaleHdrPeakLuminance: parseInt(e.target.value) }))}
                      className="w-full h-1 bg-slate-800 rounded cursor-pointer accent-[#76b900]"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-slate-400">Middle Gray Reference</span>
                      <span className="font-mono text-emerald-400">{settings.upscaleHdrMiddleGray}%</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="80"
                      value={settings.upscaleHdrMiddleGray}
                      onChange={(e) => onUpdateSettings(s => ({ ...s, upscaleHdrMiddleGray: parseInt(e.target.value) }))}
                      className="w-full h-1 bg-slate-800 rounded cursor-pointer accent-[#76b900]"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
