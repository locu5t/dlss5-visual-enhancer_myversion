import React from 'react';
import { Download, LoaderCircle, Square, Upload } from 'lucide-react';
import { JobState, RuntimeChoices, UISettings } from '../../types';
import { backend } from '../../api/backend';

export type SettingsChange = <K extends keyof UISettings>(key: K, value: UISettings[K]) => void;

const labelClass = 'block text-[11px] font-semibold text-slate-300 mb-1';
const inputClass = 'w-full rounded-md border border-slate-700 bg-slate-950/80 px-2.5 py-2 text-xs text-slate-100 outline-none focus:border-[#76b900]';

export const SelectField: React.FC<{
  label: string;
  value: string | number;
  options: Array<string | number | { value: string | number; label: string }>;
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => (
  <label className="block">
    <span className={labelClass}>{label}</span>
    <select className={inputClass} value={String(value)} onChange={(e) => onChange(e.target.value)}>
      {options.map((raw) => {
        const item = typeof raw === 'object' ? raw : { value: raw, label: String(raw) };
        return <option key={String(item.value)} value={String(item.value)}>{item.label}</option>;
      })}
    </select>
  </label>
);

export const NumberField: React.FC<{
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 0.05, onChange }) => (
  <label className="block">
    <div className="flex justify-between mb-1"><span className={labelClass.replace('mb-1', '')}>{label}</span><span className="text-[10px] font-mono text-emerald-400">{value}</span></div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#76b900]" />
  </label>
);

export const Toggle: React.FC<{ label: string; checked: boolean; onChange: (value: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
    <span>{label}</span>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[#76b900]" />
  </label>
);

export const NeuralControls: React.FC<{
  settings: UISettings; choices: RuntimeChoices; onChange: SettingsChange;
}> = ({ settings, choices, onChange }) => (
  <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 space-y-3">
    <div className="flex items-center justify-between"><h3 className="text-xs font-bold text-slate-200">DLSS 5 Neural Rendering</h3><span className="text-[9px] font-mono text-[#76b900]">SIGNED FEATURE 18</span></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      <SelectField label="NR Preset" value={settings.nrPreset} options={choices.nrPresets} onChange={(v) => onChange('nrPreset', v)} />
      <SelectField label="NR Style" value={settings.nrStyle} options={choices.nrStyles} onChange={(v) => onChange('nrStyle', v)} />
      <SelectField label="DLSS scaling mode" value={settings.upscalingFactor} options={choices.dlssUpscaling.map((v) => ({ value: v.value, label: v.label }))} onChange={(v) => onChange('upscalingFactor', Number(v))} />
      <SelectField label="DLSS Model Preset" value={settings.dlssModelPreset} options={choices.dlssModelPresets} onChange={(v) => onChange('dlssModelPreset', v)} />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <NumberField label="NR Intensity" value={settings.nrIntensity} min={0} max={2} onChange={(v) => onChange('nrIntensity', v)} />
      <NumberField label="Local Tone Strength" value={settings.localToneStrength} min={0} max={2} onChange={(v) => onChange('localToneStrength', v)} />
      <NumberField label="Local Structure Strength" value={settings.localStructureStrength} min={0} max={2} onChange={(v) => onChange('localStructureStrength', v)} />
      <NumberField label="Skin Structure Strength" value={settings.skinStructureStrength} min={-1} max={2} onChange={(v) => onChange('skinStructureStrength', v)} />
    </div>
    <Toggle label="Automatic Mask (experimental)" checked={settings.automaticMask} onChange={(v) => onChange('automaticMask', v)} />
  </div>
);

export const FileDrop: React.FC<{
  files: File[]; onFiles: (files: File[]) => void; accept?: string; multiple?: boolean; label?: string;
}> = ({ files, onFiles, accept, multiple = true, label = 'Choose files' }) => (
  <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/60 p-3">
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700">
      <Upload className="w-4 h-4 text-[#76b900]" /> {label}
      <input className="hidden" type="file" accept={accept} multiple={multiple} onChange={(e) => onFiles(Array.from(e.target.files || []))} />
    </label>
    <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
      {files.length === 0 ? <p className="text-[10px] text-slate-500 text-center">No local files selected.</p> : files.map((file) => (
        <div key={`${file.name}-${file.lastModified}`} className="flex justify-between text-[10px] font-mono text-slate-400"><span className="truncate pr-2">{file.name}</span><span>{(file.size / 1048576).toFixed(1)} MB</span></div>
      ))}
    </div>
  </div>
);

export const JobStatusPanel: React.FC<{ job: JobState | null; onCancel?: () => void }> = ({ job, onCancel }) => {
  if (!job) return <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 text-xs text-slate-500">No active job.</div>;
  const running = job.status === 'queued' || job.status === 'running';
  const outputs = job.result?.outputs || [];
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div><div className="text-xs font-bold text-slate-200">{job.kind}</div><div className="text-[10px] font-mono text-slate-500">{job.id}</div></div>
        <span className={`text-[10px] font-bold uppercase ${job.status === 'complete' ? 'text-[#76b900]' : job.status === 'failed' ? 'text-red-400' : 'text-amber-300'}`}>{job.status}</span>
      </div>
      <div className="h-1.5 rounded bg-slate-800 overflow-hidden"><div className="h-full bg-[#76b900] transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
      <div className="flex items-center gap-2 text-[11px] text-slate-400">{running && <LoaderCircle className="w-3 h-3 animate-spin text-[#76b900]" />}<span>{job.message || job.error}</span></div>
      {job.error && <pre className="whitespace-pre-wrap rounded bg-red-950/30 border border-red-900/40 p-2 text-[10px] text-red-300">{job.error}</pre>}
      {running && onCancel && <button onClick={onCancel} className="flex items-center gap-1.5 rounded bg-red-950/50 border border-red-900 px-2.5 py-1.5 text-[11px] text-red-300"><Square className="w-3 h-3" /> Stop</button>}
      {outputs.length > 0 && <div className="space-y-1.5">{outputs.map((output) => (
        <a key={output.path} href={backend.fileUrl(output.path)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900 px-2.5 py-2 text-[11px] text-emerald-300 hover:border-emerald-700"><Download className="w-3.5 h-3.5" />{output.path.split(/[\\/]/).pop()}</a>
      ))}</div>}
    </div>
  );
};

export const Panel: React.FC<React.PropsWithChildren<{ title: string; subtitle?: string }>> = ({ title, subtitle, children }) => (
  <section className="rounded-lg border border-slate-800 bg-slate-900/70 shadow-lg shadow-black/20 overflow-hidden">
    <div className="border-b border-slate-800 bg-slate-950/60 px-3 py-2"><h2 className="text-xs font-bold text-slate-100">{title}</h2>{subtitle && <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>}</div>
    <div className="p-3">{children}</div>
  </section>
);
