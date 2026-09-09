import React, { useState } from 'react';
import { Eye, Play } from 'lucide-react';
import { backend, waitForJob } from '../../api/backend';
import { JobState, RuntimeChoices, UISettings } from '../../types';
import { FileDrop, JobStatusPanel, Panel, SelectField, SettingsChange, Toggle } from './Common';

interface Props { settings: UISettings; choices: RuntimeChoices; onChange: SettingsChange; }

const NumberBox: React.FC<{ label: string; value: number; min?: number; max?: number; onChange: (v: number) => void }> = ({ label, value, min, max, onChange }) => (
  <label className="block"><span className="block text-[11px] font-semibold text-slate-300 mb-1">{label}</span><input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full rounded-md border border-slate-700 bg-slate-950/80 px-2.5 py-2 text-xs text-slate-100" /></label>
);

export const UpscaleRuntimeTab: React.FC<Props> = ({ settings, choices, onChange }) => {
  const [mode, setMode] = useState<'Image' | 'Video'>(settings.upscaleMode);
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const updateMode = (value: 'Image' | 'Video') => { setMode(value); onChange('upscaleMode', value); setFiles([]); setJob(null); };
  const start = async (preview = false) => {
    if (!files.length) { setError('Choose at least one local input file.'); return; }
    setBusy(true); setError('');
    try {
      const kind = mode === 'Image' ? 'upscale-image' : 'upscale-video';
      const created = await backend.startJob(kind, files, settings, preview && mode === 'Video' ? { seconds: 3 } : undefined);
      setJob(created);
      const finished = await waitForJob(created.id, setJob);
      if (finished.status === 'failed') setError(finished.error || 'Upscale failed.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const output = job?.result?.outputs?.[0];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5">
      <div className="xl:col-span-7 space-y-3">
        <Panel title="RTX Video Super Resolution / HDR" subtitle="Uses the repository's native RTX Video worker. Image and Video modes share the selected AI GPU; NVENC outputs use the selected Video GPU.">
          <div className="flex gap-2 mb-3">{(['Image', 'Video'] as const).map((item) => <button key={item} onClick={() => updateMode(item)} className={`px-3 py-1.5 rounded-md text-xs font-semibold border ${mode === item ? 'bg-[#76b900] text-black border-[#76b900]' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>{item}</button>)}</div>
          <FileDrop files={files} onFiles={setFiles} accept={mode === 'Image' ? 'image/*,.heic,.heif,.dng,.raw,.svg' : 'video/*'} multiple />

          {mode === 'Image' ? <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <SelectField label="VSR quality" value={settings.upscaleImageVsrQuality} options={choices.vsrQualities.map((v) => ({ value: v.value, label: v.label }))} onChange={(v) => onChange('upscaleImageVsrQuality', Number(v))} />
              <SelectField label="Size mode" value={settings.upscaleImageSizeMode} options={choices.sizeModes} onChange={(v) => onChange('upscaleImageSizeMode', v)} />
              <SelectField label="Output format" value={settings.upscaleImageOutputFormat} options={choices.imageFormats} onChange={(v) => onChange('upscaleImageOutputFormat', v)} />
            </div>
            {settings.upscaleImageSizeMode === 'Scale factor' ? <SelectField label="Scale factor" value={settings.upscaleImageScaleFactor} options={choices.rtxScaleFactors.map((v) => ({ value: v.value, label: v.label }))} onChange={(v) => onChange('upscaleImageScaleFactor', Number(v))} /> : <div className="grid grid-cols-2 gap-2"><NumberBox label="Width" value={settings.upscaleImageWidth} min={1} max={16384} onChange={(v) => onChange('upscaleImageWidth', v)} /><NumberBox label="Height" value={settings.upscaleImageHeight} min={1} max={16384} onChange={(v) => onChange('upscaleImageHeight', v)} /></div>}
            <Toggle label="Preserve metadata" checked={settings.upscaleImagePreserveMetadata} onChange={(v) => onChange('upscaleImagePreserveMetadata', v)} />
          </div> : <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <SelectField label="VSR quality" value={settings.upscaleVsrQuality} options={choices.vsrQualities.map((v) => ({ value: v.value, label: v.label }))} onChange={(v) => onChange('upscaleVsrQuality', Number(v))} />
              <SelectField label="Size mode" value={settings.upscaleSizeMode} options={choices.sizeModes} onChange={(v) => onChange('upscaleSizeMode', v)} />
              <SelectField label="Scale factor" value={settings.upscaleScaleFactor} options={choices.rtxScaleFactors.map((v) => ({ value: v.value, label: v.label }))} onChange={(v) => onChange('upscaleScaleFactor', Number(v))} />
              <SelectField label="Codec" value={settings.upscaleCodec} options={choices.codecs} onChange={(v) => onChange('upscaleCodec', v)} />
              <SelectField label="Container" value={settings.upscaleContainer} options={choices.containers} onChange={(v) => onChange('upscaleContainer', v)} />
              <SelectField label="Quality" value={settings.upscaleQuality} options={choices.qualities} onChange={(v) => onChange('upscaleQuality', v)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><Toggle label="RTX Video Super Resolution" checked={settings.upscaleVsrEnabled} onChange={(v) => onChange('upscaleVsrEnabled', v)} /><Toggle label="RTX Video HDR" checked={settings.upscaleHdrEnabled} onChange={(v) => onChange('upscaleHdrEnabled', v)} /></div>
            {settings.upscaleHdrEnabled && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><NumberBox label="HDR contrast" value={settings.upscaleHdrContrast} min={0} max={200} onChange={(v) => onChange('upscaleHdrContrast', v)} /><NumberBox label="HDR saturation" value={settings.upscaleHdrSaturation} min={0} max={200} onChange={(v) => onChange('upscaleHdrSaturation', v)} /><NumberBox label="Middle gray" value={settings.upscaleHdrMiddleGray} min={10} max={100} onChange={(v) => onChange('upscaleHdrMiddleGray', v)} /><NumberBox label="Peak nits" value={settings.upscaleHdrPeakLuminance} min={400} max={2000} onChange={(v) => onChange('upscaleHdrPeakLuminance', v)} /></div>}
          </div>}

          <div className="mt-3 flex gap-2 flex-wrap">{mode === 'Video' && <button disabled={busy} onClick={() => start(true)} className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs"><Eye className="w-4 h-4 text-[#76b900]" /> Preview 3 sec</button>}<button disabled={busy} onClick={() => start(false)} className="flex items-center gap-1.5 rounded-md bg-[#76b900] px-3 py-2 text-xs font-bold text-black"><Play className="w-4 h-4" /> Upscale</button></div>
          {error && <div className="mt-3 rounded border border-red-900 bg-red-950/30 p-2 text-[11px] text-red-300">{error}</div>}
        </Panel>

        <Panel title="RTX output"><div className="min-h-72 bg-black rounded-md grid place-items-center overflow-hidden">{!output ? <span className="text-xs text-slate-600">Output appears here after processing.</span> : mode === 'Image' ? <img src={backend.fileUrl(output.path)} className="max-h-[70vh] max-w-full object-contain" /> : <video src={backend.fileUrl(output.path)} controls className="w-full max-h-[70vh]" />}</div></Panel>
      </div>
      <div className="xl:col-span-5"><JobStatusPanel job={job} onCancel={job && ['queued', 'running'].includes(job.status) ? () => backend.cancelJob(job.id).then(setJob) : undefined} /></div>
    </div>
  );
};
