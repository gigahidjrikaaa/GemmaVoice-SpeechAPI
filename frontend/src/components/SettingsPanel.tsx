import { FormEvent, useEffect, useState } from "react";
import { Settings, Save, Trash2, Server, Key, Cpu, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useClientConfig } from "../context/ConfigContext";
import { useModelsContext } from "../context/ModelsContext";
import { useToast } from "./Toast";

export function SettingsPanel() {
  const { config, updateConfig, clearSettings } = useClientConfig();
  const { models, selectedModel, setSelectedModel, isLoading, error } = useModelsContext();
  const { push } = useToast();
  const [draft, setDraft] = useState(config);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    updateConfig(draft);
    push({ title: "Settings Saved", description: "Configuration has been updated." });
  };

  const handleClear = () => {
    if (window.confirm("Are you sure you want to clear all saved settings? This will reset to default values.")) {
      clearSettings();
      push({ title: "Settings Cleared", description: "All settings reset to defaults." });
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden transition-all duration-200">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-sm font-medium text-slate-200 hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-emerald-400" />
          <span>Global Settings</span>
        </div>
        {isOpen ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
      </button>

      {isOpen && (
        <div className="p-4 pt-0 border-t border-slate-800/50 animate-in slide-in-from-top-2 duration-200">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-4">
            
            {/* API Base URL */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
                <Server className="h-3 w-3" />
                API Base URL
              </label>
              <input
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
                value={draft.baseUrl}
                onChange={(event) => setDraft((prev) => ({ ...prev, baseUrl: event.target.value }))}
                placeholder="http://localhost:8000"
              />
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
                <Key className="h-3 w-3" />
                API Key (Optional)
              </label>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
                value={draft.apiKey}
                onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
                placeholder="sk-..."
              />
            </div>

            {/* Streaming Mode */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
                <RefreshCw className="h-3 w-3" />
                Streaming Mode
              </label>
              <select
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50 transition-colors appearance-none"
                value={draft.streamingMode}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, streamingMode: event.target.value as typeof draft.streamingMode }))
                }
              >
                <option value="rest">REST (HTTP Streaming)</option>
                <option value="websocket">WebSocket</option>
              </select>
            </div>

            {/* Model Selection */}
            <div className="space-y-1.5 pt-2 border-t border-slate-800/50">
              <label className="flex items-center justify-between text-xs font-medium text-slate-400">
                <div className="flex items-center gap-2">
                  <Cpu className="h-3 w-3" />
                  LLM Model
                </div>
                {isLoading && <span className="text-[10px] text-emerald-400 animate-pulse">Loading...</span>}
                {error && <span className="text-[10px] text-red-400">Error loading models</span>}
              </label>
              <select
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50 transition-colors appearance-none disabled:opacity-50"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={isLoading || models.length === 0}
              >
                {models.length === 0 && !isLoading && (
                  <option value="">No models available</option>
                )}
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </select>
              {selectedModel && models.find(m => m.id === selectedModel)?.context_length && (
                <p className="text-[10px] text-slate-500 text-right">
                  Context: {models.find(m => m.id === selectedModel)?.context_length?.toLocaleString()} tokens
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <button 
                type="submit" 
                className="flex-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 transition-all flex items-center justify-center gap-2"
              >
                <Save className="h-3 w-3" />
                Save
              </button>
              <button 
                type="button" 
                onClick={handleClear}
                className="rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-xs font-medium text-slate-400 hover:text-red-400 hover:border-red-500/30 transition-all"
                title="Reset to defaults"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>

          </form>
        </div>
      )}
    </div>
  );
}
