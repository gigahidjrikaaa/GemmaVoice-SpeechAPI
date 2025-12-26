import { useState, useEffect, useRef, useMemo, FormEvent, useCallback } from "react";
import { 
  Play, 
  Square, 
  Download, 
  Settings2, 
  Mic, 
  Volume2, 
  Activity, 
  Music, 
  Sparkles, 
  Info, 
  ChevronDown, 
  ChevronRight, 
  HelpCircle, 
  Languages,
  Radio
} from "lucide-react";
import { useClientConfig } from "../context/ConfigContext";
import { useCode } from "../context/CodeContext";
import { useToast } from "./Toast";
import { apiFetch, apiFetchStream } from "../lib/api";
import { useVoiceCloning } from "../hooks/useVoiceCloning";
import { VoiceCloningInput } from "./VoiceCloningInput";
import { InstructionsPanel } from "./InstructionsPanel";
import { ExamplePrompts, type ExamplePrompt } from "./ExamplePrompts";
import { errorLogger } from "../lib/error";

// Types
interface SpeechResponse {
  audio_base64: string;
  response_format?: string;
  sample_rate?: number;
}

interface StreamEvent {
  event: string;
  data: any;
}

// Constants
const PARAM_HELP = {
  temperature: "Controls randomness. Higher values (e.g. 0.8) make speech more expressive but less stable. Lower values (e.g. 0.1) are more monotonic.",
  speed: "Speech speed multiplier. 1.0 is normal speed.",
  topP: "Nucleus sampling probability. Controls diversity of phoneme selection.",
  volume: "Volume adjustment in decibels (dB)."
};

const EXAMPLE_TEXTS: ExamplePrompt[] = [
  {
    title: "Casual Conversation",
    description: "Natural, friendly dialogue",
    prompt: "Hey! (laugh) I haven't seen you in ages. How have you been? We should definitely catch up soon.",
    category: "English"
  },
  {
    title: "Indonesian Greeting",
    description: "Formal Indonesian greeting",
    prompt: "Selamat pagi. Selamat datang di sistem demonstrasi suara AI kami. (smile) Semoga hari Anda menyenangkan.",
    category: "Indonesian"
  },
  {
    title: "Technical Explanation",
    description: "Professional technical narration",
    prompt: "The OpenAudio S1-Mini model uses advanced neural network architecture to synthesize natural human speech from text input with high fidelity.",
    category: "English"
  },
  {
    title: "Podcast Intro",
    description: "Engaging podcast-style opening",
    prompt: "Hey everyone! Welcome back to another episode. Today we're diving deep into the world of artificial intelligence and how it's changing the way we interact with technology.",
    category: "English"
  }
];

const defaultRequest = {
  text: "",
  reference_id: "default",
  language: "auto",
  temperature: 0.7,
  top_p: 0.9,
  speed: 1.0,
  volume: 0,
  format: "wav",
  sample_rate: 22050,
  normalize: true
};

// Utility
const base64ToBlob = (base64: string, type: string) => {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type });
};

