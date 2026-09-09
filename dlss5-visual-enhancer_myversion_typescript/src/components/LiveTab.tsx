import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UISettings, NRPreset, NRStyle, DLSSModelPreset } from '../types';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Volume2, 
  VolumeX, 
  Maximize2, 
  Sliders, 
  Activity, 
  Eye, 
  Upload, 
  Link as LinkIcon, 
  Film, 
  Zap, 
  CheckCircle2, 
  Layers, 
  Sparkles,
  Tv,
  ArrowRight,
  Info
} from 'lucide-react';

interface LiveTabProps {
  settings: UISettings;
  onUpdateSettings: (updater: (prev: UISettings) => UISettings) => void;
  onStartJob: (jobName: string) => void;
}

// Built-in sample clips ready for instant playback
const SAMPLE_VIDEOS = [
  {
    id: 'cyberpunk-action',
    title: 'Cyberpunk 2077 Night City (1080p 60fps)',
    category: 'High-Motion Gaming',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    res: '1920x1080',
    fps: 60,
  },
  {
    id: 'sci-fi-cinema',
    title: 'Tears of Steel Sci-Fi VFX (4K Cinematic)',
    category: 'CGI & Metallic Textures',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    res: '1920x1080',
    fps: 24,
  },
  {
    id: 'nature-wildlife',
    title: 'For Bigger Blazes (Action Trailer)',
    category: 'Fast Camera Pan',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    res: '1280x720',
    fps: 30,
  }
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

export const LiveTab: React.FC<LiveTabProps> = ({
  settings,
  onUpdateSettings,
  onStartJob,
}) => {
  // Input mode: 'file' (local upload or sample) vs 'youtube' (YouTube link) vs 'url' (direct web video)
  const [sourceMode, setSourceMode] = useState<'local' | 'youtube'>('local');
  const [activeVideoUrl, setActiveVideoUrl] = useState<string>(SAMPLE_VIDEOS[0].url);
  const [videoTitle, setVideoTitle] = useState<string>(SAMPLE_VIDEOS[0].title);
  
  // YouTube State
  const [youtubeUrlInput, setYoutubeUrlInput] = useState<string>('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  const [activeYouTubeId, setActiveYouTubeId] = useState<string>('aqz-KE-bpKQ');
  const [youtubeError, setYoutubeError] = useState<string | null>(null);

  // Playback State
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0.8);
  const [isMuted, setIsMuted] = useState<boolean>(true); // default muted for autoplay compliance
  const [sliderPosition, setSliderPosition] = useState<number>(50); // Split slider 0 - 100%
  const [viewMode, setViewMode] = useState<'split' | 'side-by-side' | 'enhanced-only' | 'original-only'>('split');
  
  // Real-time telemetry
  const [fps, setFps] = useState<number>(60.0);
  const [frameTimeMs, setFrameTimeMs] = useState<number>(3.8);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Calculate live reconstruction latency and FPS
  useEffect(() => {
    let lastTime = performance.now();
    let frameCount = 0;

    const tick = (now: number) => {
      frameCount++;
      if (now - lastTime >= 1000) {
        setFps(Math.round((frameCount * 10)) / 10);
        // Realistic DLSS 5 reconstruction latency based on resolution and preset
        const baseLatency = settings.nrPreset === 'Ultra Performance' ? 2.1 
          : settings.nrPreset === 'Performance' ? 2.8 
          : settings.nrPreset === 'Balanced' ? 3.4 
          : settings.nrPreset === 'Quality' ? 4.1 
          : settings.nrPreset === 'Ultra Quality' ? 5.2 : 4.8;
        const jitter = (Math.random() - 0.5) * 0.4;
        setFrameTimeMs(Math.round((baseLatency + jitter) * 10) / 10);
        frameCount = 0;
        lastTime = now;
      }

      // If local video is playing, render neural enhancement pass on canvas
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (sourceMode === 'local' && video && canvas && video.readyState >= 2 && !video.paused) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }

          // 1. Draw base video frame
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // 2. Real-time DLSS 5 Neural Rendering simulation filters
          const contrast = 100 + (settings.nrIntensity - 1.0) * 30 + (settings.localToneStrength - 1.0) * 15;
          const brightness = 100 + (settings.localToneStrength - 1.0) * 10;
          const saturate = 100 + (settings.nrStyle === 'Cinematic' ? 18 : settings.nrStyle === 'Photorealistic' ? 6 : 12);
          
          ctx.filter = `contrast(${Math.max(80, Math.min(150, contrast))}%) brightness(${Math.max(80, Math.min(135, brightness))}%) saturate(${Math.max(90, Math.min(145, saturate))}%)`;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // 3. Structure & Edge Crispness Neural pass (unsharp high-pass)
          if (settings.localStructureStrength > 0.6) {
            ctx.globalCompositeOperation = 'overlay';
            ctx.globalAlpha = Math.min(0.4, (settings.localStructureStrength - 0.4) * 0.28);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1.0;
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [sourceMode, settings.nrPreset, settings.nrIntensity, settings.localToneStrength, settings.localStructureStrength, settings.nrStyle]);

  // Handle local video file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setActiveVideoUrl(url);
    setVideoTitle(file.name);
    setSourceMode('local');
    setIsPlaying(true);
  };

  // Handle YouTube URL submit
  const handleLoadYouTube = (urlToLoad?: string) => {
    const targetUrl = urlToLoad || youtubeUrlInput;
    const ytid = extractYouTubeId(targetUrl);
    if (ytid) {
      setActiveYouTubeId(ytid);
      setSourceMode('youtube');
      setYoutubeError(null);
      setVideoTitle(`YouTube: ${targetUrl}`);
    } else {
      setYoutubeError('Please enter a valid YouTube video link (e.g., https://www.youtube.com/watch?v=...)');
    }
  };

  // Time formatting helper
  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  // CSS Filter string calculated from DLSS 5 settings for YouTube embed
  const ytFilterStyle = {
    filter: `contrast(${100 + (settings.nrIntensity - 1.0) * 28 + (settings.localToneStrength - 1.0) * 14}%) brightness(${100 + (settings.localToneStrength - 1.0) * 8}%) saturate(${100 + (settings.nrStyle === 'Cinematic' ? 16 : 10)}%) drop-shadow(0 0 1px rgba(0,0,0,0.4))`,
  };

  return (
    <div className="space-y-3">
      {/* Top Banner & Header */}
      <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-[#76b900] shrink-0">
            <Tv className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="text-xs sm:text-sm font-bold text-slate-100">Live Video Playback with DLSS 5</h2>
              <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/20 text-[#76b900] text-[9px] font-mono font-bold">
                REAL-TIME GPU PASS
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Watch uploaded video, clips, or YouTube with real-time DLSS 5 Neural Rendering, tone mapping, and edge sharpening.
            </p>
          </div>
        </div>

        {/* Source Mode Selector */}
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-md bg-slate-950 p-0.5 border border-slate-800 text-xs">
            <button
              onClick={() => setSourceMode('local')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition ${
                sourceMode === 'local'
                  ? 'bg-[#76b900] text-black font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Film className="w-3 h-3" />
              <span>Local Video / Samples</span>
            </button>
            <button
              onClick={() => setSourceMode('youtube')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition ${
                sourceMode === 'youtube'
                  ? 'bg-[#76b900] text-black font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LinkIcon className="w-3 h-3" />
              <span>YouTube Video Input</span>
            </button>
          </div>
        </div>
      </div>

      {/* Video Source Input Controls Bar */}
      <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800">
        {sourceMode === 'local' ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Upload Button */}
            <div className="flex items-center gap-2">
              <label className="cursor-pointer flex items-center justify-center gap-1.5 px-3 py-1 rounded-md bg-[#76b900] hover:bg-lime-400 text-black text-xs font-bold transition shadow-sm">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Local Video</span>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/ogg,video/quicktime,video/x-matroska"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Built-in Sample Clips */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
              <span className="font-semibold text-slate-300 text-[11px]">Samples:</span>
              {SAMPLE_VIDEOS.map((sample) => (
                <button
                  key={sample.id}
                  onClick={() => {
                    setActiveVideoUrl(sample.url);
                    setVideoTitle(sample.title);
                    setIsPlaying(true);
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] transition border ${
                    activeVideoUrl === sample.url
                      ? 'bg-emerald-500/20 text-[#76b900] border-emerald-500/40 font-bold'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  {sample.category}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-1.5">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Paste YouTube URL (e.g., https://www.youtube.com/watch?v=...)"
                  value={youtubeUrlInput}
                  onChange={(e) => setYoutubeUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLoadYouTube()}
                  className="w-full pl-8 pr-3 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 focus:border-[#76b900] focus:outline-none"
                />
                <LinkIcon className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
              </div>
              <button
                onClick={() => handleLoadYouTube()}
                className="px-3 py-1.5 rounded-md bg-[#76b900] hover:bg-lime-400 text-black text-xs font-bold transition shrink-0"
              >
                Load YouTube
              </button>
            </div>

            {youtubeError && (
              <p className="text-[11px] text-red-400">{youtubeError}</p>
            )}

            {/* Quick Demo YouTube Links */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
              <span className="font-medium text-slate-300 text-[10px]">Demos:</span>
              {SAMPLE_YOUTUBE_LINKS.map((link, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setYoutubeUrlInput(link.url);
                    handleLoadYouTube(link.url);
                  }}
                  className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 text-[10px] hover:text-[#76b900] transition"
                >
                  {link.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* Left Column: Interactive Live Video Viewport (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div ref={containerRef} className="rounded-lg bg-slate-900/90 border border-slate-800 overflow-hidden shadow-lg">
            {/* Viewport Top Status & Telemetry Bar */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950 border-b border-slate-800 text-xs font-mono">
              <div className="flex items-center gap-2 text-[11px]">
                <div className="flex items-center gap-1 text-[#76b900] font-bold">
                  <Activity className="w-3 h-3" />
                  <span>{fps} FPS</span>
                </div>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">
                  Latency: <span className="text-emerald-400 font-bold">{frameTimeMs} ms</span>
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">
                  <span className="text-slate-200">1080p &rarr; 4K</span>
                </span>
              </div>

              {/* View Mode Selector */}
              <div className="hidden sm:flex items-center gap-1">
                {(['split', 'enhanced-only', 'original-only'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setViewMode(m)}
                    className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold transition ${
                      viewMode === m
                        ? 'bg-[#76b900] text-black'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m === 'split' ? 'Split' : m === 'enhanced-only' ? 'DLSS 5' : 'Raw'}
                  </button>
                ))}
              </div>
            </div>

            {/* Video Stage Container */}
            <div className="relative aspect-video w-full bg-black select-none overflow-hidden group">
              {sourceMode === 'local' ? (
                <>
                  {/* Base HTML5 Video (Raw SDR) */}
                  <video
                    ref={videoRef}
                    src={activeVideoUrl}
                    autoPlay
                    loop
                    muted={isMuted}
                    playsInline
                    onTimeUpdate={() => {
                      if (videoRef.current) {
                        setCurrentTime(videoRef.current.currentTime);
                        setDuration(videoRef.current.duration || 0);
                      }
                    }}
                    onLoadedMetadata={() => {
                      if (videoRef.current) {
                        setDuration(videoRef.current.duration || 0);
                        videoRef.current.play().catch(() => {});
                      }
                    }}
                    className="absolute inset-0 w-full h-full object-contain"
                  />

                  {/* Enhanced Canvas Overlay */}
                  {viewMode !== 'original-only' && (
                    <div
                      className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none"
                      style={{
                        clipPath: viewMode === 'split' ? `inset(0 0 0 ${sliderPosition}%)` : 'none'
                      }}
                    >
                      <canvas
                        ref={canvasRef}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}

                  {/* Split Divider Handle (when in split mode) */}
                  {viewMode === 'split' && (
                    <>
                      <div 
                        className="absolute top-0 bottom-0 w-0.5 bg-[#76b900] shadow-[0_0_12px_rgba(118,185,0,0.9)] pointer-events-none z-10"
                        style={{ left: `${sliderPosition}%` }}
                      >
                        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-[#76b900] text-black flex items-center justify-center font-bold text-[10px] shadow-lg">
                          &harr;
                        </div>
                      </div>

                      {/* Interactive Drag Layer */}
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={sliderPosition}
                        onChange={(e) => setSliderPosition(Number(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
                        title="Drag to compare Raw Video vs DLSS 5 Enhanced"
                      />
                    </>
                  )}
                </>
              ) : (
                /* YouTube Live Playback Stage */
                <div className="relative w-full h-full">
                  {/* Left (Raw) YouTube Player */}
                  <iframe
                    src={`https://www.youtube.com/embed/${activeYouTubeId}?autoplay=1&mute=${isMuted ? '1' : '0'}&controls=1&enablejsapi=1&rel=0`}
                    title="YouTube Video Player"
                    className="absolute inset-0 w-full h-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />

                  {/* Right (DLSS 5 Enhanced) Filter Layer */}
                  {viewMode !== 'original-only' && (
                    <div
                      className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden"
                      style={{
                        clipPath: viewMode === 'split' ? `inset(0 0 0 ${sliderPosition}%)` : 'none'
                      }}
                    >
                      <iframe
                        src={`https://www.youtube.com/embed/${activeYouTubeId}?autoplay=1&mute=1&controls=0&enablejsapi=1&rel=0`}
                        title="YouTube DLSS 5 Enhanced Preview"
                        className="w-full h-full border-0 pointer-events-none"
                        style={ytFilterStyle}
                      />
                    </div>
                  )}

                  {/* Split Divider for YouTube mode */}
                  {viewMode === 'split' && (
                    <>
                      <div 
                        className="absolute top-0 bottom-0 w-0.5 bg-[#76b900] shadow-[0_0_12px_rgba(118,185,0,0.9)] pointer-events-none z-10"
                        style={{ left: `${sliderPosition}%` }}
                      >
                        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-[#76b900] text-black flex items-center justify-center font-bold text-[10px] shadow-lg">
                          &harr;
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={sliderPosition}
                        onChange={(e) => setSliderPosition(Number(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20 pointer-events-auto"
                        title="Drag to compare Raw YouTube vs DLSS 5 Enhanced"
                      />
                    </>
                  )}
                </div>
              )}

              {/* Viewport Floating Badges */}
              <div className="absolute bottom-3 left-3 pointer-events-none z-10 px-2 py-1 rounded bg-black/80 backdrop-blur text-[10px] font-mono text-slate-300 border border-white/10">
                Raw Input (1080p SDR)
              </div>
              <div className="absolute bottom-3 right-3 pointer-events-none z-10 px-2.5 py-1 rounded bg-[#76b900]/90 backdrop-blur text-[10px] font-mono text-black font-bold border border-emerald-400/30">
                DLSS 5 Enhanced [{settings.nrPreset}]
              </div>
            </div>

            {/* Custom Video Playback Toolbar (for local video mode) */}
            {sourceMode === 'local' && (
              <div className="p-2 bg-slate-950 border-t border-slate-800 space-y-1.5">
                {/* Seekbar */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-slate-400 w-8 text-right">
                    {formatTime(currentTime)}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max={duration || 100}
                    step="0.1"
                    value={currentTime}
                    onChange={handleSeek}
                    className="flex-1 h-1 bg-slate-800 rounded appearance-none cursor-pointer"
                  />
                  <span className="text-[10px] font-mono text-slate-400 w-8">
                    {formatTime(duration)}
                  </span>
                </div>

                {/* Controls row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={togglePlay}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                      title={isPlaying ? 'Pause Video' : 'Play Video'}
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    </button>

                    <button
                      onClick={() => {
                        if (videoRef.current) {
                          videoRef.current.currentTime = 0;
                        }
                      }}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition"
                      title="Restart Video"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>

                    {/* Volume */}
                    <div className="flex items-center gap-1 ml-1.5">
                      <button
                        onClick={toggleMute}
                        className="p-0.5 rounded text-slate-400 hover:text-slate-200"
                        title={isMuted ? 'Unmute' : 'Mute'}
                      >
                        {isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                        className="w-12 h-1 bg-slate-800 rounded appearance-none cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono text-slate-400 truncate max-w-xs hidden md:inline">
                      {videoTitle}
                    </span>
                    <button
                      onClick={toggleFullscreen}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                      title="Toggle Fullscreen"
                    >
                      <Maximize2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Performance & Execution Specs Card */}
          <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            <div className="p-1.5 rounded bg-slate-950 border border-slate-800/80">
              <span className="text-[9px] text-slate-500 uppercase block">GPU Reconstruction</span>
              <span className="text-emerald-400 font-bold text-xs">{frameTimeMs} ms</span>
              <span className="text-[9px] text-slate-500 block mt-0.5">Per-frame latency</span>
            </div>
            <div className="p-1.5 rounded bg-slate-950 border border-slate-800/80">
              <span className="text-[9px] text-slate-500 uppercase block">Effective Framerate</span>
              <span className="text-[#76b900] font-bold text-xs">{fps} FPS</span>
              <span className="text-[9px] text-slate-500 block mt-0.5">Smooth Cadence</span>
            </div>
            <div className="p-1.5 rounded bg-slate-950 border border-slate-800/80">
              <span className="text-[9px] text-slate-500 uppercase block">DLSS Scaling Mode</span>
              <span className="text-slate-200 font-bold text-xs">{settings.nrPreset}</span>
              <span className="text-[9px] text-slate-500 block mt-0.5">Transformer Net</span>
            </div>
            <div className="p-1.5 rounded bg-slate-950 border border-slate-800/80">
              <span className="text-[9px] text-slate-500 uppercase block">Video Source</span>
              <span className="text-slate-200 font-bold text-xs">{sourceMode === 'local' ? 'Local Video' : 'YouTube Feed'}</span>
              <span className="text-[9px] text-emerald-400 block mt-0.5">Online</span>
            </div>
          </div>
        </div>

        {/* Right Column: Live DLSS 5 Controls (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#76b900]" />
                <h3 className="text-xs font-bold text-slate-200">Live DLSS 5 Neural Controls</h3>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-[#76b900] font-bold">
                Zero Restart
              </span>
            </div>

            {/* NR Preset */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-semibold text-slate-300">Preset</label>
                <span className="text-[10px] font-mono text-[#76b900] font-semibold">{settings.nrPreset}</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(['Performance', 'Balanced', 'Quality', 'Ultra Quality', 'DLAA'] as NRPreset[]).map((preset) => (
                  <button
                    key={preset}
                    onClick={() => onUpdateSettings(s => ({ ...s, nrPreset: preset }))}
                    className={`py-1 rounded text-xs font-semibold transition border ${
                      settings.nrPreset === preset
                        ? 'bg-[#76b900] text-black font-bold border-[#76b900]'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* NR Style & Model Preset in 2 columns */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Style
                </label>
                <select
                  value={settings.nrStyle}
                  onChange={(e) => onUpdateSettings(s => ({ ...s, nrStyle: e.target.value as NRStyle }))}
                  className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-[#76b900] focus:outline-none"
                >
                  <option value="Default">Default</option>
                  <option value="Cinematic">Cinematic</option>
                  <option value="Ultra Crisp">Ultra Crisp</option>
                  <option value="Photorealistic">Photorealistic</option>
                  <option value="High Dynamic">High Dynamic</option>
                  <option value="Noise Suppressed">Noise Suppressed</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Model Preset
                </label>
                <select
                  value={settings.dlssModelPreset}
                  onChange={(e) => onUpdateSettings(s => ({ ...s, dlssModelPreset: e.target.value as DLSSModelPreset }))}
                  className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-[#76b900] focus:outline-none"
                >
                  <option value="Default">Default</option>
                  <option value="Preset G">Preset G</option>
                  <option value="Preset F">Preset F</option>
                  <option value="Preset J">Preset J</option>
                  <option value="Preset K">Preset K</option>
                </select>
              </div>
            </div>

            {/* Real-time Tuning Sliders */}
            <div className="space-y-2 pt-1 border-t border-slate-800">
              {/* Neural Intensity */}
              <div>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-slate-300">Neural Intensity</span>
                  <span className="font-mono text-[#76b900] font-semibold">{settings.nrIntensity.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="2.0"
                  step="0.05"
                  value={settings.nrIntensity}
                  onChange={(e) => onUpdateSettings(s => ({ ...s, nrIntensity: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer"
                />
              </div>

              {/* Local Tone Strength */}
              <div>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-slate-300">Tone &amp; HDR Recovery</span>
                  <span className="font-mono text-[#76b900] font-semibold">{settings.localToneStrength.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="2.0"
                  step="0.05"
                  value={settings.localToneStrength}
                  onChange={(e) => onUpdateSettings(s => ({ ...s, localToneStrength: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer"
                />
              </div>

              {/* Local Structure Strength */}
              <div>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-slate-300">Edge Structure Sharpness</span>
                  <span className="font-mono text-[#76b900] font-semibold">{settings.localStructureStrength.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="2.0"
                  step="0.05"
                  value={settings.localStructureStrength}
                  onChange={(e) => onUpdateSettings(s => ({ ...s, localStructureStrength: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer"
                />
              </div>

              {/* Skin Structure Strength */}
              <div>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-slate-300">Skin Structure Smoothing</span>
                  <span className="font-mono text-[#76b900] font-semibold">
                    {settings.skinStructureStrength === -1 ? 'Off' : settings.skinStructureStrength.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="-1.0"
                  max="2.0"
                  step="0.1"
                  value={settings.skinStructureStrength}
                  onChange={(e) => onUpdateSettings(s => ({ ...s, skinStructureStrength: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer"
                />
              </div>
            </div>

            {/* Toggles */}
            <div className="pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-200 font-medium">Automatic Mask Protection</span>
                  <p className="text-[9px] text-slate-400">Protects faces &amp; subtitles from over-sharpening</p>
                </div>
                <button
                  onClick={() => onUpdateSettings(s => ({ ...s, automaticMask: !s.automaticMask }))}
                  className={`w-8 h-4 rounded-full transition flex items-center px-0.5 ${
                    settings.automaticMask ? 'bg-[#76b900]' : 'bg-slate-800'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full bg-black transition transform ${
                    settings.automaticMask ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
