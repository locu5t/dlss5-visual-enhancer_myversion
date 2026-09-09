import React from 'react';
import { TabId, UISettings, GPUInfo } from '../types';
import { Activity, Box, Cpu, Film, Info, Layers, Radio, Settings, Sparkles, Zap } from 'lucide-react';

interface NavbarProps {
  currentTab: TabId;
  onSelectTab: (tab: TabId) => void;
  settings: UISettings;
  gpus: GPUInfo[];
  isRendering: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onSelectTab, settings, gpus, isRendering }) => {
  const activeGpu = gpus.find((gpu) => gpu.id === settings.aiGpuId) || gpus[0];
  const navItems: { id: TabId; label: string; icon: React.ReactNode; badge?: string }[] = [
    { id: 'neural-rendering', label: 'Neural Rendering', icon: <Sparkles className="w-4 h-4" />, badge: 'DLSS 5' },
    { id: 'upscale', label: 'Upscale', icon: <Layers className="w-4 h-4" />, badge: 'RTX Video' },
    { id: 'frame-interpolation', label: 'Frame Interpolation', icon: <Film className="w-4 h-4" />, badge: 'DLSSG' },
    { id: 'live', label: 'Live', icon: <Radio className="w-4 h-4" /> },
    { id: 'model-viewer', label: '3D Viewer', icon: <Box className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
    { id: 'about', label: 'About', icon: <Info className="w-4 h-4" /> },
  ];

  return (
    <header className="sticky top-0 z-50 bg-[#0d131f]/95 backdrop-blur border-b border-slate-800/80">
      <div className="max-w-[1600px] mx-auto px-3 sm:px-5 flex items-center justify-between gap-2 py-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 shrink-0 rounded-md bg-gradient-to-br from-[#76b900] to-emerald-600 flex items-center justify-center shadow-md shadow-emerald-950/40 text-black">
            <Zap className="w-4 h-4 fill-black stroke-black" />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="font-extrabold text-sm sm:text-base text-slate-100 tracking-tight leading-none whitespace-nowrap">DLSS 5 <span className="text-[#76b900]">Visual Enhancer</span></h1>
            <span className="hidden md:inline text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-[#76b900] border border-emerald-500/20">TypeScript UI</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRendering && <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[11px] font-mono"><Activity className="w-3 h-3 animate-spin" /><span>Pipeline Active</span></div>}
          {activeGpu && <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/80 border border-slate-800 text-[10px] font-mono text-slate-300"><Cpu className="w-3 h-3 text-[#76b900]" /><span>{activeGpu.name.replace('NVIDIA GeForce ', '')}</span>{activeGpu.vram && <><span className="text-slate-700">·</span><span className="text-emerald-400">{activeGpu.vram}</span></>}</div>}
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-3 sm:px-5">
        <nav className="flex space-x-1 overflow-x-auto no-scrollbar border-t border-slate-800/40 pt-0.5">
          {navItems.map((item) => {
            const active = currentTab === item.id;
            return <button key={item.id} onClick={() => onSelectTab(item.id)} className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-t-md transition-all border-b-2 whitespace-nowrap ${active ? 'bg-slate-800/70 text-[#76b900] border-[#76b900] font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border-transparent'}`}>{item.icon}<span>{item.label}</span>{item.badge && <span className={`text-[8px] px-1 py-0.5 rounded font-mono font-bold uppercase ${active ? 'bg-[#76b900]/20 text-[#76b900]' : 'bg-slate-800 text-slate-600'}`}>{item.badge}</span>}</button>;
          })}
        </nav>
      </div>
    </header>
  );
};
