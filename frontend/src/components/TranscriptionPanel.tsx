import { ChangeEvent, FormEvent, useRef, useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useClientConfig } from "../context/ConfigContext";
import { useCode } from "../context/CodeContext";
import { apiFetch, type ApiError } from "../lib/apiClient";
import { fileToBase64 } from "../lib/audioUtils";
import { useToast } from "./Toast";
import { InstructionsPanel } from "./InstructionsPanel";
import { FAQSection, type FAQItem } from "./FAQSection";
import { AudioVisualizer } from "./AudioVisualizer";
import { Mic, Upload, Radio, FileAudio, X, CheckCircle2, Zap } from "lucide-react";

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

// FAQ items for speech-to-text
const FAQ_ITEMS: FAQItem[] = [
  {
    question: "What audio formats are supported?",
    answer: "Whisper supports WAV, MP3, MP4, MPEG, MPGA, M4A, WEBM, and OGG formats. For best results, use WAV or MP3 at 16kHz sample rate. The file size limit is typically 25MB.",
    category: "Basics"
  },
  {
    question: "What's the difference between File Upload and Live Recording?",
    answer: "File Upload transcribes a pre-recorded audio file. Live Recording with 'Live Streaming Mode' OFF captures audio and transcribes when you stop. With 'Live Streaming Mode' ON, you get real-time transcription with partial results appearing as you speak!",
    category: "Basics"
  },
  {
    question: "Does this support Indonesian language?",
    answer: "Yes! Whisper automatically detects and transcribes Indonesian (Bahasa Indonesia) audio. It supports over 100 languages including Indonesian, English, Chinese, Japanese, and more. No configuration needed - just speak in Indonesian.",
    category: "Language"
  },
  {
    question: "How can I improve transcription accuracy?",
    answer: (
      <ul className="space-y-1 mt-2">
        <li>• Use clear audio with minimal background noise</li>
        <li>• Speak at a normal pace with clear pronunciation</li>
        <li>• Use a good quality microphone</li>
        <li>• Set temperature to 0 for most accurate results</li>
        <li>• Use verbose_json format to see segment confidence scores</li>
      </ul>
    ),
    category: "Tips"
  },
  {
    question: "What does the temperature parameter do?",
    answer: "Temperature controls randomness in transcription. 0 = most deterministic and accurate (recommended). Higher values (0.2-0.5) can help with unclear audio but may introduce errors. Stick with 0 unless you have specific reasons to change it.",
    category: "Parameters"
  },
  {
    question: "Why is my transcription inaccurate or hallucinating?",
    answer: "Hallucinations (repetitive or unrelated text) can occur with very quiet/silent audio, heavy background noise, or non-speech audio. Try: cleaning up the audio, using temperature=0, ensuring the audio actually contains speech, and checking that the audio isn't too quiet.",
    category: "Troubleshooting"
  },
  {
    question: "What's the difference between response formats?",
    answer: (
      <ul className="space-y-1 mt-2">
        <li><strong>text:</strong> Plain text transcript only</li>
        <li><strong>json:</strong> Includes text, language, duration</li>
        <li><strong>verbose_json:</strong> Includes word-level timestamps and segments</li>
      </ul>
    ),
    category: "Parameters"
  },
  {
    question: "Why am I getting 503 errors?",
    answer: "503 errors mean the Whisper service is unavailable. Check that: 1) The whisper_service container is running (docker ps), 2) The model has finished loading (can take 1-2 minutes on first start), 3) Check logs with 'docker logs whisper_service' for details.",
    category: "Troubleshooting"
  }
];

