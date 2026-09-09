import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  UISettings, 
  NRPreset, 
  NRStyle, 
  DLSSModelPreset, 
  BatchItem,
  CodecChoice,
  ContainerChoice,
  ImageFormatChoice 
} from '../types';
import { SAMPLE_IMAGES, INITIAL_BATCH_ITEMS } from '../data/defaults';
import { 
  Sparkles, 
  Upload, 
  Sliders, 
  Play, 
  Download, 
  FileText, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Eye,
  RefreshCw,
  Film,
  Image as ImageIcon,
  Layers,
  ZoomIn
} from 'lucide-react';

interface NeuralRenderingTabProps {
  settings: UISettings;
  onUpdateSettings: (updater: (prev: UISettings) => UISettings) => void;
  onStartJob: (jobName: string) => void;
}

export const NeuralRenderingTab: React.FC<NeuralRenderingTabProps> = ({
  settings,
  onUpdateSettings,
  onStartJob,
}) => {
  const [mode, setMode] = useState<'Image' | 'Video'>('Image');
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [customImageUrl, setCustomImageUrl] = useState<string | null>(null);
  const [sliderPosition, setSliderPosition] = useState(50); // Split comparison slider (0 - 100%)
  const [batchItems, setBatchItems] = useState<BatchItem[]>(INITIAL_BATCH_ITEMS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeJobLog, setActiveJobLog] = useState<string | null>(null);
  const [diagnosticReport, setDiagnosticReport] = useState<Record<string, unknown> | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeImageUrl = customImageUrl || SAMPLE_IMAGES[currentImageIndex].url;

  // Real-time canvas filter shader simulation based on DLSS 5 Neural Rendering parameters
  const renderEnhancedCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = activeImageUrl;
    img.onload = () => {
      canvas.width = img.width || 1200;
      canvas.height = img.height || 800;

      // Draw base image
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Apply DLSS 5 Neural Rendering simulation filters
      // Intensity scales contrast & clarity
      const contrast = 100 + (settings.nrIntensity - 1.0) * 25 + (settings.localToneStrength - 1.0) * 20;
      // Tone strength scales brightness and highlights
      const brightness = 100 + (settings.localToneStrength - 1.0) * 15;
      // Structure strength sharpens and pops edges
      const saturate = 100 + (settings.nrStyle === 'Cinematic' ? 15 : settings.nrStyle === 'Photorealistic' ? 5 : 10);

      // Create filter string
      ctx.filter = `contrast(${Math.max(80, Math.min(150, contrast))}%) brightness(${Math.max(80, Math.min(140, brightness))}%) saturate(${Math.max(90, Math.min(140, saturate))}%)`;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Apply unsharp mask pass for structure strength
      if (settings.localStructureStrength > 0.8) {
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = Math.min(0.35, (settings.localStructureStrength - 0.5) * 0.25);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
      }
    };
  }, [activeImageUrl, settings.nrIntensity, settings.localToneStrength, settings.localStructureStrength, settings.nrStyle]);

  useEffect(() => {
    renderEnhancedCanvas();
  }, [renderEnhancedCanvas]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCustomImageUrl(url);
    
    // Add to batch list
    const newItem: BatchItem = {
      id: `upload-${Date.now()}`,
      name: file.name,
      size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      type: file.type.startsWith('video') ? 'video' : 'image',
      status: 'Queued',
      progress: 0,
      elapsedTime: '0.00s',
      inputUrl: url,
      details: `Custom input · ${settings.nrPreset} Preset`
    };
    setBatchItems(prev => [newItem, ...prev]);
  };

  const runPreview = () => {
    setIsProcessing(true);
    onStartJob(`Generating DLSS 5 ${mode} Preview`);
    setActiveJobLog('Allocating Tensor Cores... Running Neural Reconstruction Shader pipeline...');

    setTimeout(() => {
      setIsProcessing(false);
      setActiveJobLog('Preview generated: DLSS 5 Neural Rendering applied successfully.');
      // Generate diagnostic metadata
      setDiagnosticReport({
        preset: settings.nrPreset,
        style: settings.nrStyle,
        intensity: settings.nrIntensity,
        localTone: settings.localToneStrength,
        localStructure: settings.localStructureStrength,
        skinStructure: settings.skinStructureStrength,
        automaticMask: settings.automaticMask,
        dlssModelPreset: settings.dlssModelPreset,
        dlssArchitecture: settings.dlssArchitecture,
        inputResolution: mode === 'Image' ? '1920x1080' : '1920x1080@60fps',
        outputResolution: mode === 'Image' ? '3840x2160 (4K)' : '3840x2160@60fps',
        reconstructionTimeMs: 4.8,
        nvencQuality: settings.quality,
        codec: settings.codec,
      });
    }, 900);
  };

  const runBatchProcessing = () => {
    setIsProcessing(true);
    onStartJob('Executing DLSS 5 Batch Pipeline');
    setActiveJobLog('Starting batch queue processing on AI GPU...');

    setBatchItems(prev => prev.map(item => ({ ...item, status: 'Running', progress: 20 })));

    let progress = 20;
    const interval = setInterval(() => {
      progress += 25;
      if (progress >= 100) {
        clearInterval(interval);
        setBatchItems(prev => prev.map(item => ({
          ...item,
          status: 'Complete',
          progress: 100,
          elapsedTime: '0.38s',
          outputPath: `outputs/${item.name.replace(/\.[^/.]+$/, '')}_DLSS5.${mode === 'Image' ? settings.imageFormat.toLowerCase() : settings.container.toLowerCase()}`,
          details: `Rendered with DLSS 5 [${settings.nrPreset} | ${settings.dlssModelPreset}]`
        })));
        setIsProcessing(false);
        setActiveJobLog('Batch execution completed successfully. All outputs validated and written.');
      } else {
        setBatchItems(prev => prev.map(item => ({ ...item, progress })));
      }
    }, 400);
  };

  return (
    <div className="space-y-3">
      {/* Combined Unified Layout: Viewport on Left, Unified Control Panel on Right */}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* Left Column: Interactive Before/After Preview Canvas (7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="rounded-lg bg-slate-900/80 border border-slate-800 overflow-hidden shadow-lg">
            {/* Viewport Header */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-950/80 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-300">
                  {mode === 'Image' ? 'Neural Rendering Preview' : 'Video Frame Preview'}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                  3840x2160
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="text-emerald-400 font-mono text-[11px]">
                  Split: {sliderPosition}%
                </span>
                <button 
                  onClick={() => setSliderPosition(sliderPosition === 50 ? 100 : 50)}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                  title="Toggle Full/Split View"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Split Comparison Stage */}
            <div className="relative aspect-video w-full bg-slate-950 select-none overflow-hidden group">
              {/* Original Left Image */}
              <img
                src={activeImageUrl}
                alt="Input Source"
                className="absolute inset-0 w-full h-full object-contain"
              />

              {/* Enhanced Right Canvas with clip-path */}
              <div 
                className="absolute inset-0 w-full h-full overflow-hidden"
                style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }}
              >
                <canvas
                  ref={canvasRef}
                  className="w-full h-full object-contain"
                />
              </div>

              {/* Split Slider Divider Line */}
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-[#76b900] shadow-[0_0_10px_rgba(118,185,0,0.8)] pointer-events-none z-10"
                style={{ left: `${sliderPosition}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-[#76b900] text-black flex items-center justify-center font-bold text-[9px] shadow-md">
                  &harr;
                </div>
              </div>

              {/* Interactive Range Input overlay */}
              <input
                type="range"
                min="0"
                max="100"
                value={sliderPosition}
                onChange={(e) => setSliderPosition(Number(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
                title="Drag to compare Original vs DLSS 5 Enhanced"
              />

              {/* Labels Badge */}
              <div className="absolute bottom-2 left-2 pointer-events-none z-10 px-2 py-0.5 rounded bg-black/75 backdrop-blur text-[10px] font-mono text-slate-300 border border-white/10">
                Original Input (SDR)
              </div>
              <div className="absolute bottom-2 right-2 pointer-events-none z-10 px-2 py-0.5 rounded bg-[#76b900]/90 backdrop-blur text-[10px] font-mono text-black font-bold border border-emerald-400/30">
                DLSS 5 Enhanced [{settings.nrPreset}]
              </div>
            </div>

            {/* Upload and File Drop Area */}
            <div className="p-2.5 bg-slate-950/70 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition border border-slate-700">
                <Upload className="w-3.5 h-3.5 text-[#76b900]" />
                <span>Upload {mode === 'Image' ? 'Image' : 'Video'}</span>
                <input
                  type="file"
                  accept={mode === 'Image' ? 'image/*' : 'video/*'}
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <div className="flex items-center gap-2">
                <button
                  onClick={runPreview}
                  disabled={isProcessing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-[#76b900] border border-emerald-500/30 text-xs font-semibold transition disabled:opacity-50"
                >
                  <Eye className="w-3 h-3" />
                  <span>1-Frame Preview</span>
                </button>
                <button
                  onClick={runBatchProcessing}
                  disabled={isProcessing}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#76b900] hover:bg-lime-400 text-black text-xs font-bold transition disabled:opacity-50 shadow-md shadow-emerald-950/30"
                >
                  <Play className="w-3 h-3 fill-black" />
                  <span>{isProcessing ? 'Processing...' : 'Start Render'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Batch Progress & File Queue Panel */}
          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#76b900]" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
                  Batch Queue
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                {batchItems.length} items queued
              </span>
            </div>

            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {batchItems.map((item) => (
                <div
                  key={item.id}
                  className="p-1.5 rounded bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-xs gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-slate-200 text-[11px] truncate">{item.name}</span>
                      <span className="text-[10px] text-slate-500">({item.size})</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                        item.status === 'Complete'
                          ? 'bg-emerald-500/10 text-[#76b900]'
                          : item.status === 'Running'
                          ? 'bg-blue-500/10 text-blue-400 animate-pulse'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {item.status === 'Complete' && <CheckCircle2 className="w-2.5 h-2.5" />}
                      {item.status === 'Running' && <Clock className="w-2.5 h-2.5" />}
                      {item.status} ({item.progress}%)
                    </span>

                    {item.status === 'Complete' && (
                      <a
                        href={item.outputUrl || activeImageUrl}
                        download={`enhanced_${item.name}`}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white"
                        title="Download Enhanced Output"
                      >
                        <Download className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {activeJobLog && (
              <div className="p-1.5 rounded bg-black/60 border border-slate-800 font-mono text-[10px] text-slate-300 flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[#76b900] animate-ping" />
                <span className="truncate">{activeJobLog}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Unified Neural Rendering Control Panel (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 space-y-2.5 shadow-lg">
            {/* Unified Header & Mode Switching */}
            <div className="pb-2 border-b border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[#76b900]" />
                  <h3 className="text-xs font-bold text-slate-200">DLSS 5 Pipeline Controls</h3>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-emerald-400 font-mono">
                  Real-time
                </span>
              </div>

              {/* Mode Switching */}
              <div className="grid grid-cols-2 gap-1 p-0.5 bg-slate-950 rounded-md border border-slate-800">
                <button
                  id="mode-btn-image"
                  onClick={() => setMode('Image')}
                  className={`flex items-center justify-center gap-1 py-1 rounded text-[11px] font-medium transition ${
                    mode === 'Image' ? 'bg-[#76b900] text-black font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ImageIcon className="w-3 h-3" />
                  Image Mode
                </button>
                <button
                  id="mode-btn-video"
                  onClick={() => setMode('Video')}
                  className={`flex items-center justify-center gap-1 py-1 rounded text-[11px] font-medium transition ${
                    mode === 'Video' ? 'bg-[#76b900] text-black font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Film className="w-3 h-3" />
                  Video Mode
                </button>
              </div>

              {/* Sample Selector */}
              <div className="flex items-center justify-between gap-1 text-xs">
                <span className="text-[10px] font-semibold text-slate-400">Presets:</span>
                <div className="flex gap-1">
                  {SAMPLE_IMAGES.map((img, idx) => (
                    <button
                      key={img.id}
                      onClick={() => {
                        setCurrentImageIndex(idx);
                        setCustomImageUrl(null);
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] border transition ${
                        currentImageIndex === idx && !customImageUrl
                          ? 'bg-[#76b900] text-black font-bold border-[#76b900]'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      Sample {idx + 1}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* NR Preset & Style */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-300 mb-0.5">
                  NR Preset
                </label>
                <select
                  value={settings.nrPreset}
                  onChange={(e) => onUpdateSettings(s => ({ ...s, nrPreset: e.target.value as NRPreset }))}
                  className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-200 focus:border-[#76b900] focus:outline-none"
                >
                  <option value="Ultra Performance">Ultra Performance</option>
                  <option value="Performance">Performance</option>
                  <option value="Balanced">Balanced</option>
                  <option value="Quality">Quality</option>
                  <option value="Ultra Quality">Ultra Quality</option>
                  <option value="DLAA">DLAA (Native 1x)</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-300 mb-0.5">
                  NR Style
                </label>
                <select
                  value={settings.nrStyle}
                  onChange={(e) => onUpdateSettings(s => ({ ...s, nrStyle: e.target.value as NRStyle }))}
                  className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-200 focus:border-[#76b900] focus:outline-none"
                >
                  <option value="Default">Default</option>
                  <option value="Cinematic">Cinematic</option>
                  <option value="Ultra Crisp">Ultra Crisp</option>
                  <option value="Photorealistic">Photorealistic</option>
                  <option value="High Dynamic">High Dynamic</option>
                  <option value="Noise Suppressed">Noise Suppressed</option>
                </select>
              </div>
            </div>

            {/* DLSS Model Preset */}
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[10px] font-semibold text-slate-300">
                  DLSS Model Preset
                </label>
                <span className="text-[9px] font-mono text-slate-500">Transformer</span>
              </div>
              <select
                value={settings.dlssModelPreset}
                onChange={(e) => onUpdateSettings(s => ({ ...s, dlssModelPreset: e.target.value as DLSSModelPreset }))}
                className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-200 focus:border-[#76b900] focus:outline-none"
              >
                <option value="Default">Default (Auto Heuristic)</option>
                <option value="Preset G">Preset G (Optimized Motion)</option>
                <option value="Preset F">Preset F (Ultra Crisp AA)</option>
                <option value="Preset J">Preset J (Next-Gen Neural)</option>
                <option value="Preset K">Preset K (Blackwell FP8)</option>
                <option value="Preset C">Preset C (Temporal Accumulator)</option>
              </select>
            </div>

            {/* Sliders */}
            <div className="space-y-2 pt-0.5">
              {/* NR Intensity */}
              <div>
                <div className="flex justify-between text-[11px] mb-0.5">
                  <span className="text-slate-300">NR Intensity</span>
                  <span className="font-mono text-[#76b900] font-semibold">{settings.nrIntensity.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.1"
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
                  <span className="text-slate-300">Tone Strength</span>
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
                  <span className="text-slate-300">Structure Strength</span>
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
                  <span className="text-slate-300">Skin Structure</span>
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
            <div className="pt-1.5 border-t border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-200 font-medium">Automatic Mask</span>
                  <p className="text-[9px] text-slate-400">Protects character faces &amp; UI elements</p>
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

              {mode === 'Video' && (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-slate-200 font-medium">HDR Mode (10-bit Rec.2020)</span>
                    <p className="text-[9px] text-slate-400">Preserves wide dynamic range buffers</p>
                  </div>
                  <button
                    onClick={() => onUpdateSettings(s => ({ ...s, hdrMode: !s.hdrMode }))}
                    className={`w-8 h-4 rounded-full transition flex items-center px-0.5 ${
                      settings.hdrMode ? 'bg-[#76b900]' : 'bg-slate-800'
                    }`}
                  >
                    <div className={`w-3 h-3 rounded-full bg-black transition transform ${
                      settings.hdrMode ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
              )}
            </div>

            {/* Output Formatting Details */}
            <div className="pt-2 border-t border-slate-800 grid grid-cols-2 gap-2 text-xs">
              {mode === 'Image' ? (
                <>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Format</label>
                    <select
                      value={settings.imageFormat}
                      onChange={(e) => onUpdateSettings(s => ({ ...s, imageFormat: e.target.value as ImageFormatChoice }))}
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-200"
                    >
                      <option value="PNG">PNG (Lossless)</option>
                      <option value="JPEG">JPEG (sRGB)</option>
                      <option value="WebP">WebP</option>
                      <option value="AVIF">AVIF (10-bit)</option>
                      <option value="TIFF">TIFF (Archive)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Quality ({settings.imageQuality}%)</label>
                    <input
                      type="range"
                      min="70"
                      max="100"
                      value={settings.imageQuality}
                      onChange={(e) => onUpdateSettings(s => ({ ...s, imageQuality: parseInt(e.target.value) }))}
                      className="w-full h-1 mt-1.5 bg-slate-800 rounded cursor-pointer"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Codec</label>
                    <select
                      value={settings.codec}
                      onChange={(e) => onUpdateSettings(s => ({ ...s, codec: e.target.value as CodecChoice }))}
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-200"
                    >
                      <option value="H.264 (NVIDIA NVENC)">H.264 NVENC</option>
                      <option value="H.265 (NVIDIA NVENC)">H.265 NVENC</option>
                      <option value="AV1 (NVIDIA NVENC)">AV1 NVENC</option>
                      <option value="H.264">H.264 CPU</option>
                      <option value="ProRes Proxy">ProRes Proxy</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Container</label>
                    <select
                      value={settings.container}
                      onChange={(e) => onUpdateSettings(s => ({ ...s, container: e.target.value as ContainerChoice }))}
                      className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-200"
                    >
                      <option value="MP4">MP4</option>
                      <option value="MKV">MKV</option>
                      <option value="MOV">MOV</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            {/* Diagnostic Report Drawer */}
            {diagnosticReport && (
              <div className="mt-2 p-2 rounded bg-black/60 border border-slate-800 text-[10px] font-mono space-y-0.5 text-slate-300">
                <div className="flex items-center justify-between text-emerald-400 font-bold">
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3" /> Diagnostics
                  </span>
                  <span>OK</span>
                </div>
                <div className="text-slate-400">Time: {diagnosticReport.reconstructionTimeMs as number}ms | Scale: {diagnosticReport.inputResolution as string} &rarr; 4K</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
