import React from 'react';
import { 
  Info, 
  ExternalLink, 
  ShieldCheck, 
  Zap, 
  Cpu, 
  Layers, 
  Sparkles, 
  Film, 
  Radio, 
  Box
} from 'lucide-react';

export const AboutTab: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto space-y-4 py-1">
      {/* Hero Header */}
      <div className="text-center space-y-1.5">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-[#76b900] to-emerald-700 shadow-md shadow-emerald-950/40">
          <Zap className="w-5 h-5 fill-black stroke-black" />
        </div>
        <h2 className="text-lg font-extrabold text-slate-100 tracking-tight">
          DLSS 5 <span className="text-[#76b900]">Visual Enhancer</span>
        </h2>
        <p className="text-[11px] font-mono text-emerald-400">
          Build v5.0.18-NR &middot; Modern Web Edition &middot; MIT License
        </p>
        <p className="text-xs text-slate-400 max-w-xl mx-auto leading-relaxed">
          Community visual enhancement suite integrating DLSS 5 Neural Rendering pipelines, NVIDIA DLSS Frame Generation (DLSS-G), RTX Video Super Resolution, and live video acceleration.
        </p>
      </div>

      {/* Feature Capabilities Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
          <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-[#76b900]">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <h3 className="text-xs font-bold text-slate-200">DLSS 5 Neural Rendering</h3>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Multi-stage neural detail synthesis, local tone adaptation, unsharp masking, and high-frequency edge recovery.
          </p>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
          <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-[#76b900]">
            <Film className="w-3.5 h-3.5" />
          </div>
          <h3 className="text-xs font-bold text-slate-200">DLSS Frame Generation</h3>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Bi-directional optical flow acceleration interpolates intermediate frames for silky-smooth motion up to 480 FPS.
          </p>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5">
          <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-[#76b900]">
            <Radio className="w-3.5 h-3.5" />
          </div>
          <h3 className="text-xs font-bold text-slate-200">Live Video Acceleration</h3>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Real-time neural enhancement for video playback and YouTube URLs with live shader tuning.
          </p>
        </div>
      </div>

      {/* Hardware Architecture Requirements */}
      <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2">
        <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-[#76b900]" />
          <span>Hardware &amp; Architecture Compatibility</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80">
            <span className="font-bold text-[#76b900] block mb-0.5 text-xs">Blackwell (RTX 50 Series)</span>
            <p className="text-slate-400 text-[10px]">
              Full native FP8 Tensor execution, DLSS 5 Transformer Model Preset K, 640+ Tensor Cores.
            </p>
          </div>
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80">
            <span className="font-bold text-slate-200 block mb-0.5 text-xs">Ada Lovelace (RTX 40 Series)</span>
            <p className="text-slate-400 text-[10px]">
              4th Gen Tensor Cores, Dual 8th Gen NVENC encoders, Hardware Optical Flow Accelerator.
            </p>
          </div>
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80">
            <span className="font-bold text-slate-400 block mb-0.5 text-xs">Ampere / Turing (RTX 30/20)</span>
            <p className="text-slate-400 text-[10px]">
              DLSS Super Resolution &amp; DLAA supported, VSR Level 1-4, software optical flow fallback.
            </p>
          </div>
        </div>
      </div>

      {/* Acknowledgements & Legal */}
      <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-[10px] text-slate-400 space-y-1">
        <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">
          Acknowledgements &amp; Legal Notices
        </h4>
        <p className="text-[10px] leading-relaxed">
          This project is an independent community development and is not affiliated with, sponsored by, or endorsed by NVIDIA Corporation. NVIDIA, GeForce, RTX, DLSS, and NVENC are trademarks or registered trademarks of NVIDIA Corporation.
        </p>
      </div>
    </div>
  );
};
