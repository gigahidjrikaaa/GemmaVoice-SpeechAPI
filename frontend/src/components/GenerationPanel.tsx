import { FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useClientConfig } from "../context/ConfigContext";
import { useModelsContext } from "../context/ModelsContext";
import { apiFetch, apiFetchStream, type ApiError } from "../lib/apiClient";
import { useToast } from "./Toast";
import { InstructionsPanel } from "./InstructionsPanel";
import { errorLogger } from "../lib/errorLogger";

type GenerationResponse = {
  id: string;
  output: string;
  metadata?: Record<string, unknown>;
};

type StreamEvent = {
  event: string;
  data: unknown;
};

const defaultRequest = {
  prompt: "Hello!",
  maxOutputTokens: 256,
  temperature: 0.7,
  topP: 0.95,
  topK: 40
};

// Parameter explanations
const PARAM_HELP = {
  prompt: "The input text to send to the language model. Can be a question, instruction, or conversation context.",
  temperature: "Controls randomness (0-2). Lower values (0.1-0.5) make output focused and deterministic. Higher values (0.8-1.5) make output more creative and varied.",
  topP: "Nucleus sampling (0-1). Considers tokens with cumulative probability up to this value. Lower values (0.7-0.9) make output more focused. 1.0 considers all tokens.",
  topK: "Limits sampling to top K most likely tokens (1-256). Lower values make output more predictable. Higher values allow more diversity.",
  maxOutputTokens: "Maximum number of tokens to generate (1-2048). One token ≈ 4 characters. Longer outputs take more time."
};

export function GenerationPanel() {
  const { config } = useClientConfig();
  const { selectedModel } = useModelsContext();
  const { push } = useToast();
  const [request, setRequest] = useState(defaultRequest);
  const [result, setResult] = useState<GenerationResponse | null>(null);
  const [streamLog, setStreamLog] = useState<StreamEvent[]>([]);

  const mutation = useMutation<GenerationResponse, ApiError, typeof request>({
    mutationFn: async (payload) => {
      errorLogger.logInfo('Starting text generation', { payload, model: selectedModel });
      try {
        const { data, requestId } = await apiFetch<GenerationResponse>(config, "/v1/generate", {
          method: "POST",
          body: JSON.stringify({ ...payload, model: selectedModel || undefined })
        });
        errorLogger.logInfo('Generation successful', { requestId, outputLength: data.output?.length });
        push({ title: "Generation complete", description: requestId ? `Request ID: ${requestId}` : undefined });
        return data;
      } catch (error) {
        const errorDetails = errorLogger.logError(error, '/v1/generate', { payload, model: selectedModel });
        throw new Error(errorLogger.getUserFriendlyMessage(error));
      }
    },
    onSuccess: (data) => {
      setResult(data);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
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
    errorLogger.logInfo('Starting streaming generation', { request, model: selectedModel });
    try {
      await apiFetchStream(config, "/v1/generate_stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, model: selectedModel || undefined })
      }, (event) => {
        errorLogger.logDebug('Stream event received', { event: event.event, dataType: typeof event.data });
        setStreamLog((prev) => [...prev, { event: String(event.event ?? "data"), data: event.data }]);
        if (event.event === "final_output" && typeof event.data === "object" && event.data) {
          setResult({
            id: String((event.data as Record<string, unknown>).id ?? "stream"),
            output: String((event.data as Record<string, unknown>).output ?? ""),
            metadata: event.data as Record<string, unknown>
          });
        }
      });
      errorLogger.logInfo('Streaming completed successfully', { eventsReceived: streamLog.length });
      push({ title: "Streaming run finished" });
    } catch (error) {
      errorLogger.logError(error, '/v1/generate_stream', { request, model: selectedModel });
      const userMessage = errorLogger.getUserFriendlyMessage(error);
      push({ title: "Streaming failed", description: userMessage, variant: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
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
            solution: "Increase 'Max output tokens' parameter (try 512 or 1024)",
          },
          {
            problem: "Repetitive or nonsensical output",
            solution: "Adjust temperature (try 0.7-0.9) or increase top-k (try 50-100)",
          },
          {
            problem: "Generation taking too long",
            solution: "Reduce max tokens or check backend server status",
          },
          {
            problem: "Authentication error",
            solution: "Click settings icon and enter your API key",
          },
        ]}
      />

      <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
        <label className="flex h-full flex-col gap-2 md:col-span-2">
          <span className="text-sm font-medium flex items-center gap-1">
            Prompt
            <span className="cursor-help text-slate-400" title={PARAM_HELP.prompt}>ℹ️</span>
          </span>
          <textarea
            className="h-40 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={request.prompt}
            onChange={(event) => setRequest((prev) => ({ ...prev, prompt: event.target.value }))}
            placeholder="Enter your prompt here..."
            title={PARAM_HELP.prompt}
          />
        </label>
        <div className="flex flex-col gap-2">
          <label className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1">
            Temperature
            <span className="cursor-help" title={PARAM_HELP.temperature}>ℹ️</span>
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={request.temperature}
            onChange={(event) => setRequest((prev) => ({ ...prev, temperature: Number(event.target.value) }))}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            placeholder="0.7"
            title={PARAM_HELP.temperature}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1">
            Top P
            <span className="cursor-help" title={PARAM_HELP.topP}>ℹ️</span>
          </label>
          <input
            type="number"
            step="0.05"
            min="0"
            max="1"
            value={request.topP}
            onChange={(event) => setRequest((prev) => ({ ...prev, topP: Number(event.target.value) }))}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            placeholder="0.95"
            title={PARAM_HELP.topP}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1">
            Top K
            <span className="cursor-help" title={PARAM_HELP.topK}>ℹ️</span>
          </label>
          <input
            type="number"
            min="1"
            max="256"
            value={request.topK}
            onChange={(event) => setRequest((prev) => ({ ...prev, topK: Number(event.target.value) }))}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            placeholder="40"
            title={PARAM_HELP.topK}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1">
            Max output tokens
            <span className="cursor-help" title={PARAM_HELP.maxOutputTokens}>ℹ️</span>
          </label>
          <input
            type="number"
            min="1"
            max="2048"
            value={request.maxOutputTokens}
            onChange={(event) => setRequest((prev) => ({ ...prev, maxOutputTokens: Number(event.target.value) }))}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            placeholder="256"
            title={PARAM_HELP.maxOutputTokens}
          />
        </div>
        <div className="flex items-center gap-2 md:col-span-2">
          <button
            type="submit"
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-600 disabled:opacity-50"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Running..." : "▶️ Run Sync"}
          </button>
          <button
            type="button"
            onClick={handleStream}
            className="rounded-md border border-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-400/10"
          >
            📡 Run Streaming
          </button>
          {mutation.isError ? (
            <span className="text-xs text-red-400">{String(mutation.error)}</span>
          ) : null}
        </div>
      </form>
      {result ? (
        <div className="rounded-md border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-emerald-300">Result</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{result.output}</p>
        </div>
      ) : null}
      {streamLog.length > 0 ? (
        <div className="rounded-md border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-emerald-300">Stream events</h3>
          <ul className="mt-2 flex flex-col gap-2 text-xs">
            {streamLog.map((entry, index) => (
              <li key={index} className="rounded bg-slate-800/60 p-2 font-mono">
                <span className="text-emerald-400">{entry.event}:</span> {JSON.stringify(entry.data)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
