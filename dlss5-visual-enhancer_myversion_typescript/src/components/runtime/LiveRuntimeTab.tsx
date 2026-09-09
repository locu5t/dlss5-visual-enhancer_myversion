import React, { useEffect, useRef, useState } from 'react';
import { Play, RefreshCw, Square } from 'lucide-react';
import { backend } from '../../api/backend';
import { RuntimeChoices, UISettings } from '../../types';
import { FileDrop, NeuralControls, Panel, SelectField, SettingsChange, Toggle } from './Common';

interface Props { settings: UISettings; choices: RuntimeChoices; onChange: SettingsChange; }

export const LiveRuntimeTab: React.FC<Props> = ({ settings, choices, onChange }) => {
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [onlineSource, setOnlineSource] = useState('');
  const [status, setStatus] = useState<Record<string, unknown>>({ status: 'Idle.' });
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const refresh = async () => {
    try {
      const result = await backend.liveStatus();
      setStatus(result.status); if (result.previewUrl) setPreviewUrl(result.previewUrl);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  useEffect(() => {
    timer.current = window.setInterval(refresh, 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, []);

  const start = async () => {
    setBusy(true); setError('');
    try {
      const file = settings.liveSourceMode === 'Local' ? (localFiles[0] || null) : null;
      const result = await backend.startLive(settings, file, settings.liveSourceMode === 'Online' ? onlineSource : '');
      setStatus(result.status); setPreviewUrl(result.previewUrl); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const stop = async () => { setBusy(true); try { const result = await backend.stopLive(); setStatus(result.status); setPreviewUrl(result.previewUrl); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const isRunning = Boolean(status.running);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5">
      <div className="xl:col-span-5 space-y-3">
        <Panel title="Unified DLSS 5 Live" subtitle="Realtime and Buffered modes use the same source and one shared set of Neural Rendering controls.">
          <div className="grid grid-cols-2 gap-2 mb-3"><button onClick={() => onChange('livePlaybackMode', 'Realtime')} className={`rounded-md px-3 py-2 text-xs font-semibold border ${settings.livePlaybackMode === 'Realtime' ? 'bg-[#76b900] text-black border-[#76b900]' : 'bg-slate-800 border-slate-700'}`}>Realtime (lowest latency)</button><button onClick={() => onChange('livePlaybackMode', 'Buffered')} className={`rounded-md px-3 py-2 text-xs font-semibold border ${settings.livePlaybackMode === 'Buffered' ? 'bg-[#76b900] text-black border-[#76b900]' : 'bg-slate-800 border-slate-700'}`}>Buffered HLS</button></div>
          <div className="grid grid-cols-2 gap-2 mb-3"><button onClick={() => onChange('liveSourceMode', 'Local')} className={`rounded-md px-3 py-1.5 text-xs border ${settings.liveSourceMode === 'Local' ? 'border-[#76b900] text-[#76b900]' : 'border-slate-700'}`}>Local</button><button onClick={() => onChange('liveSourceMode', 'Online')} className={`rounded-md px-3 py-1.5 text-xs border ${settings.liveSourceMode === 'Online' ? 'border-[#76b900] text-[#76b900]' : 'border-slate-700'}`}>Online URL</button></div>
          {settings.liveSourceMode === 'Local' ? <FileDrop files={localFiles} onFiles={(items) => setLocalFiles(items.slice(0, 1))} accept="video/*" multiple={false} label="Choose local video" /> : <input value={onlineSource} onChange={(e) => setOnlineSource(e.target.value)} placeholder="Direct stream, YouTube or Twitch URL" className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs" />}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <SelectField label="Source quality" value={settings.liveSourceQuality} options={choices.liveSourceQuality} onChange={(v) => onChange('liveSourceQuality', v)} />
            <SelectField label="Max DLSS input height" value={settings.liveMaxHeight} options={choices.liveMaxHeights} onChange={(v) => onChange('liveMaxHeight', Number(v))} />
            <SelectField label="Live frame rate" value={settings.liveFpsMode} options={choices.liveFps} onChange={(v) => onChange('liveFpsMode', v)} />
            <SelectField label="Motion guide quality" value={settings.liveGuideQuality} options={choices.liveGuideQuality} onChange={(v) => onChange('liveGuideQuality', v as UISettings['liveGuideQuality'])} />
          </div>
          {settings.livePlaybackMode === 'Buffered' && <div className="mt-3 grid grid-cols-2 gap-2"><SelectField label="HLS segment seconds" value={settings.liveSegmentSeconds} options={choices.liveSegments} onChange={(v) => onChange('liveSegmentSeconds', Number(v))} /><label className="block"><span className="block text-[11px] font-semibold text-slate-300 mb-1">Playback buffer (seconds)</span><input type="number" min={2} max={30} value={settings.liveBufferSeconds} onChange={(e) => onChange('liveBufferSeconds', Number(e.target.value))} className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs" /></label><Toggle label="Open bundled MPV" checked={settings.liveOpenMpv} onChange={(v) => onChange('liveOpenMpv', v)} /></div>}
          <div className="mt-3 flex gap-2"><button disabled={busy || isRunning} onClick={start} className="flex items-center gap-1.5 rounded-md bg-[#76b900] px-3 py-2 text-xs font-bold text-black"><Play className="w-4 h-4" /> Start Live</button><button disabled={busy || !isRunning} onClick={stop} className="flex items-center gap-1.5 rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300"><Square className="w-3.5 h-3.5" /> Stop</button><button onClick={refresh} className="rounded-md border border-slate-700 bg-slate-800 px-2.5"><RefreshCw className="w-3.5 h-3.5" /></button></div>
          {error && <div className="mt-3 rounded border border-red-900 bg-red-950/30 p-2 text-[11px] text-red-300">{error}</div>}
        </Panel>
        <NeuralControls settings={settings} choices={choices} onChange={onChange} />
      </div>

      <div className="xl:col-span-7 space-y-3">
        <Panel title="DLSS 5 enhanced playback" subtitle="This is the loopback player fed only after signed feature 18 returns. The player itself follows the enhanced frame's real aspect ratio and includes the rolling playback bar.">
          <div className="bg-black rounded-md overflow-hidden min-h-[480px] grid place-items-center">{previewUrl ? <iframe key={previewUrl} src={previewUrl} allow="fullscreen" className="w-full h-[72vh] min-h-[480px] border-0 bg-black" /> : <span className="text-xs text-slate-600">Start playback to open the enhanced player.</span>}</div>
        </Panel>
        <Panel title="Live runtime status"><pre className="whitespace-pre-wrap text-[10px] leading-5 text-slate-300 font-mono max-h-72 overflow-auto">{JSON.stringify(status, null, 2)}</pre></Panel>
      </div>
    </div>
  );
};
