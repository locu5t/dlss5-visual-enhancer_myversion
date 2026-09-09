import React, { useMemo, useState } from 'react';
import { Eye, Play } from 'lucide-react';
import { backend, waitForJob } from '../../api/backend';
import { JobState, RuntimeChoices, UISettings } from '../../types';
import { FileDrop, JobStatusPanel, NeuralControls, Panel, SelectField, SettingsChange, Toggle } from './Common';

interface Props {
  settings: UISettings;
  choices: RuntimeChoices;
  onChange: SettingsChange;
}

export const NeuralRuntimeTab: React.FC<Props> = ({ settings, choices, onChange }) => {
  const [mode, setMode] = useState<'Image' | 'Video'>('Image');
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<JobState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const output = job?.result?.outputs?.[0];
  const outputUrl = output ? backend.fileUrl(output.path) : '';
  const kind = mode === 'Image' ? 'neural-image' : 'neural-video';

  const start = async (preview: boolean) => {
    if (!files.length) { setError(`Choose at least one ${mode.toLowerCase()} first.`); return; }
    setStarting(true); setError('');
    try {
      const created = await backend.startJob(kind, files, settings, preview && mode === 'Video' ? { seconds: 3 } : undefined);
      setJob(created);
      const finished = await waitForJob(created.id, setJob);
      if (finished.status === 'failed') setError(finished.error || 'Render failed.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setStarting(false); }
  };

  const previewType = useMemo(() => output?.path?.toLowerCase().split('.').pop(), [output]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5">
      <div className="xl:col-span-7 space-y-3">
        <Panel title="Neural Rendering" subtitle="Runs the repository's signed DLSS 5 feature-18 pipeline. No CSS/canvas enhancement simulation is used by this production UI.">
          <div className="flex gap-2 mb-3">
            {(['Image', 'Video'] as const).map((item) => <button key={item} onClick={() => { setMode(item); setFiles([]); setJob(null); }} className={`px-3 py-1.5 rounded-md text-xs font-semibold border ${mode === item ? 'bg-[#76b900] text-black border-[#76b900]' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>{item}</button>)}
          </div>
          <FileDrop files={files} onFiles={setFiles} accept={mode === 'Image' ? 'image/*,.heic,.heif,.dng,.raw,.svg' : 'video/*'} multiple label={`Choose ${mode} file${mode === 'Image' ? 's' : 's'}`} />

          {mode === 'Image' ? (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <SelectField label="Output format" value={settings.imageFormat} options={choices.imageFormats} onChange={(v) => onChange('imageFormat', v)} />
              <label className="block"><span className="block text-[11px] font-semibold text-slate-300 mb-1">Image quality</span><input className="w-full rounded-md border border-slate-700 bg-slate-950/80 px-2.5 py-2 text-xs" type="number" min={1} max={100} value={settings.imageQuality} onChange={(e) => onChange('imageQuality', Number(e.target.value))} /></label>
              <SelectField label="Rename" value={settings.imageRenameMode} options={choices.renameModes} onChange={(v) => onChange('imageRenameMode', v)} />
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <SelectField label="Video codec" value={settings.codec} options={choices.codecs} onChange={(v) => onChange('codec', v)} />
              <SelectField label="Container" value={settings.container} options={choices.containers} onChange={(v) => onChange('container', v)} />
              <SelectField label="Encoding quality" value={settings.quality} options={choices.qualities} onChange={(v) => onChange('quality', v)} />
              <Toggle label="HDR Mode" checked={settings.hdrMode} onChange={(v) => onChange('hdrMode', v)} />
              <SelectField label="Rename" value={settings.videoRenameMode} options={choices.renameModes} onChange={(v) => onChange('videoRenameMode', v)} />
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {mode === 'Video' && <button disabled={starting} onClick={() => start(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-xs font-semibold hover:bg-slate-700"><Eye className="w-4 h-4 text-[#76b900]" /> Preview 3 sec</button>}
            <button disabled={starting} onClick={() => start(false)} className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-[#76b900] text-black text-xs font-bold hover:bg-[#8bd000]"><Play className="w-4 h-4" /> Render {mode}{files.length > 1 ? ' Batch' : ''}</button>
          </div>
          {error && <div className="mt-3 rounded border border-red-900 bg-red-950/30 p-2 text-[11px] text-red-300">{error}</div>}
        </Panel>

        <Panel title="Processed output" subtitle="The preview is the actual file returned by the Python/native DLSS runtime.">
          <div className="min-h-80 bg-black rounded-md overflow-hidden grid place-items-center">
            {!outputUrl ? <span className="text-xs text-slate-600">Render or preview a file to display output.</span> : mode === 'Image' ? (
              <img src={outputUrl} className="max-w-full max-h-[70vh] object-contain" />
            ) : previewType === 'mp4' || previewType === 'webm' || previewType === 'mov' ? (
              <video src={outputUrl} controls className="w-full max-h-[70vh] bg-black" />
            ) : <a className="text-emerald-400 text-xs underline" href={outputUrl} target="_blank" rel="noreferrer">Open rendered video</a>}
          </div>
        </Panel>
      </div>

      <div className="xl:col-span-5 space-y-3">
        <NeuralControls settings={settings} choices={choices} onChange={onChange} />
        <JobStatusPanel job={job} onCancel={job && ['queued', 'running'].includes(job.status) ? () => backend.cancelJob(job.id).then(setJob) : undefined} />
      </div>
    </div>
  );
};
