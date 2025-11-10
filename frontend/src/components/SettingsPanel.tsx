import { FormEvent, useEffect, useState } from "react";
import { useClientConfig } from "../context/ConfigContext";
import { useModelsContext } from "../context/ModelsContext";
import { useToast } from "./Toast";

export function SettingsPanel() {
  const { config, updateConfig, clearSettings } = useClientConfig();
  const { models, selectedModel, setSelectedModel, isLoading, error } = useModelsContext();
  const { push } = useToast();
  const [draft, setDraft] = useState(config);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    updateConfig(draft);
    push({ title: "Settings saved" });
  };

  const handleClear = () => {
    if (window.confirm("Are you sure you want to clear all saved settings? This will reset to default values.")) {
      clearSettings();
      push({ title: "Settings cleared", description: "All settings reset to defaults" });
    }
  };

  return (
    <details className="rounded-md border border-slate-800 bg-slate-900/60 p-4">
      <summary className="cursor-pointer text-sm font-medium text-emerald-400">Connection settings</summary>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium">API base URL</span>
          <input
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            value={draft.baseUrl}
            onChange={(event) => setDraft((prev) => ({ ...prev, baseUrl: event.target.value }))}
            placeholder="http://localhost:21250"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">API key (optional)</span>
          <input
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            value={draft.apiKey}
            onChange={(event) => setDraft((prev) => ({ ...prev, apiKey: event.target.value }))}
            placeholder="sk-..."
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Preferred streaming mode</span>
          <select
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
            value={draft.streamingMode}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, streamingMode: event.target.value as typeof draft.streamingMode }))
            }
          >
            <option value="rest">REST (HTTP streaming)</option>
            <option value="websocket">WebSocket</option>
          </select>
        </label>

        {/* Model Selection */}
        <div className="border-t border-slate-700 pt-3">
          <label className="flex flex-col gap-1">
            <span className="font-medium flex items-center gap-2">
              🤖 LLM Model
              {isLoading && <span className="text-xs text-slate-400">(Loading...)</span>}
              {error && <span className="text-xs text-red-400">(Failed to load)</span>}
            </span>
            <select
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
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
                  {model.context_length ? ` (context: ${model.context_length})` : ""}
                </option>
              ))}
            </select>
            {selectedModel && models.find(m => m.id === selectedModel)?.context_length && (
              <span className="text-xs text-slate-400">
                Context length: {models.find(m => m.id === selectedModel)?.context_length?.toLocaleString()} tokens
              </span>
            )}
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button type="submit" className="rounded-md bg-emerald-500 px-3 py-2 font-semibold text-slate-950 hover:bg-emerald-400 transition-colors">
            Save
          </button>
          <button 
            type="button" 
            onClick={handleClear}
            className="rounded-md border border-slate-700 px-3 py-2 font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
          >
            Clear saved settings
          </button>
          <p className="text-xs text-slate-400 flex-1">Settings persist in your browser only.</p>
        </div>
      </form>
    </details>
  );
}
