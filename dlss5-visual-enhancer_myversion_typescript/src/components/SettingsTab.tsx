import React, { useState } from 'react';
import { UISettings, GPUInfo, DLSSArchitecture, PreviewEncodingChoice } from '../types';
import { 
  Settings, 
  Cpu, 
  HardDrive, 
  RotateCcw, 
  Download, 
  Upload, 
  Terminal, 
  ShieldCheck, 
  Sparkles,
  Film,
  Radio,
  FileCode2,
  Zap,
  Info
} from 'lucide-react';

interface SettingsTabProps {
  settings: UISettings;
  onUpdateSettings: (updater: (prev: UISettings) => UISettings) => void;
  gpus: GPUInfo[];
  onResetSettings: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  onUpdateSettings,
  gpus,
  onResetSettings,
}) => {
  const [copiedPreset, setCopiedPreset] = useState(false);
  const [activeSection, setActiveSection] = useState<'all' | 'hardware' | 'architecture'>('all');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    '[INIT] NVIDIA Driver 560.81 WHQL detected.',
    '[CUDA] Initializing CUDA 12.6 runtime context on GPU 0 (AD102).',
    '[DLSS] dlss_5_neural_rendering.dll v5.0.18 initialized.',
    '[DLSS-G] Optical Flow Accelerator initialized in Bidirectional Mode.',
    '[FFMPEG] Hardware NVENC H.264/H.265/AV1 encoders verified.',
    '[HAGS] Hardware-Accelerated GPU Scheduling is ENABLED and ACTIVE.',
    '[READY] DLSS 5 Visual Enhancer pipeline listening for job dispatch.',
  ]);

  const activeGpu = gpus.find(g => g.id === settings.aiGpuId) || gpus[0];

  const handleExportPreset = () => {
    const jsonStr = JSON.stringify(settings, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dlss5_settings_preset.json';
    a.click();
    setCopiedPreset(true);
    setTimeout(() => setCopiedPreset(false), 2000);
  };

  const handleImportPreset = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        onUpdateSettings(() => ({ ...settings, ...imported }));
        setTerminalLogs(prev => [...prev, `[CONFIG] Successfully imported settings preset from ${file.name}`]);
      } catch (err) {
        console.error('Invalid preset JSON', err);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-3">
      {/* Top Header */}
      <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-[#76b900]">
            <Settings className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="text-xs sm:text-sm font-bold text-slate-100">System, Hardware &amp; Architecture</h2>
              <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/20 text-[#76b900] text-[9px] font-mono font-bold">
                UNIFIED CONTROL CENTER
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              GPU allocation, DLSS runtime configuration, architecture specifications, presets, and diagnostics
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* View Filter */}
          <div className="inline-flex rounded bg-slate-950 p-0.5 border border-slate-800 text-[11px]">
            <button
              onClick={() => setActiveSection('all')}
              className={`px-2 py-0.5 rounded transition ${
                activeSection === 'all' ? 'bg-[#76b900] text-black font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Panels
            </button>
            <button
              onClick={() => setActiveSection('hardware')}
              className={`px-2 py-0.5 rounded transition ${
                activeSection === 'hardware' ? 'bg-[#76b900] text-black font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Hardware &amp; Logs
            </button>
            <button
              onClick={() => setActiveSection('architecture')}
              className={`px-2 py-0.5 rounded transition ${
                activeSection === 'architecture' ? 'bg-[#76b900] text-black font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Architecture &amp; Specs
            </button>
          </div>

          <button
            onClick={onResetSettings}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Defaults</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* Left: Hardware GPU & Diagnostics (7 cols) */}
        {(activeSection === 'all' || activeSection === 'hardware') && (
          <div className={`${activeSection === 'hardware' ? 'lg:col-span-12' : 'lg:col-span-7'} space-y-3`}>
            {/* GPU & Runtime Settings Panel */}
            <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 space-y-3">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 pb-2 border-b border-slate-800">
                <Cpu className="w-3.5 h-3.5 text-[#76b900]" />
                <span>NVIDIA GPU Hardware Allocation</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* AI Processing GPU */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    AI Processing GPU (DLSS &amp; Frame Gen)
                  </label>
                  <select
                    value={settings.aiGpuId}
                    onChange={(e) => onUpdateSettings(s => ({ ...s, aiGpuId: e.target.value }))}
                    className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-[#76b900] focus:outline-none"
                  >
                    {gpus.map((gpu) => (
                      <option key={gpu.id} value={gpu.id}>
                        {gpu.name} &mdash; {gpu.vram}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Video Processing GPU */}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Video Processing GPU (NVENC Encoder)
                  </label>
                  <select
                    value={settings.videoGpuId}
                    onChange={(e) => onUpdateSettings(s => ({ ...s, videoGpuId: e.target.value }))}
                    className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-[#76b900] focus:outline-none"
                  >
                    {gpus.map((gpu) => (
                      <option key={gpu.id} value={gpu.id}>
                        {gpu.name} &mdash; Dual 8th Gen NVENC
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Active GPU Hardware Specs Badge */}
              <div className="p-2.5 rounded bg-slate-950 border border-slate-800 space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/80">
                  <span className="text-[#76b900] font-bold">{activeGpu.name}</span>
                  <span className="flex items-center gap-1 text-emerald-400 text-[11px]">
                    <ShieldCheck className="w-3 h-3" /> Ready &middot; HAGS Active
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px] text-slate-400">
                  <div>Arch: <span className="text-slate-200">{activeGpu.arch}</span></div>
                  <div>VRAM: <span className="text-slate-200">{activeGpu.vram}</span></div>
                  <div>Driver: <span className="text-slate-200">{activeGpu.driver}</span></div>
                  <div>Tensor Cores: <span className="text-slate-200">{activeGpu.tensorCores}</span></div>
                </div>
              </div>

              {/* DLSS 5 Architecture Build */}
              <div className="pt-2 border-t border-slate-800">
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  DLSS 5 Architecture Runtime Build
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['Auto', 'Turing+', 'Ada Lovelace+', 'Blackwell+'] as DLSSArchitecture[]).map((arch) => (
                    <button
                      key={arch}
                      onClick={() => onUpdateSettings(s => ({ ...s, dlssArchitecture: arch }))}
                      className={`py-1 rounded text-xs font-semibold transition border ${
                        settings.dlssArchitecture === arch
                          ? 'bg-[#76b900] text-black border-[#76b900] font-bold'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {arch}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview Encoding */}
              <div className="pt-2 border-t border-slate-800">
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Preview Encoding Acceleration
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['Auto', 'Always H.264', 'Disabled'] as PreviewEncodingChoice[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => onUpdateSettings(s => ({ ...s, previewEncoding: mode }))}
                      className={`py-1 rounded text-xs font-semibold transition border ${
                        settings.previewEncoding === mode
                          ? 'bg-emerald-500/20 text-[#76b900] border-emerald-500/40 font-bold'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Diagnostic Terminal Log Console */}
            <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 space-y-1.5">
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-[#76b900]" />
                  <span>Real-Time Diagnostic Terminal Console</span>
                </h3>
                <span className="w-2 h-2 rounded-full bg-[#76b900] animate-pulse" />
              </div>

              <div className="p-2 rounded bg-black font-mono text-[9px] text-emerald-400/90 max-h-40 overflow-y-auto space-y-0.5">
                {terminalLogs.map((log, idx) => (
                  <div key={idx} className="leading-tight">
                    <span className="text-slate-600 mr-1">&gt;</span>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Right: Architecture Specs, Presets & About Info (5 cols) */}
        {(activeSection === 'all' || activeSection === 'architecture') && (
          <div className={`${activeSection === 'architecture' ? 'lg:col-span-12' : 'lg:col-span-5'} space-y-3`}>
            {/* Hardware Architecture Compatibility Specs */}
            <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 space-y-2">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 pb-1.5 border-b border-slate-800">
                <Info className="w-3.5 h-3.5 text-[#76b900]" />
                <span>Architecture &amp; Silicon Compatibility</span>
              </h3>

              <div className="space-y-1.5 text-xs">
                <div className="p-2 rounded bg-slate-950 border border-slate-800/80">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-bold text-[#76b900] text-xs">Blackwell (RTX 50 Series)</span>
                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-400">FP8 Native</span>
                  </div>
                  <p className="text-slate-400 text-[10px] leading-relaxed">
                    Native FP8 Tensor execution, DLSS 5 Transformer Model Preset K, 640+ Tensor Cores with zero-bubble scheduling.
                  </p>
                </div>

                <div className="p-2 rounded bg-slate-950 border border-slate-800/80">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-bold text-slate-200 text-xs">Ada Lovelace (RTX 40 Series)</span>
                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-300">4th Gen Tensor</span>
                  </div>
                  <p className="text-slate-400 text-[10px] leading-relaxed">
                    4th Gen Tensor Cores, Dual 8th Gen NVENC AV1/HEVC encoders, Optical Flow Accelerator for bi-directional frame synthesis.
                  </p>
                </div>

                <div className="p-2 rounded bg-slate-950 border border-slate-800/80">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-bold text-slate-400 text-xs">Ampere / Turing (RTX 30/20)</span>
                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-400">VSR 1-4</span>
                  </div>
                  <p className="text-slate-400 text-[10px] leading-relaxed">
                    DLSS Super Resolution, DLAA, RTX Video Super Resolution (VSR Level 1-4), software optical flow fallback.
                  </p>
                </div>
              </div>
            </div>

            {/* DLSS 5 Technology Innovations */}
            <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 space-y-2">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 pb-1.5 border-b border-slate-800">
                <Zap className="w-3.5 h-3.5 text-[#76b900]" />
                <span>DLSS 5 Technology Suite</span>
              </h3>

              <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                <div className="p-1.5 rounded bg-slate-950 border border-slate-800/70 text-center space-y-0.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#76b900] mx-auto" />
                  <span className="font-bold text-slate-200 block">Neural Render</span>
                  <span className="text-slate-400 text-[9px] block">Edge Synthesis</span>
                </div>
                <div className="p-1.5 rounded bg-slate-950 border border-slate-800/70 text-center space-y-0.5">
                  <Film className="w-3.5 h-3.5 text-[#76b900] mx-auto" />
                  <span className="font-bold text-slate-200 block">Frame Gen</span>
                  <span className="text-slate-400 text-[9px] block">Up to 480 FPS</span>
                </div>
                <div className="p-1.5 rounded bg-slate-950 border border-slate-800/70 text-center space-y-0.5">
                  <Radio className="w-3.5 h-3.5 text-[#76b900] mx-auto" />
                  <span className="font-bold text-slate-200 block">VSR &amp; Live</span>
                  <span className="text-slate-400 text-[9px] block">Real-Time</span>
                </div>
              </div>
            </div>

            {/* Preset Management */}
            <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3 space-y-2">
              <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 pb-1.5 border-b border-slate-800">
                <HardDrive className="w-3.5 h-3.5 text-[#76b900]" />
                <span>Preset Backup &amp; Configuration</span>
              </h3>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={handleExportPreset}
                  className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                >
                  <Download className="w-3 h-3 text-[#76b900]" />
                  <span>{copiedPreset ? 'Exported!' : 'Export JSON'}</span>
                </button>

                <label className="cursor-pointer flex items-center justify-center gap-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition">
                  <Upload className="w-3 h-3 text-sky-400" />
                  <span>Import JSON</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportPreset}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Build Information & Legal Disclaimers */}
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 text-[10px] text-slate-400 space-y-1">
              <div className="flex items-center justify-between font-mono text-slate-300 pb-1 border-b border-slate-800/60">
                <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                  <FileCode2 className="w-3 h-3" /> DLSS 5 Visual Enhancer v5.0.18-NR
                </span>
                <span>MIT License</span>
              </div>
              <p className="leading-relaxed text-[9px] text-slate-500">
                Independent community development. Not affiliated with or endorsed by NVIDIA Corporation. NVIDIA, GeForce, RTX, DLSS, and NVENC are trademarks of NVIDIA Corporation.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

