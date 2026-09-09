import React from 'react';
import { TabId, UISettings, GPUInfo } from '../types';
import { 
  Sparkles, 
  Layers, 
  Film, 
  Tv, 
  Box, 
  Settings, 
  Info, 
  Cpu, 
  Activity,
  Zap
} from 'lucide-react';

interface NavbarProps {
  currentTab: TabId;
  onSelectTab: (tab: TabId) => void;
  settings: UISettings;
  gpus: GPUInfo[];
  isRendering: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onSelectTab,
  settings,
  gpus,
  isRendering,
}) => {
  const activeGpu = gpus.find(g => g.id === settings.aiGpuId) || gpus[0];

  const navItems: { id: TabId; label: string; icon: React.ReactNode; badge?: string }[] = [
    { id: 'neural-rendering', label: 'Neural Rendering', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'upscale', label: 'Upscale & Live Video', icon: <Layers className="w-4 h-4" />, badge: 'VSR+Live' },
    { id: 'frame-interpolation', label: 'Frame Interpolation', icon: <Film className="w-4 h-4" /> },
    { id: 'model-viewer', label: '3D Model Viewer', icon: <Box className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings & Architecture', icon: <Settings className="w-4 h-4" />, badge: 'Specs' },
  ];


  return (
    <header className="sticky top-0 z-50 bg-[#0d131f]/95 backdrop-blur border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-3 sm:px-5 flex items-center justify-between gap-2 py-2">
        {/* Logo & Title */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[#76b900] to-emerald-600 flex items-center justify-center shadow-md shadow-emerald-950/40 text-black font-black text-sm">
            <Zap className="w-4 h-4 fill-black stroke-black" />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="font-extrabold text-sm sm:text-base text-slate-100 tracking-tight leading-none">
              DLSS 5 <span className="text-[#76b900]">Visual Enhancer</span>
            </h1>
            <span className="text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded bg-emerald-500/10 text-[#76b900] border border-emerald-500/20">
              v5.0-NR
            </span>
          </div>
        </div>

        {/* System & GPU status pill */}
        <div className="flex items-center gap-2">
          {isRendering && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-[11px] font-mono animate-pulse">
              <Activity className="w-3 h-3 animate-spin" />
              <span>Pipeline Active</span>
            </div>
          )}

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-900/80 border border-slate-800 text-[11px] font-mono text-slate-300">
            <Cpu className="w-3 h-3 text-[#76b900]" />
            <span className="text-slate-400">GPU:</span>
            <span className="font-semibold text-slate-200">{activeGpu.name.replace('NVIDIA GeForce ', '')}</span>
            <span className="text-slate-600">|</span>
            <span className="text-emerald-400">{activeGpu.arch.split(' ')[0]}</span>
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="max-w-7xl mx-auto px-3 sm:px-5">
        <nav className="flex space-x-1 overflow-x-auto no-scrollbar border-t border-slate-800/40 pt-0.5">
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                id={`tab-btn-${item.id}`}
                onClick={() => onSelectTab(item.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-t-md transition-all border-b-2 whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-800/70 text-[#76b900] border-[#76b900] font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border-transparent'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.badge && (
                  <span className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold uppercase transition ${
                    isActive ? 'bg-[#76b900]/20 text-[#76b900]' : 'bg-slate-800 text-slate-500 group-hover:text-slate-300'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
