import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useClientConfig } from "../context/ConfigContext";
import { apiFetch, type ApiError } from "../lib/apiClient";
import { useToast } from "./Toast";
import { fileToBase64 } from "../lib/audioUtils";
import { InstructionsPanel } from "./InstructionsPanel";
import { errorLogger } from "../lib/errorLogger";

type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

type TranscriptionResponse = {
  text: string;
  language?: string;
  segments?: TranscriptSegment[];
  metadata?: Record<string, unknown>;
};

const defaultOptions = {
  model: "whisper-large-v3",
  responseFormat: "verbose_json",
  temperature: 0
};

// Parameter explanations
const PARAM_HELP = {
  model: "The Whisper model to use for transcription. Larger models are more accurate but slower.",
  responseFormat: "Output format: 'json' (text only), 'verbose_json' (with segments/timestamps), or 'text' (plain text).",
  temperature: "Controls randomness (0-1). Lower values make output more focused and deterministic. Use 0 for most accurate transcription.",
  language: "Optional: Specify the language code (e.g., 'en', 'id', 'ja') to improve accuracy. Leave empty for auto-detection.",
  prompt: "Optional: Provide context or vocabulary to guide the transcription (e.g., technical terms, names)."
};

export function TranscriptionPanel() {
  const { config } = useClientConfig();
  const { push } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [options, setOptions] = useState(defaultOptions);
  const [result, setResult] = useState<TranscriptionResponse | null>(null);
  
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const mutation = useMutation<TranscriptionResponse, ApiError, FormData>({
    mutationFn: async (formData) => {
      errorLogger.logInfo('Starting speech-to-text transcription', { 
        model: options.model, 
        format: options.responseFormat 
      });
      try {
        const { data, requestId } = await apiFetch<TranscriptionResponse>(config, "/v1/speech-to-text", {
          method: "POST",
          body: formData
        });
        errorLogger.logInfo('Transcription completed', { 
          requestId, 
          textLength: data.text?.length,
          segmentsCount: data.segments?.length 
        });
        push({ title: "Transcription ready", description: requestId ? `Request ID: ${requestId}` : undefined });
        return data;
      } catch (error) {
        errorLogger.logError(error, '/v1/speech-to-text', { model: options.model });
        throw new Error(errorLogger.getUserFriendlyMessage(error));
      }
    },
    onSuccess: (data) => setResult(data),
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      push({ title: "Transcription failed", description: message, variant: "error" });
    }
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      push({ title: "Select an audio file first", variant: "error" });
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("model", options.model);
    form.append("response_format", options.responseFormat);
    form.append("temperature", String(options.temperature));
    mutation.mutate(form);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      setResult(null);
    }
  };

  // Start recording audio
  const startRecording = async () => {
    try {
      errorLogger.logInfo('Requesting microphone access', { isLiveMode });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      if (isLiveMode) {
        // Live streaming mode - connect WebSocket
        const wsUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/speech-to-text/ws";
        errorLogger.logInfo('Connecting to WebSocket for live transcription', { wsUrl });
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          errorLogger.logInfo('WebSocket connected successfully');
          push({ title: "🎤 Live transcription started" });
          setLiveTranscript("");
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            errorLogger.logDebug('WebSocket message received', { event: message.event });
            if (message.event === "transcript") {
              setLiveTranscript(prev => prev + " " + message.data.text);
            } else if (message.event === "error") {
              errorLogger.logError(message.detail, '/v1/speech-to-text/ws');
              push({ title: "Transcription error", description: message.detail, variant: "error" });
            }
          } catch (error) {
            errorLogger.logError(error, '/v1/speech-to-text/ws', { rawMessage: event.data });
          }
        };

        ws.onerror = (error) => {
          errorLogger.logError(error, '/v1/speech-to-text/ws', { readyState: ws.readyState });
          push({ title: "WebSocket error", description: "Connection failed. Check backend status.", variant: "error" });
        };

        ws.onclose = (event) => {
          errorLogger.logInfo('WebSocket closed', { code: event.code, reason: event.reason });
          push({ title: "Live transcription ended" });
        };

        // Send audio chunks via WebSocket
        mediaRecorder.ondataavailable = async (event) => {
          if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            try {
              const base64Audio = await fileToBase64(event.data);
              ws.send(JSON.stringify({
                audio_base64: base64Audio.split(',')[1], // Remove data URL prefix
                response_format: options.responseFormat,
                temperature: options.temperature
              }));
              errorLogger.logDebug('Audio chunk sent', { size: event.data.size });
            } catch (error) {
              errorLogger.logError(error, '/v1/speech-to-text/ws', { action: 'send_chunk' });
            }
          }
        };

        // Send chunks every 3 seconds for live transcription
        mediaRecorder.start(3000);
      } else {
        // Manual mode - record and transcribe when stopped
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
            errorLogger.logDebug('Audio chunk captured', { size: event.data.size });
          }
        };

        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          errorLogger.logInfo('Recording stopped, sending for transcription', { 
            blobSize: audioBlob.size, 
            chunksCount: audioChunksRef.current.length 
          });
          
          // Send to transcription API
          const form = new FormData();
          form.append("file", audioBlob, "recording.webm");
          form.append("model", options.model);
          form.append("response_format", options.responseFormat);
          form.append("temperature", String(options.temperature));
          
          mutation.mutate(form);
        };

        mediaRecorder.start();
      }

      setIsRecording(true);
      errorLogger.logInfo('Recording started successfully', { mode: isLiveMode ? 'live' : 'manual' });
      push({ title: isLiveMode ? "🔴 Live recording started" : "🎙️ Recording started" });
    } catch (error) {
      errorLogger.logError(error, 'microphone', { 
        isLiveMode, 
        errorName: error instanceof Error ? error.name : 'unknown' 
      });
      const userMessage = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow microphone permissions in your browser.'
        : errorLogger.getUserFriendlyMessage(error);
      push({ title: "Microphone access failed", description: userMessage, variant: "error" });
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsRecording(false);
    push({ title: "⏹️ Recording stopped" });
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Instructions Panel */}
      <InstructionsPanel
        title="🎤 Speech-to-Text with Whisper"
        description="Convert audio to text using OpenAI's Whisper model. Choose from file upload, manual recording, or live streaming transcription."
        steps={[
          {
            step: 1,
            title: "Choose Input Method",
            description: "Select how you want to provide audio for transcription.",
            details: (
              <ul className="text-xs space-y-1 mt-1">
                <li>• <strong>Record Audio:</strong> Use your microphone to record directly</li>
                <li>• <strong>Upload File:</strong> Transcribe an existing audio file</li>
                <li>• <strong>Live Mode:</strong> Real-time transcription as you speak</li>
              </ul>
            ),
          },
          {
            step: 2,
            title: "Configure Settings",
            description: "Adjust model, response format, and temperature based on your needs.",
            details: (
              <ul className="text-xs space-y-1 mt-1">
                <li>• <strong>Model:</strong> Use 'whisper-large-v3' for best accuracy</li>
                <li>• <strong>Format:</strong> Choose 'verbose_json' to get timestamps</li>
                <li>• <strong>Temperature:</strong> Use 0 for deterministic results</li>
              </ul>
            ),
          },
          {
            step: 3,
            title: "Start Transcription",
            description: "For recording: click 'Start Recording' and speak. For files: click 'Transcribe File'.",
          },
          {
            step: 4,
            title: "View Results",
            description: "Transcript appears below with optional segment timestamps showing when each phrase was spoken.",
          },
        ]}
        tips={[
          "For best accuracy: Speak clearly in a quiet environment",
          "Live mode shows real-time results but may have slight delays (3-second chunks)",
          "Manual recording processes the entire audio after you stop",
          "Verbose JSON format provides timestamps for each segment",
          "Supported file formats: MP3, WAV, M4A, FLAC, OGG, WEBM",
          "Maximum file size varies by backend configuration (typically 25MB)",
        ]}
        troubleshooting={[
          {
            problem: "'Microphone access denied' error",
            solution: "Click the lock icon in your browser's address bar and allow microphone permissions. Reload the page if needed.",
          },
          {
            problem: "No transcription results",
            solution: "Check that your audio is clear and at reasonable volume. Try adjusting your microphone settings.",
          },
          {
            problem: "WebSocket connection failed (live mode)",
            solution: "Ensure backend is running and WebSocket endpoint is accessible. Check console for detailed errors.",
          },
          {
            problem: "File upload fails",
            solution: "Verify file format is supported and size is under limit. Try converting to WAV or MP3.",
          },
          {
            problem: "Inaccurate transcription",
            solution: "Try a larger model (whisper-large-v3) or improve audio quality. Reduce background noise.",
          },
        ]}
      />

      {/* Recording Controls */}
      <div className="rounded-md border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-semibold text-emerald-300 mb-3">🎤 Record Audio</h3>
        
        <div className="flex items-center gap-4 mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isLiveMode}
              onChange={(e) => setIsLiveMode(e.target.checked)}
              disabled={isRecording}
              className="rounded border-slate-700"
              title="Enable live streaming transcription"
            />
            <span className="text-sm">
              Live Streaming Mode
              <span className="text-xs text-slate-400 ml-2" title="Real-time transcription as you speak">ℹ️</span>
            </span>
          </label>
        </div>

        <div className="flex gap-2">
          <button
            onClick={toggleRecording}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold ${
              isRecording
                ? "bg-red-500 hover:bg-red-600 text-white"
                : "bg-emerald-500 hover:bg-emerald-600 text-slate-950"
            }`}
          >
            {isRecording ? "⏹️ Stop Recording" : "🎙️ Start Recording"}
          </button>
        </div>

        <p className="text-xs text-slate-400 mt-2">
          {isLiveMode 
            ? "📡 Live mode: Transcription happens in real-time as you speak" 
            : "💾 Manual mode: Recording will be transcribed when you stop"}
        </p>
      </div>

      {/* Live Transcript Display */}
      {isLiveMode && liveTranscript && (
        <div className="rounded-md border border-emerald-800 bg-emerald-900/20 p-4">
          <h3 className="text-sm font-semibold text-emerald-300 mb-2">📝 Live Transcript</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{liveTranscript}</p>
        </div>
      )}

      {/* File Upload Form */}
      <div className="rounded-md border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-semibold text-emerald-300 mb-3">📁 Upload Audio File</h3>
        
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 md:col-span-2">
            <span className="text-sm font-medium">Audio file</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              title="Upload an audio file for transcription"
            />
          </label>
          
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1">
              Model
              <span className="cursor-help" title={PARAM_HELP.model}>ℹ️</span>
            </label>
            <input
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={options.model}
              onChange={(event) => setOptions((prev) => ({ ...prev, model: event.target.value }))}
              placeholder="whisper-large-v3"
              title={PARAM_HELP.model}
            />
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1">
              Response format
              <span className="cursor-help" title={PARAM_HELP.responseFormat}>ℹ️</span>
            </label>
            <select
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={options.responseFormat}
              onChange={(event) => setOptions((prev) => ({ ...prev, responseFormat: event.target.value }))}
              title={PARAM_HELP.responseFormat}
            >
              <option value="json">JSON (text only)</option>
              <option value="verbose_json">Verbose JSON (with timestamps)</option>
              <option value="text">Plain Text</option>
            </select>
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1">
              Temperature
              <span className="cursor-help" title={PARAM_HELP.temperature}>ℹ️</span>
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="1"
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={options.temperature}
              onChange={(event) => setOptions((prev) => ({ ...prev, temperature: Number(event.target.value) }))}
              placeholder="0"
              title={PARAM_HELP.temperature}
            />
          </div>
          
          <button
            type="submit"
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-600 md:col-span-2 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Uploading..." : "📤 Transcribe File"}
          </button>
        </form>
      </div>
      {result ? (
        <div className="rounded-md border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-emerald-300">Transcript</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{result.text}</p>
          {result.segments?.length ? (
            <div className="mt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Segments</h4>
              <ul className="mt-2 flex flex-col gap-2 text-xs">
                {result.segments.map((segment, index) => (
                  <li key={index} className="rounded bg-slate-800/60 p-2">
                    <span className="text-emerald-400">[{segment.start.toFixed(2)}s - {segment.end.toFixed(2)}s]</span> {segment.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
