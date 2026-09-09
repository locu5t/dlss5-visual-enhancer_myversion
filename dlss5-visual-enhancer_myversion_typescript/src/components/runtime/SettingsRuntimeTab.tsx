import React, { useRef, useState } from 'react';
import { Download, RotateCcw, Save, Upload } from 'lucide-react';
import { backend } from '../../api/backend';
import { GPUInfo, RuntimeChoices, UISettings } from '../../types';
import { Panel, SelectField, SettingsChange } from './Common';

interface Props {
  settings: UISettings;
  choices: RuntimeChoices;
  gpus: GPUInfo[];
  runtime: { ready: boolean; error: string };
  onChange: SettingsChange;
  onReplaceSettings: (settings: Partial<UISettings>) => void;
  onReset: () => void;
}

export const SettingsRuntimeTab: React.FC<Props> = ({ settings, choices, gpus, runtime, onChange, onReplaceSettings, onReset }) => {
  const [presetName, setPresetName] = useState('RTX 4090 DLSS5');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const presetInput = useRef<HTMLInputElement | null>(null);
  const gpuOptions = gpus.map((gpu) => ({ value: gpu.id, label: `${gpu.name}${gpu.vram ? ` · ${gpu.vram}` : ''}` }));

  const save = async () => {
    setBusy(true); setMessage('');
    try { const result = await backend.saveSettings(settings); onReplaceSettings(result.settings); setMessage('Settings saved to config/config.ini.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const exportPreset = async () => {
    setBusy(true); setMessage('');
    try {
      const presetDoc = await backend.exportPreset(presetName, settings);
      const blob = new Blob([JSON.stringify(presetDoc, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      const safe = presetName.trim().replace(/[^a-z0-9_-]+/gi, '_') || 'DLSS5_Preset';
      link.href = url; link.download = `${safe}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Validated preset exported.');
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const importPreset = async (file: File) => {
    setBusy(true); setMessage('');
    try { const result = await backend.importPreset(file); onReplaceSettings(result.settings); setPresetName(result.name); setMessage(`Imported preset: ${result.name}`); }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5">
      <div className="xl:col-span-7 space-y-3">
        <Panel title="GPU Selection" subtitle="These are real GPUs returned by the Python runtime. AI Processing controls DLSS/RTX Video/DLSSG; Video Processing controls NVENC only.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField label="AI Processing GPU" value={settings.aiGpuId} options={gpuOptions} onChange={(v) => onChange('aiGpuId', v)} />
            <SelectField label="Video Processing GPU" value={settings.videoGpuId} options={gpuOptions} onChange={(v) => onChange('videoGpuId', v)} />
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField label="Preview Encoding" value={settings.previewEncoding} options={choices.previewEncoding} onChange={(v) => onChange('previewEncoding', v)} />
            <div className="rounded-md border border-slate-800 bg-slate-950/60 p-2.5 text-[10px] text-slate-400">
              Neural Rendering uses the universal installed runtime. No fake architecture selector is exposed.
            </div>
          </div>
          <div className="mt-3 flex gap-2"><button disabled={busy} onClick={save} className="flex items-center gap-1.5 rounded-md bg-[#76b900] px-3 py-2 text-xs font-bold text-black"><Save className="w-4 h-4" /> Save settings</button><button disabled={busy} onClick={onReset} className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs"><RotateCcw className="w-4 h-4" /> Reset defaults</button></div>
        </Panel>

        <Panel title="Settings presets" subtitle="Uses the existing versioned Python preset format, schema validation and config persistence.">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
            <label className="block"><span className="block text-[11px] font-semibold text-slate-300 mb-1">Preset name</span><input value={presetName} onChange={(e) => setPresetName(e.target.value)} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs" /></label>
            <button disabled={busy} onClick={exportPreset} className="flex items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs"><Download className="w-4 h-4 text-[#76b900]" /> Export</button>
            <button disabled={busy} onClick={() => presetInput.current?.click()} className="flex items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs"><Upload className="w-4 h-4 text-[#76b900]" /> Import</button>
          </div>
          <input ref={presetInput} className="hidden" type="file" accept="application/json,.json" onChange={(e) => { const file = e.target.files?.[0]; if (file) importPreset(file); e.currentTarget.value = ''; }} />
          {message && <div className="mt-3 rounded border border-slate-800 bg-slate-950/60 p-2 text-[11px] text-slate-300">{message}</div>}
        </Panel>
      </div>

      <div className="xl:col-span-5 space-y-3">
        <Panel title="Runtime status"><div className={`rounded-md border p-3 text-xs ${runtime.ready ? 'border-emerald-900 bg-emerald-950/20 text-emerald-300' : 'border-red-900 bg-red-950/20 text-red-300'}`}>{runtime.ready ? 'Native DLSS runtime is ready.' : `Runtime check failed: ${runtime.error || 'unknown error'}`}</div></Panel>
        <Panel title="Detected RTX devices"><div className="space-y-2">{gpus.map((gpu) => <div key={gpu.id} className="rounded-md border border-slate-800 bg-slate-950/60 p-2.5"><div className="text-xs font-semibold text-slate-200">{gpu.name}</div><div className="mt-1 text-[10px] font-mono text-slate-500">{gpu.arch} · {gpu.vram} · driver {gpu.driver || 'n/a'}</div>{gpu.pciBusId && <div className="text-[10px] font-mono text-slate-600">PCI {gpu.pciBusId} · CUDA {gpu.cudaOrdinal ?? 'unmapped'}</div>}{gpu.compatible === false && <div className="mt-1 text-[10px] text-red-400">{gpu.compatibilityError}</div>}</div>)}</div></Panel>
      </div>
    </div>
  );
};
