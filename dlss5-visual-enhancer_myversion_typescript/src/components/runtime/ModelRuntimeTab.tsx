import React, { useEffect, useRef, useState } from 'react';
import { Box, Play, RefreshCw, Square } from 'lucide-react';
import { backend } from '../../api/backend';
import { RuntimeChoices, UISettings } from '../../types';
import { FileDrop, NeuralControls, Panel, SelectField, SettingsChange } from './Common';

interface Props { settings: UISettings; choices: RuntimeChoices; onChange: SettingsChange; modelViewer: Record<string, unknown>; }

export const ModelRuntimeTab: React.FC<Props> = ({ settings, choices, onChange, modelViewer }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [modelPath, setModelPath] = useState('');
  const [prepareStatus, setPrepareStatus] = useState('No model prepared.');
  const [status, setStatus] = useState<Record<string, unknown>>({ status: 'Idle.' });
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const refresh = async () => {
    try { const result = await backend.modelLiveStatus(); setStatus(result.status); if (result.previewUrl) setPreviewUrl(result.previewUrl); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  useEffect(() => { timer.current = window.setInterval(refresh, 1000); return () => { if (timer.current) window.clearInterval(timer.current); }; }, []);

  const prepare = async () => {
    if (!files.length) { setError('Choose a 3D model first.'); return; }
    setBusy(true); setError('');
    try { const result = await backend.prepareModel(files); setModelPath(result.modelPath); setPrepareStatus(result.status); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const start = async () => {
    setBusy(true); setError('');
    try {
      let path = modelPath;
      if (!path) { const prepared = await backend.prepareModel(files); path = prepared.modelPath; setModelPath(path); setPrepareStatus(prepared.status); }
      const result = await backend.startModelLive(path, settings); setStatus(result.status); setPreviewUrl(result.previewUrl); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const stop = async () => { setBusy(true); try { const result = await backend.stopModelLive(); setStatus(result.status); setPreviewUrl(result.previewUrl); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const running = Boolean(status.running);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5">
      <div className="xl:col-span-5 space-y-3">
        <Panel title="3D Model Viewer — DLSS 5 Live" subtitle="The model is loaded into a persistent Blender renderer; orbit/pan/zoom requests create in-memory RGBA frames that are processed by signed feature 18 before they appear in the enhanced viewport.">
          <FileDrop files={files} onFiles={(items) => { setFiles(items); setModelPath(''); }} multiple label="Choose model + companion files" />
          <div className="mt-2 text-[10px] text-slate-500">Direct/default Model3D formats and DCC/CAD interchange formats are accepted through the existing converter. OBJ/GLTF companion MTL/BIN/textures can be selected together.</div>
          <div className="mt-3 grid grid-cols-2 gap-2"><SelectField label="Live base render" value={settings.modelLiveResolution} options={choices.modelLiveResolutions} onChange={(v) => onChange('modelLiveResolution', v)} /><button disabled={busy || !files.length} onClick={prepare} className="self-end rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold"><Box className="inline w-3.5 h-3.5 mr-1 text-[#76b900]" /> Prepare model</button></div>
          <div className="mt-3 flex gap-2"><button disabled={busy || running || !files.length} onClick={start} className="flex items-center gap-1.5 rounded-md bg-[#76b900] px-3 py-2 text-xs font-bold text-black"><Play className="w-4 h-4" /> Start DLSS 5 Live 3D</button><button disabled={busy || !running} onClick={stop} className="flex items-center gap-1.5 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300"><Square className="w-3.5 h-3.5" /> Stop</button><button onClick={refresh} className="rounded-md border border-slate-700 bg-slate-800 px-2.5"><RefreshCw className="w-3.5 h-3.5" /></button></div>
          <div className="mt-3 rounded border border-slate-800 bg-slate-950/60 p-2 text-[10px] text-slate-400 whitespace-pre-wrap">{prepareStatus}</div>
          {error && <div className="mt-3 rounded border border-red-900 bg-red-950/30 p-2 text-[11px] text-red-300">{error}</div>}
        </Panel>
        <NeuralControls settings={settings} choices={choices} onChange={onChange} />
        <Panel title="Detected 3D conversion support"><pre className="whitespace-pre-wrap text-[10px] text-slate-400">{JSON.stringify(modelViewer, null, 2)}</pre></Panel>
      </div>

      <div className="xl:col-span-7 space-y-3">
        <Panel title="DLSS 5 Live 3D viewport" subtitle="Left-drag orbit · right/Shift-drag pan · wheel zoom · fullscreen and snapshot controls live inside the player.">
          <div className="bg-black rounded-md overflow-hidden min-h-[520px] grid place-items-center">{previewUrl ? <iframe key={previewUrl} src={previewUrl} allow="fullscreen" className="w-full h-[75vh] min-h-[520px] border-0 bg-black" /> : <span className="text-xs text-slate-600">Prepare a model and start DLSS 5 Live 3D.</span>}</div>
        </Panel>
        <Panel title="3D runtime status"><pre className="whitespace-pre-wrap text-[10px] leading-5 text-slate-300 font-mono max-h-72 overflow-auto">{JSON.stringify(status, null, 2)}</pre></Panel>
      </div>
    </div>
  );
};
