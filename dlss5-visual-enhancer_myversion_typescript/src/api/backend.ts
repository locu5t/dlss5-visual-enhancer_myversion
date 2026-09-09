import { BootstrapPayload, JobState, UISettings } from '../types';

const API_BASE = (import.meta.env.VITE_DLSS5_API_BASE || '').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload && 'detail' in payload
      ? String((payload as { detail: unknown }).detail)
      : String(payload || `${response.status} ${response.statusText}`);
    throw new Error(detail);
  }
  return payload as T;
}

export const backend = {
  bootstrap: () => request<BootstrapPayload>('/api/bootstrap'),

  saveSettings: (settings: UISettings) =>
    request<{ settings: Partial<UISettings> }>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),

  startJob: async (
    kind: 'neural-image' | 'neural-video' | 'upscale-image' | 'upscale-video' | 'frame-interpolation',
    files: File[],
    settings: UISettings,
    preview?: { seconds?: number; frames?: number },
  ) => {
    const form = new FormData();
    files.forEach((file) => form.append('files', file, file.name));
    form.append('settings_json', JSON.stringify(settings));
    if (preview?.seconds != null) form.append('preview_seconds', String(preview.seconds));
    if (preview?.frames != null) form.append('preview_frames', String(preview.frames));
    return request<JobState>(`/api/jobs/${kind}`, { method: 'POST', body: form });
  },

  job: (id: string) => request<JobState>(`/api/jobs/${encodeURIComponent(id)}`),
  cancelJob: (id: string) => request<JobState>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),

  fileUrl: (path: string) => `${API_BASE}/api/file?path=${encodeURIComponent(path)}`,

  startLive: (settings: UISettings, file: File | null, onlineSource: string) => {
    const form = new FormData();
    form.append('settings_json', JSON.stringify(settings));
    form.append('online_source', onlineSource || '');
    if (file) form.append('file', file, file.name);
    return request<{ mode: string; status: Record<string, unknown>; previewUrl: string }>('/api/live/start', {
      method: 'POST', body: form,
    });
  },
  liveStatus: () => request<{ mode: string; status: Record<string, unknown>; previewUrl: string }>('/api/live/status'),
  stopLive: () => request<{ mode: string; status: Record<string, unknown>; previewUrl: string }>('/api/live/stop', { method: 'POST' }),

  prepareModel: (files: File[]) => {
    const form = new FormData();
    files.forEach((file) => form.append('files', file, file.name));
    return request<{ modelPath: string; status: string }>('/api/model/prepare', { method: 'POST', body: form });
  },
  startModelLive: (modelPath: string, settings: UISettings) =>
    request<{ status: Record<string, unknown>; previewUrl: string }>('/api/model/live/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelPath, settings }),
    }),
  modelLiveStatus: () => request<{ status: Record<string, unknown>; previewUrl: string }>('/api/model/live/status'),
  stopModelLive: () => request<{ status: Record<string, unknown>; previewUrl: string }>('/api/model/live/stop', { method: 'POST' }),

  exportPreset: (name: string, settings: UISettings) =>
    request<Record<string, unknown>>('/api/presets/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, settings }),
    }),
  importPreset: (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<{ name: string; settings: Partial<UISettings> }>('/api/presets/import', { method: 'POST', body: form });
  },
};

export async function waitForJob(
  id: string,
  onUpdate: (job: JobState) => void,
  signal?: AbortSignal,
): Promise<JobState> {
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const job = await backend.job(id);
    onUpdate(job);
    if (['complete', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}
