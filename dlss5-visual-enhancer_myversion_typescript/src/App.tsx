import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { backend } from './api/backend';
import { AboutTab } from './components/AboutTab';
import { Navbar } from './components/Navbar';
import { FrameRuntimeTab } from './components/runtime/FrameRuntimeTab';
import { LiveRuntimeTab } from './components/runtime/LiveRuntimeTab';
import { ModelRuntimeTab } from './components/runtime/ModelRuntimeTab';
import { NeuralRuntimeTab } from './components/runtime/NeuralRuntimeTab';
import { SettingsRuntimeTab } from './components/runtime/SettingsRuntimeTab';
import { UpscaleRuntimeTab } from './components/runtime/UpscaleRuntimeTab';
import { DEFAULT_SETTINGS, DETECTED_GPUS } from './data/defaults';
import { BootstrapPayload, GPUInfo, RuntimeChoices, TabId, UISettings } from './types';

const FALLBACK_CHOICES: RuntimeChoices = {
  nrPresets: ['Default', 'Preset #1', 'Preset #2', 'Preset #3'],
  nrStyles: ['Default', 'Natural', 'Cinematic'],
  dlssModelPresets: ['Default', 'J', 'K', 'L', 'M'],
  dlssUpscaling: [
    { value: 1, label: '1× (DLAA / native)', name: 'DLAA' },
    { value: 1.5, label: '1.5× (Quality)', name: 'Quality' },
    { value: 1.724, label: '1.724× (Balanced)', name: 'Balanced' },
    { value: 2, label: '2× (Performance)', name: 'Performance' },
    { value: 3, label: '3× (Ultra Performance)', name: 'Ultra Performance' },
  ],
  codecs: ['H.264', 'H.264 (NVIDIA NVENC)', 'H.265', 'H.265 (NVIDIA NVENC)', 'AV1', 'AV1 (NVIDIA NVENC)', 'ProRes Proxy'],
  containers: ['MP4', 'MKV', 'MOV'],
  qualities: ['Auto (Default)', 'Good', 'Best', 'Max'],
  imageFormats: ['PNG', 'JPEG', 'WebP', 'AVIF', 'TIFF'],
  previewEncoding: ['Auto', 'Always H.264', 'Disabled'],
  renameModes: ['Auto', 'Copy', 'Custom'],
  hdrCodecs: ['H.265', 'H.265 (NVIDIA NVENC)', 'AV1', 'AV1 (NVIDIA NVENC)', 'ProRes Proxy'],
  frameFps: ['23.976', '25', '29.97', '30', '50', '59.94', '60', '90', '119.88', '120', '144', '165', '180', '240', '360', '480'],
  frameEngines: ['Auto', 'Native DLSSG', 'Cascade'],
  vsrQualities: [{ label: '1 - Low', value: 1 }, { label: '2 - Medium', value: 2 }, { label: '3 - High', value: 3 }, { label: '4 - Ultra', value: 4 }],
  rtxScaleFactors: [{ label: '1×', value: 1 }, { label: '1.5×', value: 1.5 }, { label: '2×', value: 2 }, { label: '3×', value: 3 }, { label: '4×', value: 4 }],
  sizeModes: ['Scale factor', 'Custom dimensions'],
  hdrPrecisions: [{ label: 'Packed 10-bit', value: 'Packed 10-bit' }, { label: 'Packed 10-bit (FP16)', value: 'FP16' }],
  liveSourceQuality: ['Auto', '480', '720', '1080', '1440', '2160'],
  liveMaxHeights: [480, 720, 1080, 1440, 2160],
  liveFps: ['Auto', 'Source', '60', '30', '24'],
  liveGuideQuality: ['Fast', 'Quality'],
  liveSegments: [1, 2, 4],
  modelLiveResolutions: ['540p', '720p', '1080p'],
};

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<TabId>('neural-rendering');
  const [settings, setSettings] = useState<UISettings>(DEFAULT_SETTINGS);
  const [choices, setChoices] = useState<RuntimeChoices>(FALLBACK_CHOICES);
  const [gpus, setGpus] = useState<GPUInfo[]>(DETECTED_GPUS);
  const [runtime, setRuntime] = useState({ ready: false, error: 'Checking native runtime…' });
  const [modelViewer, setModelViewer] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    let mounted = true;
    backend.bootstrap().then((data: BootstrapPayload) => {
      if (!mounted) return;
      setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
      setChoices(data.choices || FALLBACK_CHOICES);
      setGpus(data.gpus?.length ? data.gpus : DETECTED_GPUS);
      setRuntime(data.runtime || { ready: false, error: 'No runtime status returned.' });
      setModelViewer(data.modelViewer || {});
      setBootstrapError('');
    }).catch((error) => {
      if (!mounted) return;
      setBootstrapError(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const onChange = useCallback(<K extends keyof UISettings,>(key: K, value: UISettings[K]) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }, []);

  const replaceSettings = useCallback((patch: Partial<UISettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  const resetSettings = useCallback(async () => {
    const next = { ...DEFAULT_SETTINGS };
    setSettings(next);
    try {
      const result = await backend.saveSettings(next);
      setSettings({ ...next, ...result.settings });
      setToast('Settings restored to runtime defaults');
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    }
    window.setTimeout(() => setToast(''), 3500);
  }, []);

  if (loading) {
    return <div className="min-h-screen bg-[#0b0f17] text-slate-100 grid place-items-center"><div className="flex items-center gap-2 text-sm text-slate-300"><LoaderCircle className="w-5 h-5 animate-spin text-[#76b900]" /> Loading DLSS 5 runtime and TypeScript UI…</div></div>;
  }

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col font-sans selection:bg-[#76b900]/30 selection:text-emerald-200">
      <Navbar currentTab={currentTab} onSelectTab={setCurrentTab} settings={settings} gpus={gpus} isRendering={false} />

      {bootstrapError && <div className="max-w-[1600px] w-full mx-auto px-3 sm:px-5 pt-3"><div className="flex items-start gap-2 rounded-lg border border-red-900/70 bg-red-950/30 p-3 text-xs text-red-300"><AlertTriangle className="w-4 h-4 shrink-0" /><div><strong>Backend bootstrap failed.</strong><div className="mt-1 font-mono text-[10px]">{bootstrapError}</div></div></div></div>}
      {!runtime.ready && !bootstrapError && <div className="max-w-[1600px] w-full mx-auto px-3 sm:px-5 pt-3"><div className="flex items-start gap-2 rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-xs text-amber-300"><AlertTriangle className="w-4 h-4 shrink-0" /><div><strong>Native runtime check needs attention.</strong><div className="mt-1 font-mono text-[10px]">{runtime.error}</div></div></div></div>}

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-3 sm:px-5 py-3.5">
        {currentTab === 'neural-rendering' && <NeuralRuntimeTab settings={settings} choices={choices} onChange={onChange} />}
        {currentTab === 'upscale' && <UpscaleRuntimeTab settings={settings} choices={choices} onChange={onChange} />}
        {currentTab === 'frame-interpolation' && <FrameRuntimeTab settings={settings} choices={choices} onChange={onChange} />}
        {currentTab === 'live' && <LiveRuntimeTab settings={settings} choices={choices} onChange={onChange} />}
        {currentTab === 'model-viewer' && <ModelRuntimeTab settings={settings} choices={choices} onChange={onChange} modelViewer={modelViewer} />}
        {currentTab === 'settings' && <SettingsRuntimeTab settings={settings} choices={choices} gpus={gpus} runtime={runtime} onChange={onChange} onReplaceSettings={replaceSettings} onReset={resetSettings} />}
        {currentTab === 'about' && <AboutTab />}
      </main>

      {toast && <div className="fixed bottom-4 right-4 z-50 max-w-lg rounded-lg border border-emerald-900/60 bg-slate-950/95 px-3 py-2 text-[11px] text-slate-200 shadow-2xl"><span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#76b900]" />{toast}</div>}

      <footer className="border-t border-slate-900/90 py-2.5 text-center text-[10px] text-slate-600">DLSS 5 Visual Enhancer · TypeScript primary UI · Python/native NVIDIA runtime backend</footer>
    </div>
  );
};