export function SynthesisPanel() {
  const { config } = useClientConfig();
  const { setSnippet } = useCode();
  const { push } = useToast();
  
  // State
  const [request, setRequest] = useState(defaultRequest);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [streamLog, setStreamLog] = useState<StreamEvent[]>([]);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStreamPlaying, setIsStreamPlaying] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState<string>("default");

  const supportsSetSinkId =
    typeof window !== "undefined" &&
    typeof (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId === "function";

  // Audio streaming refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const allChunksRef = useRef<ArrayBuffer[]>([]);
  const pendingChunksRef = useRef<ArrayBuffer[]>([]);
  const isProcessingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const outputAudioRef = useRef<HTMLAudioElement | null>(null);

  // Hooks
  const voiceCloning = useVoiceCloning();

  // Cleanup
  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [objectUrl]);

  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioOutputs(devices.filter((d) => d.kind === "audiooutput"));
    } catch (error) {
      console.warn("Failed to enumerate audio output devices", error);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    const mediaDevices = navigator.mediaDevices;
    mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
  }, [refreshDevices]);

  useEffect(() => {
    if (!supportsSetSinkId) return;
    if (!outputAudioRef.current) return;
    if (!audioUrl) return;

    const el = outputAudioRef.current as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
    if (!el.setSinkId) return;
    const sinkId = selectedOutputDeviceId;
    if (!sinkId || sinkId === "default") return;
    el.setSinkId(sinkId).catch((error) => {
      console.warn("Failed to set output device", error);
    });
  }, [audioUrl, selectedOutputDeviceId, supportsSetSinkId]);

  // Update code snippet
  useEffect(() => {
    const curl = `curl -X POST ${config.baseUrl}/v1/text-to-speech \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
      ...request,
      stream: false,
      references: voiceCloning.useVoiceCloning ? ["<base64_audio_data>"] : undefined,
      reference_id: voiceCloning.useVoiceCloning ? undefined : request.reference_id
    }, null, 2)}'`;

    setSnippet({
      language: "bash",
      code: curl,
      title: "Text-to-Speech Request"
    });
  }, [request, voiceCloning.useVoiceCloning, config.baseUrl, setSnippet]);

  const handleExampleSelect = (example: ExamplePrompt) => {
    setRequest(prev => ({
      ...prev,
      text: example.prompt
    }));
    push({ title: `Example loaded: ${example.title}` });
  };

  const runSynthesis = async (event: FormEvent) => {
    event.preventDefault();
    setStreamLog([]);
    setIsGenerating(true);
    try {
      const references = await voiceCloning.getReferences();
      errorLogger.logInfo('Starting text-to-speech synthesis', {
        textLength: request.text.length,
        format: request.format,
        useVoiceCloning: voiceCloning.useVoiceCloning
      });

      const { data } = await apiFetch<SpeechResponse>(config, "/v1/text-to-speech", {
        method: "POST",
        body: JSON.stringify({
          ...request,
          stream: false,
          references: references.length > 0 ? references : undefined,
          reference_id: voiceCloning.useVoiceCloning && references.length > 0 ? undefined : request.reference_id
        })
      });

      if (data.audio_base64) {
        const format = data.response_format ?? request.format ?? "wav";
        const blob = base64ToBlob(data.audio_base64, `audio/${format}`);
        const url = URL.createObjectURL(blob);
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        setObjectUrl(url);
        setAudioUrl(url);
      }
      push({ title: "Synthesis complete" });
    } catch (error) {
      errorLogger.logError(error, '/v1/text-to-speech');
      const userMessage = errorLogger.getUserFriendlyMessage(error);
      push({ title: "Synthesis failed", description: userMessage, variant: "error" });
    } finally {
      setIsGenerating(false);
    }
  };

  const stopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.suspend();
    }
    setIsGenerating(false);
    setIsStreamPlaying(false);
    push({ title: "Streaming stopped" });
  };

  const runStreaming = async () => {
    setStreamLog([]);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      setObjectUrl(null);
    }
    setAudioUrl(null);
    setIsGenerating(true);
    setIsStreamPlaying(true);
    
    allChunksRef.current = [];
    pendingChunksRef.current = [];
    isProcessingRef.current = false;
    nextPlayTimeRef.current = 0;

    abortControllerRef.current = new AbortController();

    // Initialize AudioContext
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const audioContext = audioContextRef.current;
    
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const scheduleChunk = async (arrayBuffer: ArrayBuffer) => {
      try {
        let audioBuffer: AudioBuffer;
        try {
          audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        } catch {
          const sampleRate = request.sample_rate || 44100;
          const int16Array = new Int16Array(arrayBuffer);
          audioBuffer = audioContext.createBuffer(1, int16Array.length, sampleRate);
          const channelData = audioBuffer.getChannelData(0);
          for (let i = 0; i < int16Array.length; i++) {
            channelData[i] = int16Array[i] / 32768;
          }
        }

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        const currentTime = audioContext.currentTime;
        const startTime = Math.max(currentTime, nextPlayTimeRef.current);
        source.start(startTime);
        
        nextPlayTimeRef.current = startTime + audioBuffer.duration;
      } catch (error) {
        console.error("Error scheduling audio chunk:", error);
      }
    };

    const processPendingChunks = async () => {
      if (isProcessingRef.current || pendingChunksRef.current.length === 0) return;
      
      isProcessingRef.current = true;
      while (pendingChunksRef.current.length > 0) {
        const chunk = pendingChunksRef.current.shift();
        if (chunk) {
          await scheduleChunk(chunk);
        }
      }
      isProcessingRef.current = false;
    };

    try {
      const references = await voiceCloning.getReferences();
      await apiFetchStream(
        config,
        "/v1/text-to-speech",
        {
          method: "POST",
          body: JSON.stringify({
            ...request,
            stream: true,
            references: references.length > 0 ? references : undefined,
            reference_id: voiceCloning.useVoiceCloning && references.length > 0 ? undefined : request.reference_id
          }),
          signal: abortControllerRef.current.signal
        },
        (event) => {
          setStreamLog((prev) => [...prev, { event: String(event.event ?? "data"), data: event.data }]);
          if (event.event === "audio_chunk" && typeof event.data === "string") {
            const binaryString = atob(event.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const chunk = bytes.buffer;
            
            allChunksRef.current.push(chunk);
            pendingChunksRef.current.push(chunk);
            processPendingChunks();
          }
        }
      );
      
      if (allChunksRef.current.length) {
        const blob = new Blob(allChunksRef.current, { type: `audio/${request.format ?? "wav"}` });
        const url = URL.createObjectURL(blob);
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        setObjectUrl(url);
        setAudioUrl(url);
      }
      push({ title: "Streaming synthesis finished" });
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      errorLogger.logError(error, '/v1/text-to-speech (stream)');
      const userMessage = errorLogger.getUserFriendlyMessage(error);
      push({ title: "Streaming failed", description: userMessage, variant: "error" });
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
      setIsStreamPlaying(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Text to Speech</h2>
          <p className="text-slate-400 text-sm">Convert text to lifelike speech using OpenAudio S1-Mini</p>
        </div>
        <button 
          onClick={() => setShowHelp(!showHelp)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            showHelp ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-900 text-slate-400 hover:text-slate-200"
          }`}
        >
          <HelpCircle className="h-4 w-4" />
          {showHelp ? "Hide Guide" : "Show Guide"}
        </button>
      </div>

      {showHelp && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-4 duration-300">
          <InstructionsPanel
            title="Quick Start Guide"
            description="How to use the speech synthesis engine"
            steps={[
              { step: 1, title: "Enter Text", description: "Type your text. Use (laugh), (sigh) for emotions." },
              { step: 2, title: "Select Voice", description: "Use default voice or clone a custom one." },
              { step: 3, title: "Generate", description: "Stream for instant playback or Render for high quality." }
            ]}
            tips={["Try Indonesian text!", "Use 0.7 temp for stability."]}
            troubleshooting={[]}
          />
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Languages className="h-5 w-5 text-emerald-400" />
                <h3 className="text-sm font-semibold text-emerald-300">Indonesian Support</h3>
              </div>
              <p className="text-xs text-emerald-100/80 mb-2">
                Native support for Bahasa Indonesia. Use emotion tags like <code>(laugh)</code> or <code>(sigh)</code>.
              </p>
              <div className="text-xs bg-slate-950/50 p-2 rounded border border-emerald-500/10 font-mono text-emerald-200/70">
                "Halo! (laugh) Senang bertemu denganmu."
              </div>
            </div>
            <ExamplePrompts
              title="Example Prompts"
              description="Click to load"
              examples={EXAMPLE_TEXTS}
              onSelect={handleExampleSelect}
              buttonLabel="Load"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full min-h-0">
        {/* Left Column: Input & Configuration */}
        <div className="lg:col-span-7 flex flex-col gap-4 overflow-y-auto pr-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-1 shadow-sm focus-within:ring-1 focus-within:ring-emerald-500/50 transition-all">
            <textarea
              className="w-full h-48 rounded-lg bg-transparent px-4 py-3 text-base focus:outline-none focus:bg-slate-900/50 transition-colors resize-none placeholder:text-slate-600 leading-relaxed"
              value={request.text}
              onChange={(event) => setRequest((prev) => ({ ...prev, text: event.target.value }))}
              placeholder="Enter text to convert to speech... Try adding (laugh) or (sigh) for emotion."
            />
            <div className="px-3 py-2 border-t border-slate-800/50 flex justify-between items-center text-xs text-slate-500">
              <span>{request.text.length} characters</span>
              <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-emerald-500" /> Supports Emotion Tags</span>
            </div>
          </div>

          {/* Voice Selection Card */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Mic className="h-4 w-4 text-emerald-400" />
                Voice Configuration
              </h3>
              <div className="flex bg-slate-950 rounded-lg p-1 border border-slate-800">
                <button
                  onClick={() => voiceCloning.setUseVoiceCloning(false)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                    !voiceCloning.useVoiceCloning ? "bg-emerald-500 text-slate-950 shadow-sm" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Preset
                </button>
                <button
                  onClick={() => voiceCloning.setUseVoiceCloning(true)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                    voiceCloning.useVoiceCloning ? "bg-emerald-500 text-slate-950 shadow-sm" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Clone
                </button>
              </div>
            </div>

            {voiceCloning.useVoiceCloning ? (
              <div className="animate-in fade-in duration-300">
                <VoiceCloningInput
                  referenceFiles={voiceCloning.referenceFiles}
                  onFilesChange={voiceCloning.addReferenceFiles}
                  onFileRemove={voiceCloning.removeReferenceFile}
                  enabled={true}
                  onEnabledChange={() => {}}
                  maxFiles={5}
                />
                <p className="text-xs text-slate-500 mt-3 flex items-center gap-2">
                  <Info className="h-3 w-3" />
                  Upload 3-5 clean samples (10-30s) for best results.
                </p>
              </div>
            ) : (
              <div className="animate-in fade-in duration-300">
                <label className="text-xs font-medium text-slate-400 mb-1.5 block">Reference ID</label>
                <input
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm focus:border-emerald-500/50 focus:outline-none transition-colors"
                  value={request.reference_id}
                  onChange={(event) => setRequest((prev) => ({ ...prev, reference_id: event.target.value }))}
                  placeholder="e.g., default"
                />
              </div>
            )}
          </div>

          {/* Advanced Settings Accordion */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between p-4 hover:bg-slate-800/50 transition-colors"
            >
              <span className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-emerald-400" />
                Advanced Settings
              </span>
              {showAdvanced ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
            </button>
            
            {showAdvanced && (
              <div className="p-4 pt-0 border-t border-slate-800/50 grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-200">
                <div className="space-y-4 pt-4">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Audio Format</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400">Format</label>
                      <select
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs focus:border-emerald-500/50 focus:outline-none"
                        value={request.format}
                        onChange={(event) => setRequest((prev) => ({ ...prev, format: event.target.value }))}
                      >
                        <option value="wav">WAV</option>
                        <option value="mp3">MP3</option>
                        <option value="ogg">OGG</option>
                        <option value="flac">FLAC</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400">Sample Rate</label>
                      <input
                        type="number"
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs focus:border-emerald-500/50 focus:outline-none"
                        value={request.sample_rate}
                        onChange={(event) => setRequest((prev) => ({ ...prev, sample_rate: Number(event.target.value) }))}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500/20"
                      checked={request.normalize}
                      onChange={(event) => setRequest((prev) => ({ ...prev, normalize: event.target.checked }))}
                    />
                    Normalize Audio
                  </label>

                  <div className="space-y-1.5">
                    <label className="text-xs text-slate-400">Output Device</label>
                    <select
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs focus:border-emerald-500/50 focus:outline-none disabled:opacity-50"
                      value={selectedOutputDeviceId}
                      onChange={(event) => setSelectedOutputDeviceId(event.target.value)}
                      disabled={!supportsSetSinkId}
                    >
                      <option value="default">Default</option>
                      {audioOutputs.map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Speaker ${index + 1}`}
                        </option>
                      ))}
                    </select>
                    {!supportsSetSinkId && (
                      <p className="text-[10px] text-slate-500">Output selection not supported in this browser.</p>
                    )}
                  </div>
                </div>

                <div className="space-y-4 pt-4">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Prosody & Style</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400" title={PARAM_HELP.temperature}>Temperature ({request.temperature})</label>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        value={request.temperature}
                        onChange={(event) => setRequest((prev) => ({ ...prev, temperature: Number(event.target.value) }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400" title={PARAM_HELP.speed}>Speed ({request.speed}x)</label>
                      <input
                        type="range"
                        min="0.5"
                        max="2.0"
                        step="0.1"
                        className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        value={request.speed}
                        onChange={(event) => setRequest((prev) => ({ ...prev, speed: Number(event.target.value) }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400" title={PARAM_HELP.topP}>Top P ({request.top_p})</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        value={request.top_p}
                        onChange={(event) => setRequest((prev) => ({ ...prev, top_p: Number(event.target.value) }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs text-slate-400" title={PARAM_HELP.volume}>Volume ({request.volume}dB)</label>
                      <input
                        type="range"
                        min="-10"
                        max="10"
                        step="1"
                        className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        value={request.volume}
                        onChange={(event) => setRequest((prev) => ({ ...prev, volume: Number(event.target.value) }))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={runSynthesis}
              className="flex-1 rounded-xl bg-emerald-500 px-6 py-4 text-sm font-bold text-slate-950 hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10"
              disabled={isGenerating}
            >
              {isGenerating && !isStreamPlaying ? (
                <div className="h-4 w-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
              ) : (
                <Play className="h-5 w-5 fill-current" />
              )}
              Render Audio
            </button>
            <button
              onClick={isStreamPlaying ? stopStreaming : runStreaming}
              className={`flex-1 rounded-xl border px-6 py-4 text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg ${
                isStreamPlaying 
                  ? "border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20 shadow-red-500/10" 
                  : "border-slate-700 bg-slate-900/50 text-emerald-400 hover:bg-slate-800 hover:border-emerald-500/50 shadow-emerald-500/5"
              }`}
              disabled={isGenerating && !isStreamPlaying}
            >
              {isStreamPlaying ? (
                <>
                  <Square className="h-5 w-5 fill-current" />
                  Stop Stream
                </>
              ) : (
                <>
                  <Radio className="h-5 w-5" />
                  Stream Audio
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Preview & Output */}
        <div className="lg:col-span-5 flex flex-col gap-4 h-full">
          <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/20 p-6 flex flex-col relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-slate-900/0 to-slate-900/50 pointer-events-none" />
            
            <div className="flex items-center justify-between mb-6 relative z-10">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Music className="h-4 w-4 text-emerald-400" />
                Output Preview
              </h3>
              {audioUrl && (
                <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Ready
                </span>
              )}
            </div>

            <div className="flex-1 flex flex-col items-center justify-center gap-6 relative z-10 min-h-[200px]">
              {isStreamPlaying && !audioUrl ? (
                <div className="flex flex-col items-center gap-4 animate-pulse">
                  <div className="h-16 w-16 rounded-full bg-emerald-500/20 flex items-center justify-center ring-4 ring-emerald-500/10">
                    <Activity className="h-8 w-8 text-emerald-400 animate-bounce" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-sm font-semibold text-emerald-300">Streaming Audio...</h3>
                    <p className="text-xs text-emerald-100/60 mt-1">Generating and playing in real-time</p>
                  </div>
                </div>
              ) : audioUrl ? (
                <div className="w-full space-y-6 animate-in fade-in zoom-in-95 duration-300">
                  <div className="flex justify-center">
                    <div className="h-24 w-24 rounded-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center border border-emerald-500/30 shadow-xl shadow-emerald-500/10">
                      <Volume2 className="h-10 w-10 text-emerald-400" />
                    </div>
                  </div>
                  <audio ref={outputAudioRef} controls className="w-full" src={audioUrl} />
                  <a
                    className="flex items-center justify-center gap-2 w-full rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    href={audioUrl}
                    download={`speech-output.${request.format}`}
                  >
                    <Download className="h-4 w-4" />
                    Download {request.format.toUpperCase()}
                  </a>
                </div>
              ) : (
                <div className="text-center space-y-3 opacity-50">
                  <div className="h-12 w-12 rounded-full bg-slate-800 mx-auto flex items-center justify-center">
                    <Music className="h-6 w-6 text-slate-500" />
                  </div>
                  <p className="text-sm text-slate-500">Generated audio will appear here</p>
                </div>
              )}
            </div>
          </div>

          {/* Stream Logs (Collapsed by default or small) */}
          {streamLog.length > 0 && (
            <div className="h-48 rounded-xl border border-slate-800 bg-slate-950 p-4 overflow-hidden flex flex-col">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Activity className="h-3 w-3" />
                Live Logs
              </h3>
              <div className="flex-1 overflow-y-auto font-mono text-[10px] space-y-1 pr-2 scrollbar-thin scrollbar-thumb-slate-800">
                {streamLog.map((entry, index) => (
                  <div key={index} className="flex gap-2 text-slate-400">
                    <span className="text-emerald-500/70 shrink-0">[{new Date().toLocaleTimeString()}]</span>
                    <span className="text-emerald-400 shrink-0">{entry.event}</span>
                    <span className="truncate opacity-50">{JSON.stringify(entry.data)}</span>
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
