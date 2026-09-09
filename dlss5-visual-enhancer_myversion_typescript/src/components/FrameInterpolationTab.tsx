import React, { useState, useEffect, useRef } from 'react';
import { UISettings, FrameRateChoice, MotionGuideChoice } from '../types';
import { 
  Film, 
  Play, 
  Pause, 
  FastForward, 
  RotateCcw, 
  Sliders, 
  Check, 
  Zap, 
  Layers,
  Activity,
  Gauge
} from 'lucide-react';

interface FrameInterpolationTabProps {
  settings: UISettings;
  onUpdateSettings: (updater: (prev: UISettings) => UISettings) => void;
  onStartJob: (jobName: string) => void;
}

export const FrameInterpolationTab: React.FC<FrameInterpolationTabProps> = ({
  settings,
  onUpdateSettings,
  onStartJob,
}) => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [showMotionVectors, setShowMotionVectors] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [previewGenerated, setPreviewGenerated] = useState(true);
  const [reflexLowLatency, setReflexLowLatency] = useState(true);

  // Interactive high-framerate canvas animation demonstrating 30fps vs interpolated 60fps/120fps smoothness
  const canvas30Ref = useRef<HTMLCanvasElement | null>(null);
  const canvasInterpRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  useEffect(() => {
    let t = 0;
    let lastTime30 = performance.now();
    let ballX30 = 50;

    const render = (time: number) => {
      // 30 FPS canvas updates only every 33.3ms (stutters visibly)
      if (time - lastTime30 >= 33.3) {
        lastTime30 = time;
        const c30 = canvas30Ref.current;
        if (c30) {
          const ctx30 = c30.getContext('2d');
          if (ctx30) {
            ctx30.clearRect(0, 0, c30.width, c30.height);
            // Draw background grid
            ctx30.strokeStyle = '#1e293b';
            ctx30.lineWidth = 1;
            for (let x = 0; x < c30.width; x += 30) {
              ctx30.beginPath();
              ctx30.moveTo(x, 0);
              ctx30.lineTo(x, c30.height);
              ctx30.stroke();
            }

            // Moving ball at 30 fps
            ballX30 = 50 + ((t * 2.5 * playbackSpeed) % (c30.width - 100));
            ctx30.fillStyle = '#ef4444';
            ctx30.beginPath();
            ctx30.arc(ballX30, c30.height / 2, 18, 0, Math.PI * 2);
            ctx30.fill();

            // Label
            ctx30.fillStyle = '#94a3b8';
            ctx30.font = '11px monospace';
            ctx30.fillText('Native 30 FPS (Sampled at 33.3ms)', 15, 25);
          }
        }
      }

      // Interpolated 60/120 FPS canvas updates at native 60Hz/120Hz display rate (ultra smooth)
      const cInterp = canvasInterpRef.current;
      if (cInterp) {
        const ctxInterp = cInterp.getContext('2d');
        if (ctxInterp) {
          ctxInterp.clearRect(0, 0, cInterp.width, cInterp.height);
          // Grid
          ctxInterp.strokeStyle = '#1e293b';
          ctxInterp.lineWidth = 1;
          for (let x = 0; x < cInterp.width; x += 30) {
            ctxInterp.beginPath();
            ctxInterp.moveTo(x, 0);
            ctxInterp.lineTo(x, cInterp.height);
            ctxInterp.stroke();
          }

          // Smooth position
          const ballXSmooth = 50 + ((t * 2.5 * playbackSpeed) % (cInterp.width - 100));
          
          // Motion vector overlay simulation
          if (showMotionVectors) {
            ctxInterp.strokeStyle = '#38bdf8';
            ctxInterp.lineWidth = 2;
            for (let vx = 30; vx < cInterp.width; vx += 40) {
              for (let vy = 30; vy < cInterp.height; vy += 40) {
                const dist = Math.hypot(vx - ballXSmooth, vy - cInterp.height / 2);
                if (dist < 60) {
                  ctxInterp.beginPath();
                  ctxInterp.moveTo(vx, vy);
                  ctxInterp.lineTo(vx + 15 * playbackSpeed, vy);
                  ctxInterp.stroke();
                }
              }
            }
          }

          // DLSS Frame Gen Generated Ball
          ctxInterp.fillStyle = '#76b900';
          ctxInterp.beginPath();
          ctxInterp.arc(ballXSmooth, cInterp.height / 2, 18, 0, Math.PI * 2);
          ctxInterp.fill();

          ctxInterp.fillStyle = '#76b900';
          ctxInterp.font = 'bold 11px monospace';
          ctxInterp.fillText(`DLSS-G ${settings.frameTargetFps} FPS (Interpolated Smoothness)`, 15, 25);
        }
      }

      if (isPlaying) {
        t += 1;
      }
      animFrameIdRef.current = requestAnimationFrame(render);
    };

    animFrameIdRef.current = requestAnimationFrame(render);
    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [isPlaying, playbackSpeed, showMotionVectors, settings.frameTargetFps]);

  const handleGeneratePreview = () => {
    setIsRendering(true);
    onStartJob(`Generating DLSS-G 3-Second Interpolation Preview (${settings.frameTargetFps} FPS)`);
    setTimeout(() => {
      setIsRendering(false);
      setPreviewGenerated(true);
    }, 900);
  };

  return (
    <div className="space-y-3">
      {/* Combined Unified Layout: Viewport on Left, Unified Control Panel on Right */}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* Left: Dual Playback Comparison Stage (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="rounded-lg bg-slate-900/80 border border-slate-800 overflow-hidden shadow-lg">
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950 border-b border-slate-800 text-xs">
              <span className="font-semibold text-slate-300 text-[11px]">Live Frame Rate & Motion Stepper</span>
              <div className="flex items-center gap-2.5 font-mono text-[10px]">
                <span className="text-red-400">Native: 30.0 FPS</span>
                <span className="text-slate-600">|</span>
                <span className="text-[#76b900] font-bold">Target: {settings.frameTargetFps} FPS</span>
              </div>
            </div>

            {/* Animation Stage: Native 30 FPS vs DLSS-G */}
            <div className="p-3 bg-slate-950 space-y-2">
              <div className="border border-slate-800 rounded-md overflow-hidden bg-slate-900/50">
                <canvas ref={canvas30Ref} width={640} height={76} className="w-full h-20 block" />
              </div>

              <div className="border border-emerald-950/80 rounded-md overflow-hidden bg-slate-900/50 relative">
                <canvas ref={canvasInterpRef} width={640} height={76} className="w-full h-20 block" />
                <div className="absolute top-1.5 right-1.5 px-1.5 py-0.2 rounded bg-emerald-500/20 text-[#76b900] font-mono text-[9px] border border-emerald-500/30 font-bold">
                  DLSS 5 NEURAL FLOW
                </div>
              </div>
            </div>

            {/* Playback Controls Toolbar */}
            <div className="p-2.5 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                </button>
                <button
                  onClick={() => setPlaybackSpeed(s => s === 1.0 ? 0.25 : s === 0.25 ? 0.5 : 1.0)}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-slate-300"
                  title="Cycle Slow Motion"
                >
                  Speed: {playbackSpeed}x
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleGeneratePreview}
                  disabled={isRendering}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-[#76b900] hover:bg-lime-400 text-black text-xs font-bold transition disabled:opacity-50"
                >
                  <Film className="w-3 h-3" />
                  <span>{isRendering ? 'Synthesizing...' : 'Generate 3s Preview'}</span>
                </button>
              </div>
            </div>

            {/* Integrated OFA Engine & Frame Pacing Telemetry Strip */}
            <div className="p-2 bg-slate-950/95 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs font-mono">
              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase block">OFA Hardware</span>
                <span className="text-[#76b900] font-bold text-[11px] block">Gen 4 Dual OFA</span>
                <span className="text-[9px] text-slate-400 block mt-0.5">Sub-pixel Bi-directional</span>
              </div>

              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase block">Motion Precision</span>
                <span className="text-sky-400 font-bold text-[11px] block">
                  {settings.frameMotionGuide === 'Quality' ? '1/4-pel Ultra' : '1/2-pel Low-Lat'}
                </span>
                <span className="text-[9px] text-slate-400 block mt-0.5">3840x2160 Flow Grid</span>
              </div>

              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase block">Queue Latency</span>
                <span className="text-emerald-400 font-bold text-[11px] block">4.2ms Reflex</span>
                <span className="text-[9px] text-slate-400 block mt-0.5">PCL Synchronized</span>
              </div>

              <div className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60">
                <span className="text-[9px] text-slate-500 uppercase block">Frame Multiplier</span>
                <span className="text-slate-200 font-bold text-[11px] block">{settings.frameMultiplier}x Cadence</span>
                <span className="text-[9px] text-emerald-400 block mt-0.5">
                  &rarr; {settings.frameTargetFps} FPS Smooth
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Unified Frame Generation Control Panel (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 space-y-3 shadow-lg">
            {/* Header: Title, OFA Engine badge & Flow Vectors Toggle */}
            <div className="pb-2.5 border-b border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-[#76b900] shrink-0">
                    <Zap className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-slate-100">DLSS Frame Generation (DLSS-G)</h2>
                    <span className="text-[9px] font-mono text-[#76b900] font-semibold">
                      OFA ENGINE &middot; ADA LOVELACE+
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setShowMotionVectors(!showMotionVectors)}
                  className={`px-2 py-1 rounded text-[11px] font-semibold transition border shrink-0 ${
                    showMotionVectors
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  {showMotionVectors ? 'Hide Vectors' : 'Show Vectors'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-[#76b900]" />
                <h3 className="text-xs font-bold text-slate-200">Frame Generation Pipeline</h3>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                Ada Lovelace+
              </span>
            </div>

            {/* Target FPS Selector */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Target Output Frame Rate (FPS)
              </label>
              <div className="grid grid-cols-4 gap-1">
                {(['30', '60', '120', '144', '240', '360', '480'] as FrameRateChoice[]).map((fps) => (
                  <button
                    key={fps}
                    onClick={() => onUpdateSettings(s => ({ ...s, frameTargetFps: fps }))}
                    className={`py-1 rounded text-[11px] font-mono transition border ${
                      settings.frameTargetFps === fps
                        ? 'bg-[#76b900] text-black font-bold border-[#76b900]'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {fps} FPS
                  </button>
                ))}
              </div>
            </div>

            {/* Motion Guide Quality */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Optical Flow Motion Guide
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(['Quality', 'Fast'] as MotionGuideChoice[]).map((guide) => (
                  <button
                    key={guide}
                    onClick={() => onUpdateSettings(s => ({ ...s, frameMotionGuide: guide }))}
                    className={`py-1.5 rounded text-xs font-semibold transition border ${
                      settings.frameMotionGuide === guide
                        ? 'bg-emerald-500/20 text-[#76b900] border-emerald-500/40 font-bold'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {guide} {guide === 'Quality' ? '(Precision)' : '(Low Latency)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Frame Multiplier */}
            <div>
              <div className="flex justify-between items-center text-[11px] mb-1">
                <span className="text-slate-300 font-semibold">Multiplier Ratio</span>
                <span className="font-mono text-[#76b900] font-bold">{settings.frameMultiplier}x Multiplier</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[2, 3, 4].map((mult) => (
                  <button
                    key={mult}
                    onClick={() => onUpdateSettings(s => ({ ...s, frameMultiplier: mult }))}
                    className={`py-1 rounded text-xs font-mono transition border ${
                      settings.frameMultiplier === mult
                        ? 'bg-[#76b900] text-black font-bold border-[#76b900]'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {mult}x
                  </button>
                ))}
              </div>
            </div>

            {/* Toggles */}
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-slate-200 font-medium">Duplicate Frame Removal</span>
                  <p className="text-[9px] text-slate-400">Purges static duplicates to maintain cadence</p>
                </div>
                <button
                  onClick={() => onUpdateSettings(s => ({ ...s, frameDuplicateRemoval: !s.frameDuplicateRemoval }))}
                  className={`w-8 h-4 rounded-full transition flex items-center px-0.5 ${
                    settings.frameDuplicateRemoval ? 'bg-[#76b900]' : 'bg-slate-800'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full bg-black transition transform ${
                    settings.frameDuplicateRemoval ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                <div>
                  <span className="text-xs text-slate-200 font-medium">NVIDIA Reflex Low Latency</span>
                  <p className="text-[9px] text-slate-400">Synchronizes CPU render queue with OFA engine</p>
                </div>
                <button
                  onClick={() => setReflexLowLatency(!reflexLowLatency)}
                  className={`w-8 h-4 rounded-full transition flex items-center px-0.5 ${
                    reflexLowLatency ? 'bg-[#76b900]' : 'bg-slate-800'
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full bg-black transition transform ${
                    reflexLowLatency ? 'translate-x-4' : 'translate-x-0'
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
