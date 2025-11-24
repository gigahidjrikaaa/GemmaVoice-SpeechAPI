import { FormEvent, useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useClientConfig } from "../context/ConfigContext";
import { useModelsContext } from "../context/ModelsContext";
import { useCode } from "../context/CodeContext";
import { apiFetch, apiFetchStream, type ApiError } from "../lib/apiClient";
import { useToast } from "./Toast";
import { InstructionsPanel } from "./InstructionsPanel";
import { errorLogger } from "../lib/errorLogger";
import { Sparkles, Zap, Radio } from "lucide-react";

type GenerationResponse = {
  generated_text: string;
};

type StreamEvent = {
  event: string;
  data: unknown;
};

const defaultRequest = {
  prompt: "Hello!",
  max_tokens: 256,
  temperature: 0.7,
  top_p: 0.95,
  top_k: 40
};

// Parameter explanations
const PARAM_HELP = {
  prompt: "The input text to send to the language model. Can be a question, instruction, or conversation context.",
  temperature: "Controls randomness (0-2). Lower values (0.1-0.5) make output focused and deterministic. Higher values (0.8-1.5) make output more creative and varied.",
  top_p: "Nucleus sampling (0-1). Considers tokens with cumulative probability up to this value. Lower values (0.7-0.9) make output more focused. 1.0 considers all tokens.",
  top_k: "Limits selection to top K tokens (0-100). Smaller values (10-40) make output more predictable. Higher values allow more diversity.",
  max_tokens: "Maximum number of tokens to generate (1-4096). One token ≈ 4 characters for English text."
};

