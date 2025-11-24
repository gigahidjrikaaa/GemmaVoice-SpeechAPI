import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useClientConfig } from "../context/ConfigContext";
import { useCode } from "../context/CodeContext";
import { apiFetch, apiFetchStream } from "../lib/apiClient";
import { base64ToBlob } from "../lib/audioUtils";
import { useToast } from "./Toast";
import { InstructionsPanel } from "./InstructionsPanel";
import { MessageSquare, Upload, Play, Radio, FileAudio, User, Bot, Volume2 } from "lucide-react";

type DialogueResponse = {
  transcript: string;
  assistant_text: string;
  audio_base64?: string;
  metadata?: Record<string, unknown>;
};

type StreamEvent = {
  event: string;
  data: unknown;
};

const defaultRequest = {
  instructions: "You are a helpful clinical assistant. Provide concise and accurate medical information.",
  stream_audio: true
};

const PARAM_HELP = {
  audio: "Upload an audio file (WAV, MP3, WEBM) containing the user's query.",
  instructions: "System instructions for the AI assistant. Defines the persona and behavior.",
  streamAudio: "If enabled, audio response is streamed back in chunks for lower latency."
};

export function DialoguePanel() {
  const { config } = useClientConfig();
  const { setSnippet } = useCode();
  const { push } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [request, setRequest] = useState(defaultRequest);
  const [result, setResult] = useState<DialogueResponse | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [streamLog, setStreamLog] = useState<StreamEvent[]>([]);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  // Update code snippet
  useEffect(() => {
    const curl = `curl -X POST ${config.baseUrl}/v1/dialogue \\
  -H "Content-Type: multipart/form-data" \\
  -F "audio=@/path/to/audio.wav" \\
  -F "instructions='${request.instructions}'" \\
  -F "stream_audio=${request.stream_audio}"`;

    setSnippet({
      language: "bash",
      code: curl,
      title: "Dialogue Request"
    });
  }, [request, config.baseUrl, setSnippet]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      setFileName(event.target.files[0].name);
      setResult(null);
      setAudioUrl(null);
    } else {
      setFileName(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      push({ title: "Upload audio to start", variant: "error" });
      return;
    }

    setIsProcessing(true);
    setStreamLog([]);

    const form = new FormData();
    form.append("audio", file);
    form.append("instructions", request.instructions);
    form.append("stream_audio", String(request.stream_audio));

    try {
      const { data } = await apiFetch<DialogueResponse>(config, "/v1/dialogue", {
        method: "POST",
        body: form
      });
      setResult(data);
      if (data.audio_base64) {
        const blob = base64ToBlob(data.audio_base64, 'audio/wav');
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        const url = URL.createObjectURL(blob);
        setObjectUrl(url);
        setAudioUrl(url);
      }
      push({ title: "Dialogue completed" });
    } catch (error) {
      // Properly extract and stringify error message from API error object
      let message = 'Unknown error';
      if (typeof error === 'string') {
        message = error;
      } else if (error && typeof error === 'object') {
        const err = error as any;
        const errorMsg = err.error || err.detail || err.message;
        if (typeof errorMsg === 'string') {
          message = errorMsg;
        } else if (errorMsg && typeof errorMsg === 'object') {
          message = JSON.stringify(errorMsg);
        }
      }
      push({ title: "Dialogue failed", description: message, variant: "error" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStream = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      push({ title: "Upload audio to start", variant: "error" });
      return;
    }

    setIsProcessing(true);
    setStreamLog([]);
    setResult(null);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      setObjectUrl(null);
    }
    setAudioUrl(null);

    const form = new FormData();
    form.append("audio", file);
    form.append("instructions", request.instructions);
    form.append("stream_audio", "true");

    const audioChunks: ArrayBuffer[] = [];

    try {
      await apiFetchStream(
        config,
        "/v1/dialogue",
        {
          method: "POST",
          body: form
        },
        (event) => {
          setStreamLog((prev) => [...prev, { event: String(event.event ?? "data"), data: event.data }]);
          if (event.event === "transcript" && typeof event.data === "string") {
            const transcript = event.data as string;
            setResult((prev) => ({ ...(prev ?? { transcript: "", assistant_text: "" }), transcript }));
          }
          if (event.event === "assistant_text" && typeof event.data === "string") {
            const assistant = event.data as string;
            setResult((prev) => ({ ...(prev ?? { transcript: "", assistant_text: "" }), assistant_text: assistant }));
          }
          if (event.event === "audio_chunk" && typeof event.data === "string") {
            const chunk = Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0)).buffer;
            audioChunks.push(chunk);
          }
        }
      );
      if (audioChunks.length) {
        const blob = new Blob(audioChunks, { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        setObjectUrl(url);
        setAudioUrl(url);
      }
      push({ title: "Streaming dialogue finished" });
    } catch (error) {
      // Properly extract and stringify error message from API error object
      let message = 'Unknown streaming error';
      if (typeof error === 'string') {
        message = error;
      } else if (error && typeof error === 'object') {
        const err = error as any;
        const errorMsg = err.error || err.detail || err.message;
        if (typeof errorMsg === 'string') {
          message = errorMsg;
        } else if (errorMsg && typeof errorMsg === 'object') {
          message = JSON.stringify(errorMsg);
        }
      }
      push({ title: "Streaming failed", description: message, variant: "error" });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <InstructionsPanel
        title="💬 Dialogue Orchestration"
        description="Orchestrate a complete conversation flow: Speech-to-Text → LLM Processing → Text-to-Speech, all in one API call."
        steps={[
          {
            step: 1,
            title: "Upload Audio",
            description: "Upload an audio file containing the user's spoken query.",
          },
          {
            step: 2,
            title: "Set Instructions",
            description: "Define the system instructions for the LLM (persona, behavior).",
          },
          {
            step: 3,
            title: "Run Dialogue",
            description: "The system transcribes the audio, generates a response, and synthesizes speech.",
          }
        ]}
        tips={[
          "Ideal for building voice assistants without managing multiple API calls",
          "Streaming mode provides lower latency for real-time interactions",
          "The 'instructions' parameter is key to controlling the assistant's personality"
        ]}
        troubleshooting={[
          {
            problem: "Dialogue fails immediately",
            solution: "Ensure all three services (Whisper, Gemma, OpenAudio) are running and healthy."
          },
          {
            problem: "Response is cut off",
            solution: "Check the max_tokens setting in the backend configuration."
          }
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={handleSubmit} className="lg:col-span-2 flex flex-col gap-4">
          {/* Audio Upload */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Upload className="h-4 w-4 text-emerald-400" />
              <h4 className="text-sm font-semibold text-emerald-300">User Audio</h4>
              <span className="cursor-help text-slate-400 text-xs" title={PARAM_HELP.audio}>ℹ️</span>
            </div>

            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-700 border-dashed rounded-lg cursor-pointer bg-slate-900/30 hover:bg-slate-800/50 hover:border-emerald-500/50 transition-all">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <FileAudio className="w-8 h-8 mb-3 text-slate-400" />
                <p className="mb-2 text-sm text-slate-400">
                  <span className="font-semibold text-emerald-400">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-slate-500">WAV, MP3, WEBM (MAX. 10MB)</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="audio/*"
                onChange={handleFileChange}
              />
            </label>
            {fileName && (
              <div className="mt-3 flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-500/20">
                <FileAudio className="h-4 w-4" />
                <span className="truncate">{fileName}</span>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-1">
            <textarea
              className="w-full h-32 rounded-lg bg-transparent px-4 py-3 text-sm focus:outline-none focus:bg-slate-900/50 transition-colors resize-none placeholder:text-slate-600"
              value={request.instructions}
              onChange={(event) => setRequest((prev) => ({ ...prev, instructions: event.target.value }))}
              placeholder="Enter system instructions..."
              title={PARAM_HELP.instructions}
            />
          </div>

          <label className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400 cursor-pointer hover:text-emerald-400 transition-colors">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500/20"
              checked={request.stream_audio}
              onChange={(event) => setRequest((prev) => ({ ...prev, stream_audio: event.target.checked }))}
            />
            Stream Audio Response
          </label>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              disabled={isProcessing}
            >
              {isProcessing ? (
                <div className="h-4 w-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run Dialogue
            </button>
            <button
              type="button"
              onClick={handleStream}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm font-semibold text-emerald-400 hover:bg-slate-800 hover:border-emerald-500/50 transition-all flex items-center justify-center gap-2"
              disabled={isProcessing}
            >
              <Radio className="h-4 w-4" />
              Stream Dialogue
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-4">
          {/* Results Display */}
          {(result || audioUrl) ? (
            <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {result?.transcript && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <div className="flex items-center gap-2 mb-2 text-slate-400">
                    <User className="h-4 w-4" />
                    <span className="text-xs font-semibold uppercase tracking-wider">User Transcript</span>
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed">{result.transcript}</p>
                </div>
              )}

              {result?.assistant_text && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <div className="flex items-center gap-2 mb-2 text-emerald-400">
                    <Bot className="h-4 w-4" />
                    <span className="text-xs font-semibold uppercase tracking-wider">Assistant Response</span>
                  </div>
                  <p className="text-sm text-emerald-100 leading-relaxed">{result.assistant_text}</p>
                </div>
              )}

              {audioUrl && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <div className="flex items-center gap-2 mb-3 text-emerald-400">
                    <Volume2 className="h-4 w-4" />
                    <span className="text-xs font-semibold uppercase tracking-wider">Audio Response</span>
                  </div>
                  <audio controls className="w-full" src={audioUrl} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/20 p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
              <div className="h-12 w-12 rounded-full bg-slate-800/50 flex items-center justify-center">
                <MessageSquare className="h-6 w-6 text-slate-600" />
              </div>
              <p className="text-sm text-slate-500">
                Dialogue results will appear here
              </p>
            </div>
          )}

          {/* Stream Logs */}
          {streamLog.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 max-h-[200px] overflow-y-auto">
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
