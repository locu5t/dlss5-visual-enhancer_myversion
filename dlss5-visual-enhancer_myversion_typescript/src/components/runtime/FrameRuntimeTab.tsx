import React, { useState } from 'react';
import { Eye, Play } from 'lucide-react';
import { backend, waitForJob } from '../../api/backend';
import { JobState, RuntimeChoices, UISettings } from '../../types';
import { FileDrop, JobStatusPanel, Panel, SelectField, SettingsChange, Toggle } from './Common';

interface Props { settings: UISettings; choices: RuntimeChoices; onChange: SettingsChange; }

export const FrameRuntimeTab: React.FC<Props> = ({ settings, choices, onChange }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async (preview = false) => {
    if (!files.length) { setError('Choose at least one video.'); return; }
    setBusy(true); setError('');
    try {
      const created = await backend.startJob('frame-interpolation', files, settings, preview ? { seconds: 3 } : undefined);
      setJob(created);
      const finished = await waitForJob(created.id, setJob);
      if (finished.status === 'failed') setError(finished.error || 'Frame interpolation failed.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const output = job?.result?.outputs?.[0];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5">
      <div className="xl:col-span-7 space-y-3">
        <Panel title="DLSS Frame Interpolation" subtitle="Uses the installed native DLSSG worker. Auto selects a native grid when possible and Cascade when the requested temporal grid requires it.">
          <FileDrop files={files} onFiles={setFiles} accept="video/*" multiple />
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <SelectField label="Output FPS" value={settings.frameTargetFps} options={choices.frameFps} onChange={(v) => onChange('frameTargetFps', v)} />
            <SelectField label="Engine" value={settings.frameEngine} options={choices.frameEngines} onChange={(v) => onChange('frameEngine', v)} />
            <SelectField label="Codec" value={settings.frameCodec} options={choices.codecs} onChange={(v) => onChange('frameCodec', v)} />
            <SelectField label="Container" value={settings.frameContainer} options={choices.containers} onChange={(v) => onChange('frameContainer', v)} />
            <SelectField label="Encoding quality" value={settings.frameQuality} options={choices.qualities} onChange={(v) => onChange('frameQuality', v)} />
            <SelectField label="Rename" value={settings.frameRenameMode} options={choices.renameModes} onChange={(v) => onChange('frameRenameMode', v)} />
          </div>
          <div className="mt-3"><Toggle label="HDR Mode" checked={settings.frameHdrMode} onChange={(v) => onChange('frameHdrMode', v)} /></div>
          <div className="mt-3 flex gap-2"><button disabled={busy} onClick={() => start(true)} className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs"><Eye className="w-4 h-4 text-[#76b900]" /> Preview 3 sec</button><button disabled={busy} onClick={() => start(false)} className="flex items-center gap-1.5 rounded-md bg-[#76b900] px-3 py-2 text-xs font-bold text-black"><Play className="w-4 h-4" /> Interpolate</button></div>
          {error && <div className="mt-3 rounded border border-red-900 bg-red-950/30 p-2 text-[11px] text-red-300">{error}</div>}
        </Panel>
        <Panel title="Interpolated output"><div className="min-h-72 bg-black rounded-md grid place-items-center overflow-hidden">{output ? <video src={backend.fileUrl(output.path)} controls className="w-full max-h-[70vh]" /> : <span className="text-xs text-slate-600">Interpolated output appears here.</span>}</div></Panel>
      </div>
      <div className="xl:col-span-5"><JobStatusPanel job={job} onCancel={job && ['queued', 'running'].includes(job.status) ? () => backend.cancelJob(job.id).then(setJob) : undefined} /></div>
    </div>
  );
};