export function GenerationPanel() {
  const { config } = useClientConfig();
  const { selectedModel } = useModelsContext();
  const { setSnippet } = useCode();
  const { push } = useToast();
  const [request, setRequest] = useState(defaultRequest);
  const [result, setResult] = useState<GenerationResponse | null>(null);
  const [streamLog, setStreamLog] = useState<StreamEvent[]>([]);

  // Update code snippet when request changes
  useEffect(() => {
    const curlCommand = `curl -X POST ${config.baseUrl}/v1/generate \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(request, null, 2)}'`;

    setSnippet({
      language: "bash",
      code: curlCommand,
      title: "Text Generation Request"
    });
  }, [request, config.baseUrl, setSnippet]);

  const mutation = useMutation<GenerationResponse, ApiError, typeof request>({
    mutationFn: async (payload) => {
      errorLogger.logInfo('Starting text generation', { payload });
      const { data } = await apiFetch<GenerationResponse>(config, "/v1/generate", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      errorLogger.logInfo('Generation successful', { outputLength: data.generated_text?.length });
      return data;
    },
    onSuccess: (data) => {
      setResult(data);
      push({ title: "Generation complete" });
    },
    onError: (error) => {
      errorLogger.logError(error, '/v1/generate');
      // Properly extract and stringify error message from API error object
      let message = 'Unknown error';

      if (typeof error === 'string') {
        message = error;
      } else if (error && typeof error === 'object') {
        // Cast to any since API errors can have various shapes
        const err = error as any;
        const errorMsg = err.error || err.detail || err.message;

        if (typeof errorMsg === 'string') {
          message = errorMsg;
        } else if (errorMsg && typeof errorMsg === 'object') {
          // Handle Pydantic validation errors (422) which have nested objects
          if (Array.isArray(errorMsg)) {
            message = errorMsg.map((e: any) => e.msg || JSON.stringify(e)).join('; ');
          } else {
            message = JSON.stringify(errorMsg);
          }
        }
      }

      push({
        title: "Generation failed",
        description: message,
        variant: "error"
      });
    }
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setStreamLog([]);
    mutation.mutate(request);
  };

  const handleStream = async () => {
    setStreamLog([]);
    setResult(null);

    const curlCommand = `curl -N -X POST ${config.baseUrl}/v1/generate_stream \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(request, null, 2)}'`;

    setSnippet({
      language: "bash",
      code: curlCommand,
      title: "Streaming Generation Request"
    });

    errorLogger.logInfo('Starting streaming generation', { request });
    try {
      await apiFetchStream(config, "/v1/generate_stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      }, (event) => {
        errorLogger.logDebug('Stream event received', { event: event.event, dataType: typeof event.data });
        setStreamLog((prev) => [...prev, { event: String(event.event ?? "data"), data: event.data }]);
      });
      errorLogger.logInfo('Streaming completed successfully', { eventsReceived: streamLog.length });
      push({ title: "Streaming run finished" });
    } catch (error) {
      errorLogger.logError(error, '/v1/generate_stream', { request });
      const userMessage = errorLogger.getUserFriendlyMessage(error);
      push({ title: "Streaming failed", description: userMessage, variant: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Instructions Panel */}
      <InstructionsPanel
        title="🤖 Text Generation with Gemma 3"
        description="Generate text using the Gemma 3 language model. Choose between synchronous (wait for complete response) or streaming (see tokens as they're generated) modes."
        steps={[
          {
            step: 1,
            title: "Write Your Prompt",
            description: "Enter the text you want the model to process in the prompt field.",
            details: (
              <code className="text-xs">
                Example: "Write a haiku about artificial intelligence"
              </code>
            ),
          },
          {
            step: 2,
            title: "Adjust Parameters (Optional)",
            description: "Customize generation behavior using temperature, top-p, top-k, and max tokens.",
            details: (
              <ul className="text-xs space-y-1 mt-1">
                <li>• <strong>Temperature 0.1-0.5:</strong> Focused, predictable output</li>
                <li>• <strong>Temperature 0.8-1.5:</strong> Creative, varied output</li>
                <li>• <strong>Max tokens:</strong> Controls response length (1 token ≈ 4 characters)</li>
              </ul>
            ),
          },
          {
            step: 3,
            title: "Choose Generation Mode",
            description: "Click 'Run Sync' for complete response at once, or 'Run Streaming' to watch generation in real-time.",
          },
          {
            step: 4,
            title: "View Results",
            description: "The generated text will appear below. Stream events show token-by-token generation progress.",
          },
        ]}
        tips={[
          "Start with default parameters (temp: 0.7, top-p: 0.95) for balanced results",
          "Use lower temperature (0.2-0.4) for factual, consistent outputs",
          "Use higher temperature (1.0-1.5) for creative writing or brainstorming",
          "Streaming mode is great for seeing how the model thinks step-by-step",
          "Max tokens limits length - increase if responses are cut off",
        ]}
        troubleshooting={[
          {
            problem: "Empty or very short responses",
            solution: "Increase 'Max tokens' parameter (try 512 or 1024)",
          },
          {
            problem: "Repetitive or nonsensical output",
            solution: "Adjust temperature (try 0.7-0.9) or increase top-k (try 50-100)",
          },
          {
            problem: "Generation taking too long",
            solution: "Reduce max tokens or check backend server status",
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={handleSubmit} className="lg:col-span-2 flex flex-col gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-1">
            <textarea
              className="w-full h-48 rounded-lg bg-transparent px-4 py-3 text-sm focus:outline-none focus:bg-slate-900/50 transition-colors resize-none placeholder:text-slate-600"
              value={request.prompt}
              onChange={(event) => setRequest((prev) => ({ ...prev, prompt: event.target.value }))}
              placeholder="Enter your prompt here..."
              title={PARAM_HELP.prompt}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
                Temperature
                <span className="cursor-help opacity-50 hover:opacity-100 transition-opacity" title={PARAM_HELP.temperature}>ℹ️</span>
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={request.temperature}
                onChange={(event) => setRequest((prev) => ({ ...prev, temperature: Number(event.target.value) }))}
                className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none transition-colors"
                placeholder="0.7"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
                Top P
                <span className="cursor-help opacity-50 hover:opacity-100 transition-opacity" title={PARAM_HELP.top_p}>ℹ️</span>
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={request.top_p}
                onChange={(event) => setRequest((prev) => ({ ...prev, top_p: Number(event.target.value) }))}
                className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none transition-colors"
                placeholder="0.95"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
                Top K
                <span className="cursor-help opacity-50 hover:opacity-100 transition-opacity" title={PARAM_HELP.top_k}>ℹ️</span>
              </label>
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                value={request.top_k}
                onChange={(event) => setRequest((prev) => ({ ...prev, top_k: Number(event.target.value) }))}
                className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none transition-colors"
                placeholder="40"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
                Max tokens
                <span className="cursor-help opacity-50 hover:opacity-100 transition-opacity" title={PARAM_HELP.max_tokens}>ℹ️</span>
              </label>
              <input
                type="number"
                step="1"
                min="1"
                max="4096"
                value={request.max_tokens}
                onChange={(event) => setRequest((prev) => ({ ...prev, max_tokens: Number(event.target.value) }))}
                className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none transition-colors"
                placeholder="256"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <div className="h-4 w-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Run Sync
            </button>
            <button
              type="button"
              onClick={handleStream}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm font-semibold text-emerald-400 hover:bg-slate-800 hover:border-emerald-500/50 transition-all flex items-center justify-center gap-2"
            >
              <Radio className="h-4 w-4" />
              Run Streaming
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-4">
          {result ? (
            <div className="flex-1 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-5 w-5 text-emerald-400" />
                <h3 className="text-sm font-semibold text-emerald-300">Generated Text</h3>
              </div>
              <p className="text-sm text-emerald-100 leading-relaxed whitespace-pre-wrap">{result.generated_text}</p>
            </div>
          ) : (
            <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/20 p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
              <div className="h-12 w-12 rounded-full bg-slate-800/50 flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-slate-600" />
              </div>
              <p className="text-sm text-slate-500">
                Generated content will appear here
              </p>
            </div>
          )}

          {streamLog.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 max-h-[300px] overflow-y-auto">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 sticky top-0 bg-slate-900/95 py-1 backdrop-blur">Stream Events</h3>
              <div className="flex flex-col gap-1.5 font-mono text-[10px]">
                {streamLog.map((entry, index) => (
                  <div key={index} className="flex gap-2 p-1.5 rounded hover:bg-slate-800/50 transition-colors border-l-2 border-transparent hover:border-emerald-500/50">
                    <span className="text-emerald-500 shrink-0 min-w-[80px]">{entry.event}</span>
                    <span className="text-slate-400 truncate">{JSON.stringify(entry.data)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
