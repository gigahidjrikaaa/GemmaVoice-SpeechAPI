import { ChangeEvent, FormEvent, useRef, useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useClientConfig } from "../context/ConfigContext";
import { useCode } from "../context/CodeContext";
import { apiFetch, type ApiError } from "../lib/apiClient";
import { fileToBase64 } from "../lib/audioUtils";
import { useToast } from "./Toast";
import { InstructionsPanel } from "./InstructionsPanel";
import { AudioVisualizer } from "./AudioVisualizer";
import { Mic, Upload, Radio, FileAudio, X, CheckCircle2 } from "lucide-react";

type TranscriptionResponse = {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
};

const defaultOptions = {
  model: "whisper-large-v3-turbo",
  responseFormat: "json",
  temperature: 0
};

const PARAM_HELP = {
  model: "The Whisper model to use. 'large-v3-turbo' is recommended for best accuracy/speed balance.",
  responseFormat: "Output format. 'json' gives full details, 'text' gives just the transcript, 'verbose_json' includes segments.",
  temperature: "Sampling temperature (0-1). 0 is most deterministic and accurate. Higher values add variety but may hallucinate."
};

export function TranscriptionPanel() {
  const { config } = useClientConfig();
  const { setSnippet } = useCode();
  const { push } = useToast();
  const [options, setOptions] = useState(defaultOptions);
  const [result, setResult] = useState<TranscriptionResponse | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number>();

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // Update code snippet based on mode
  useEffect(() => {
    if (isLiveMode) {
      const wsUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/speech-to-text/ws";
      const code = `// WebSocket Connection for Live Transcription
const ws = new WebSocket("${wsUrl}");

ws.onopen = () => {
  // Send configuration
  ws.send(JSON.stringify({ 
    response_format: "${options.responseFormat}", 
    temperature: ${options.temperature} 
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("Transcript:", data.text);
};

// Send binary audio chunks
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) ws.send(e.data);
    };
    recorder.start(1000);
  });`;

      setSnippet({
        language: "javascript",
        code,
        title: "Live Transcription (WebSocket)"
      });
    } else {
      const curl = `curl -X POST ${config.baseUrl}/v1/speech-to-text \\
  -H "Content-Type: multipart/form-data" \\
  -F "file=@/path/to/audio.wav" \\
  -F "model=${options.model}" \\
  -F "response_format=${options.responseFormat}" \\
  -F "temperature=${options.temperature}"`;

      setSnippet({
        language: "bash",
        code: curl,
        title: "File Transcription Request"
      });
    }
  }, [isLiveMode, options, config.baseUrl, setSnippet]);

  const mutation = useMutation<TranscriptionResponse, ApiError, FormData>({
    mutationFn: async (formData) => {
      const { data } = await apiFetch<TranscriptionResponse>(config, "/v1/speech-to-text", {
        method: "POST",
        body: formData,
      });
      return data;
    },
    onSuccess: (data) => {
      setResult(data);
      push({ title: "Transcription complete" });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      push({ title: "Transcription failed", description: message, variant: "error" });
    }
  });

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      setResult(null);
      setRecordingDuration(0);

      // Start timer
      timerRef.current = window.setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      if (isLiveMode) {
        const wsUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/speech-to-text/ws";
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({
            response_format: options.responseFormat,
            temperature: options.temperature
          }));
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.text) {
            setResult(prev => ({
              text: (prev?.text || "") + " " + data.text,
              language: data.language
            }));
          }
        };

        mediaRecorder.ondataavailable = async (event) => {
          if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(event.data);
          }
        };
        mediaRecorder.start(1000); // Send chunks every second
      } else {
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          const file = new File([audioBlob], "recording.webm", { type: "audio/webm" });
          const formData = new FormData();
          formData.append("file", file);
          formData.append("model", options.model);
          formData.append("response_format", options.responseFormat);
          formData.append("temperature", String(options.temperature));
          mutation.mutate(formData);
        };

        mediaRecorder.start();
      }

      setIsRecording(true);
    } catch (error) {
      console.error("Error accessing microphone:", error);
      push({ title: "Microphone error", description: "Could not access microphone", variant: "error" });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        // Don't nullify streamRef immediately so visualizer can fade out or stop gracefully if we wanted
        // But for now we'll keep it simple
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setAudioFile(event.target.files[0]);
      setResult(null);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!audioFile) return;

    const formData = new FormData();
    formData.append("file", audioFile);
    formData.append("model", options.model);
    formData.append("response_format", options.responseFormat);
    formData.append("temperature", String(options.temperature));

    mutation.mutate(formData);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <InstructionsPanel
        title="🎤 Speech-to-Text with Whisper"
        description="Convert audio to text using OpenAI's Whisper model. Choose from file upload, manual recording, or live streaming transcription."
        steps={[
          {
            step: 1,
            title: "Choose Input Method",
            description: "Upload an audio file or use your microphone for live recording.",
          },
          {
            step: 2,
            title: "Select Mode",
            description: "Standard mode records then transcribes. Live Streaming transcribes in real-time.",
          },
          {
            step: 3,
            title: "Transcribe",
            description: "Click start to begin. Results will appear automatically.",
          }
        ]}
        tips={[
          "Supported formats: mp3, mp4, mpeg, mpga, m4a, wav, webm",
          "File size limit: 25MB",
          "For long audio, standard mode is more reliable than streaming",
          "Live streaming requires a stable internet connection"
        ]}
        troubleshooting={[
          {
            problem: "Microphone not working",
            solution: "Check browser permissions and ensure microphone is selected in system settings",
          },
          {
            problem: "Transcription is inaccurate",
            solution: "Try speaking closer to the mic or reduce background noise. Lower temperature to 0.",
          }
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Recording Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Mic className="h-4 w-4 text-emerald-400" />
                Microphone Input
              </h3>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-400 cursor-pointer hover:text-emerald-400 transition-colors">
                <input
                  type="checkbox"
                  checked={isLiveMode}
                  onChange={(e) => setIsLiveMode(e.target.checked)}
                  disabled={isRecording}
                  className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500/20"
                />
                <Radio className="h-3 w-3" />
                Live Streaming Mode
              </label>
            </div>

            <div className="flex flex-col items-center gap-6">
              {isRecording ? (
                <div className="w-full">
                  <AudioVisualizer stream={streamRef.current} className="w-full h-32 rounded-lg border border-emerald-500/20 bg-slate-950/50" />
                  <div className="mt-4 flex items-center justify-center gap-2 text-emerald-400 font-mono text-sm">
                    <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                    Recording {formatTime(recordingDuration)}
                  </div>
                </div>
              ) : (
                <div className="w-full h-32 rounded-lg border border-dashed border-slate-800 bg-slate-950/30 flex items-center justify-center text-slate-600">
                  <div className="text-center">
                    <Mic className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">Ready to record</p>
                  </div>
                </div>
              )}

              <button
                onClick={toggleRecording}
                className={`rounded-full px-8 py-4 font-bold text-sm transition-all flex items-center gap-3 shadow-lg ${isRecording
                    ? "bg-red-500 text-white hover:bg-red-600 hover:shadow-red-500/20"
                    : "bg-emerald-500 text-slate-950 hover:bg-emerald-400 hover:shadow-emerald-500/20"
                  }`}
              >
                {isRecording ? (
                  <>
                    <div className="h-3 w-3 rounded bg-white" />
                    Stop Recording
                  </>
                ) : (
                  <>
                    <Mic className="h-5 w-5" />
                    Start Recording
                  </>
                )}
              </button>
            </div>
          </div>

          {/* File Upload Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-4">
              <Upload className="h-4 w-4 text-emerald-400" />
              File Upload
            </h3>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="relative">
                <input
                  type="file"
                  accept="audio/*"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  id="audio-upload"
                />
                <label
                  htmlFor="audio-upload"
                  className={`flex flex-col items-center justify-center w-full h-32 rounded-lg border-2 border-dashed transition-colors cursor-pointer ${audioFile
                      ? "border-emerald-500/50 bg-emerald-500/5"
                      : "border-slate-800 hover:border-slate-700 bg-slate-950/30 hover:bg-slate-900/50"
                    }`}
                >
                  {audioFile ? (
                    <div className="flex flex-col items-center gap-2 text-emerald-400">
                      <FileAudio className="h-8 w-8" />
                      <span className="text-sm font-medium">{audioFile.name}</span>
                      <span className="text-xs opacity-70">{(audioFile.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-slate-500">
                      <Upload className="h-8 w-8 opacity-50" />
                      <span className="text-sm">Click to upload or drag and drop</span>
                      <span className="text-xs opacity-50">MP3, WAV, M4A up to 25MB</span>
                    </div>
                  )}
                </label>
                {audioFile && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setAudioFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="absolute top-2 right-2 p-1 rounded-full bg-slate-900/80 text-slate-400 hover:text-red-400 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
                    Model
                    <span className="cursor-help opacity-50 hover:opacity-100 transition-opacity" title={PARAM_HELP.model}>ℹ️</span>
                  </label>
                  <select
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none"
                    value={options.model}
                    onChange={(e) => setOptions(prev => ({ ...prev, model: e.target.value }))}
                  >
                    <option value="whisper-large-v3-turbo">Large V3 Turbo</option>
                    <option value="whisper-large-v3">Large V3</option>
                    <option value="distil-whisper-large-v3">Distil Large V3</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
                    Format
                    <span className="cursor-help opacity-50 hover:opacity-100 transition-opacity" title={PARAM_HELP.responseFormat}>ℹ️</span>
                  </label>
                  <select
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none"
                    value={options.responseFormat}
                    onChange={(e) => setOptions(prev => ({ ...prev, responseFormat: e.target.value }))}
                  >
                    <option value="json">JSON</option>
                    <option value="text">Text</option>
                    <option value="verbose_json">Verbose JSON</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
                    Temperature
                    <span className="cursor-help opacity-50 hover:opacity-100 transition-opacity" title={PARAM_HELP.temperature}>ℹ️</span>
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none"
                    value={options.temperature}
                    onChange={(e) => setOptions(prev => ({ ...prev, temperature: Number(e.target.value) }))}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!audioFile || mutation.isPending}
                className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {mutation.isPending ? (
                  <>
                    <div className="h-4 w-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
                    Transcribing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Transcribe File
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Results Section */}
        <div className="flex flex-col gap-4">
          {result ? (
            <div className="flex-1 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b border-emerald-500/10">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <h3 className="text-sm font-semibold text-emerald-300">Transcription Result</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-medium text-emerald-500/70 uppercase tracking-wider mb-2">Transcript</h4>
                  <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">{result.text}</p>
                </div>

                {result.language && (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="uppercase tracking-wider">Detected Language:</span>
                    <span className="text-emerald-400 font-medium">{result.language}</span>
                  </div>
                )}

                {result.segments && (
                  <div>
                    <h4 className="text-xs font-medium text-emerald-500/70 uppercase tracking-wider mb-2">Segments</h4>
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                      {result.segments.map((segment, i) => (
                        <div key={i} className="flex gap-3 text-xs p-2 rounded bg-slate-950/30 border border-slate-800/50">
                          <span className="font-mono text-slate-500 shrink-0">
                            {segment.start.toFixed(1)}s - {segment.end.toFixed(1)}s
                          </span>
                          <span className="text-slate-300">{segment.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/20 p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
              <div className="h-12 w-12 rounded-full bg-slate-800/50 flex items-center justify-center">
                <FileAudio className="h-6 w-6 text-slate-600" />
              </div>
              <p className="text-sm text-slate-500">
                {isRecording ? "Listening..." : "Transcription results will appear here"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