export function TranscriptionPanel() {
  const { config } = useClientConfig();
  const { setSnippet } = useCode();
  const { push } = useToast();
  const [options, setOptions] = useState(defaultOptions);
  const [result, setResult] = useState<TranscriptionResponse | null>(null);
  const [interimResult, setInterimResult] = useState<string>("");
  const [isRecording, setIsRecording] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");

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
      const wsBaseUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/speech-to-text/stream";
      const wsUrlWithKey = config.apiKey ? `${wsBaseUrl}?api_key=YOUR_API_KEY` : wsBaseUrl;
      const code = `// Real-time Streaming Speech-to-Text
// Note: Pass API key via query parameter for WebSocket connections
const ws = new WebSocket("${wsUrlWithKey}");

ws.onopen = () => {
  // Send configuration
  ws.send(JSON.stringify({ 
    event: "config",
    language: null, // Auto-detect
    temperature: ${options.temperature} 
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.event === "interim") {
    // Partial result - update UI in real-time
    console.log("Interim:", data.data.text);
  } else if (data.event === "final") {
    // Final result
    console.log("Final:", data.data.text);
  }
};

// Stream audio chunks
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    const recorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) ws.send(e.data);
    };
    recorder.start(500); // Send every 500ms
  });

// Stop recording
ws.send(JSON.stringify({ event: "stop" }));`;

      setSnippet({
        language: "javascript",
        code,
        title: "Real-time Streaming Transcription"
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
          // Handle Pydantic validation errors which have nested objects
          if (Array.isArray(errorMsg)) {
            message = errorMsg.map((e: any) => e.msg || JSON.stringify(e)).join('; ');
          } else {
            message = JSON.stringify(errorMsg);
          }
        }
      }

      push({ title: "Transcription failed", description: message, variant: "error" });
    }
  });

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Check for supported MIME types
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      setResult(null);
      setInterimResult("");
      setRecordingDuration(0);

      // Start timer
      timerRef.current = window.setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      if (isLiveMode) {
        // Use the new streaming endpoint for real-time transcription
        // Pass API key via query parameter since browsers can't set WebSocket headers
        const wsBaseUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/speech-to-text/stream";
        const wsUrl = config.apiKey ? `${wsBaseUrl}?api_key=${encodeURIComponent(config.apiKey)}` : wsBaseUrl;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        setWsStatus("connecting");

        ws.onopen = () => {
          console.log("WebSocket connected for streaming transcription");
          setWsStatus("connected");
          
          // Send configuration
          ws.send(JSON.stringify({
            event: "config",
            language: null, // Auto-detect
            response_format: options.responseFormat,
            temperature: options.temperature
          }));
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            console.log("WebSocket message:", msg);
            
            if (msg.event === "interim" && msg.data) {
              // Show interim (partial) results in real-time
              setInterimResult(msg.data.text || "");
            } else if (msg.event === "final" && msg.data) {
              // Final result - append to results
              const finalText = msg.data.text || "";
              setInterimResult("");
              setResult(prev => ({
                text: prev?.text ? prev.text + " " + finalText : finalText,
                language: msg.data.language || prev?.language,
                segments: [...(prev?.segments || []), ...(msg.data.segments || [])]
              }));
            } else if (msg.event === "ready") {
              push({ title: "Streaming ready", description: "Start speaking..." });
            } else if (msg.event === "configured") {
              console.log("Configuration applied:", msg.config);
            } else if (msg.event === "error") {
              push({ title: "Transcription error", description: msg.detail, variant: "error" });
            } else if (msg.event === "warning") {
              push({ title: "Warning", description: msg.detail });
            }
          } catch (e) {
            console.error("Error parsing WebSocket message:", e);
          }
        };

        ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          setWsStatus("disconnected");
          push({ title: "WebSocket error", description: "Connection failed", variant: "error" });
        };
        
        ws.onclose = () => {
          setWsStatus("disconnected");
          console.log("WebSocket closed");
        };

        // For live streaming, send binary audio chunks directly
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            // Send raw binary audio data
            ws.send(event.data);
          }
        };
        
        // Start recording with smaller intervals for real-time streaming
        mediaRecorder.start(500); // Send chunks every 500ms for smoother streaming
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
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        // Send stop event to finalize transcription
        wsRef.current.send(JSON.stringify({ event: "stop" }));
        // Give it a moment to process final results before closing
        setTimeout(() => {
          if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
          }
        }, 1000);
      }
      setWsStatus("disconnected");
      setInterimResult("");
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
                    {isLiveMode && (
                      <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                        wsStatus === "connected" ? "bg-emerald-500/20 text-emerald-400" :
                        wsStatus === "connecting" ? "bg-yellow-500/20 text-yellow-400" :
                        "bg-red-500/20 text-red-400"
                      }`}>
                        {wsStatus === "connected" ? "⚡ Streaming" : wsStatus === "connecting" ? "Connecting..." : "Disconnected"}
                      </span>
                    )}
                  </div>
                  
                  {/* Show interim results in real-time */}
                  {isLiveMode && interimResult && (
                    <div className="mt-4 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
                      <div className="flex items-center gap-2 mb-1">
                        <Zap className="h-3 w-3 text-yellow-400 animate-pulse" />
                        <span className="text-xs text-yellow-400 font-medium">Live transcription</span>
                      </div>
                      <p className="text-sm text-slate-300 italic">{interimResult}</p>
                    </div>
                  )}
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
                {isRecording && isLiveMode ? (
                  <Zap className="h-6 w-6 text-yellow-400 animate-pulse" />
                ) : (
                  <FileAudio className="h-6 w-6 text-slate-600" />
                )}
              </div>
              <p className="text-sm text-slate-500">
                {isRecording && isLiveMode 
                  ? "Streaming transcription in progress..." 
                  : isRecording 
                    ? "Listening..." 
                    : "Transcription results will appear here"}
              </p>
              {isRecording && isLiveMode && interimResult && (
                <p className="text-sm text-yellow-400 italic mt-2">"{interimResult}"</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* FAQ Section */}
      <FAQSection
        title="❓ Speech-to-Text FAQ"
        description="Common questions about transcription with Whisper"
        items={FAQ_ITEMS}
      />
    </div>
  );
}
