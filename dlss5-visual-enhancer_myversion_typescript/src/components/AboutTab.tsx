import React from 'react';
import { Box, Film, Layers, Radio, ShieldCheck, Sparkles, Zap } from 'lucide-react';

export const AboutTab: React.FC = () => (
  <div className="max-w-5xl mx-auto space-y-4 py-1">
    <div className="text-center space-y-1.5">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-[#76b900] to-emerald-700 shadow-md shadow-emerald-950/40"><Zap className="w-5 h-5 fill-black stroke-black" /></div>
      <h2 className="text-lg font-extrabold text-slate-100 tracking-tight">DLSS 5 <span className="text-[#76b900]">Visual Enhancer</span></h2>
      <p className="text-[11px] font-mono text-emerald-400">TypeScript Primary UI · Python/Native Runtime Backend · MIT License</p>
      <p className="text-xs text-slate-400 max-w-2xl mx-auto leading-relaxed">The React/TypeScript application is now the main interface. Media and model jobs are sent to a local FastAPI bridge that reuses the existing verified NVIDIA native workers, FFmpeg/NVENC/NVDEC paths, settings validator, preset format and Blender 3D renderer.</p>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
      {[
        [Sparkles, 'DLSS 5 Neural Rendering', 'Signed feature-18 image/video processing with the real NR presets, styles, DLSS scaling modes and J/K/L/M model overrides.'],
        [Layers, 'RTX Video Upscale', 'RTX Video Super Resolution quality 1–4, native-resolution enhancement, scaling/custom sizing and RTX Video HDR.'],
        [Film, 'DLSS Frame Generation', 'Native DLSSG and Cascade frame interpolation with the actual runtime-supported target frame rates and output codecs.'],
        [Radio, 'Live + 3D', 'Unified Realtime/Buffered post-DLSS playback plus a persistent Blender-backed live 3D viewport processed through feature 18.'],
      ].map(([Icon, title, text]) => {
        const Glyph = Icon as React.ComponentType<{ className?: string }>;
        return <div key={String(title)} className="p-3 rounded-lg bg-slate-900/70 border border-slate-800 space-y-1.5"><div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-[#76b900]"><Glyph className="w-3.5 h-3.5" /></div><h3 className="text-xs font-bold text-slate-200">{String(title)}</h3><p className="text-[11px] text-slate-400 leading-relaxed">{String(text)}</p></div>;
      })}
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2"><h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5"><Box className="w-3.5 h-3.5 text-[#76b900]" />3D architecture</h3><p className="text-[11px] text-slate-400 leading-relaxed">The enhanced 3D viewer is live and interactive, but it is not advertised as a zero-copy game-engine swapchain. The bundled native feature-18 worker still exchanges host RGBA/motion buffers, so fully GPU-resident D3D12 texture-in/texture-out presentation would require a native worker interface change.</p></div>
      <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2"><h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-[#76b900]" />Runtime truth</h3><p className="text-[11px] text-slate-400 leading-relaxed">GPU identities and supported parameter choices are loaded from the Python runtime at startup. The TypeScript UI no longer invents GPU models, architecture modes, DLSS presets or simulated render timings.</p></div>
    </div>

    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-[10px] text-slate-400 space-y-1"><h4 className="font-bold text-slate-300 uppercase tracking-wider">Acknowledgements & Legal</h4><p className="leading-relaxed">This is an independent community project and is not affiliated with, sponsored by, or endorsed by NVIDIA, ReShade, RenoDX, FFmpeg, Blender or their contributors. NVIDIA, GeForce, RTX, DLSS and NVENC are trademarks or registered trademarks of NVIDIA Corporation.</p></div>
  </div>
);
