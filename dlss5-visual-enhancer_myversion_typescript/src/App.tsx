import React, { useState, useEffect } from 'react';
import { TabId, UISettings } from './types';
import { DEFAULT_SETTINGS, DETECTED_GPUS } from './data/defaults';
import { Navbar } from './components/Navbar';
import { NeuralRenderingTab } from './components/NeuralRenderingTab';
import { UpscaleTab } from './components/UpscaleTab';
import { FrameInterpolationTab } from './components/FrameInterpolationTab';
import { LiveTab } from './components/LiveTab';
import { ModelViewerTab } from './components/ModelViewerTab';
import { SettingsTab } from './components/SettingsTab';
import { AboutTab } from './components/AboutTab';
import { Zap, CheckCircle2 } from 'lucide-react';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<TabId>('neural-rendering');
  const [settings, setSettings] = useState<UISettings>(() => {
    try {
      const saved = localStorage.getItem('dlss5_ui_settings');
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS;
  });

  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Save settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('dlss5_ui_settings', JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  const handleStartJob = (jobName: string) => {
    setIsRendering(true);
    setToastMessage(`Job dispatched: ${jobName}`);
    setTimeout(() => {
      setIsRendering(false);
      setToastMessage(`Completed: ${jobName}`);
      setTimeout(() => setToastMessage(null), 3000);
    }, 1200);
  };

  const handleResetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    setToastMessage('Settings restored to factory defaults');
    setTimeout(() => setToastMessage(null), 3000);
  };

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 flex flex-col font-sans selection:bg-[#76b900]/30 selection:text-emerald-200">
      {/* App Header & Navigation */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        settings={settings}
        gpus={DETECTED_GPUS}
        isRendering={isRendering}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-5 py-3.5">
        {currentTab === 'neural-rendering' && (
          <NeuralRenderingTab
            settings={settings}
            onUpdateSettings={setSettings}
            onStartJob={handleStartJob}
          />
        )}

        {currentTab === 'upscale' && (
          <UpscaleTab
            settings={settings}
            onUpdateSettings={setSettings}
            onStartJob={handleStartJob}
          />
        )}

        {currentTab === 'frame-interpolation' && (
          <FrameInterpolationTab
            settings={settings}
            onUpdateSettings={setSettings}
            onStartJob={handleStartJob}
          />
        )}

        {currentTab === 'live' && (
          <UpscaleTab
            settings={settings}
            onUpdateSettings={setSettings}
            onStartJob={handleStartJob}
            initialMode="Live"
          />
        )}

        {currentTab === 'model-viewer' && (
          <ModelViewerTab
            settings={settings}
            onUpdateSettings={setSettings}
          />
        )}

        {(currentTab === 'settings' || currentTab === 'about') && (
          <SettingsTab
            settings={settings}
            onUpdateSettings={setSettings}
            gpus={DETECTED_GPUS}
            onResetSettings={handleResetSettings}
          />
        )}
      </main>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/95 border border-emerald-500/40 text-[11px] font-mono text-slate-200 shadow-xl shadow-black/80 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="w-1.5 h-1.5 rounded-full bg-[#76b900] animate-ping" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-900/90 py-2.5 text-center text-[11px] text-slate-500">
        <p>DLSS 5 Visual Enhancer &middot; RTX Workstation &middot; Neural Rendering Engine</p>
      </footer>
    </div>
  );
};
