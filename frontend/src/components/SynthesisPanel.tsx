import { FormEvent, useEffect, useMemo, useState, useRef } from "react";
import { useClientConfig } from "../context/ConfigContext";
import { useCode } from "../context/CodeContext";
import { apiFetch, apiFetchStream } from "../lib/apiClient";
import { base64ToBlob } from "../lib/audioUtils";
import { useVoiceCloning } from "../hooks/useVoiceCloning";
import { VoiceCloningInput } from "./VoiceCloningInput";
import { useToast } from "./Toast";
import { InstructionsPanel } from "./InstructionsPanel";
import { FAQSection, type FAQItem } from "./FAQSection";
import { ExamplePrompts, type ExamplePrompt } from "./ExamplePrompts";
import { errorLogger } from "../lib/errorLogger";
import { Play, Download, Volume2, Mic, Music, Radio } from "lucide-react";

type SpeechResponse = {
  audio_base64?: string;
  response_format?: string;
  media_type?: string;
  reference_id?: string | null;
};

type StreamEvent = {
  event: string;
  data: unknown;
};

const defaultRequest = {
  text: "Thanks for testing the OpenAudio integration!",
  format: "wav",
  sample_rate: 44100,
  reference_id: "default",
  normalize: true,
  top_p: 0.85,
  stream: false,
  references: [] as string[]
};

// Parameter explanations
const PARAM_HELP = {
  text: "The text to convert to speech. Can be any sentence or paragraph.",
  format: "Audio output format: WAV (lossless), MP3 (compressed), OGG (compressed), or FLAC (lossless compressed).",
  sampleRate: "Audio quality in Hz. Higher values (44100, 48000) give better quality but larger file sizes. 22050 is sufficient for speech.",
  referenceId: "Pre-configured voice ID from the system. Use 'default' for the base voice, or specify custom IDs like 'voice_1', 'voice_2'.",
  topP: "Nucleus sampling (0-1). Controls voice variability. Lower values (0.7-0.85) make voice more consistent. Higher values add variation.",
  voiceCloning: "Upload 1-5 audio samples of a target voice. The system will synthesize speech in that voice style.",
  normalize: "Automatically adjust audio volume to prevent distortion and ensure consistent loudness."
};

// Example texts for TTS
const EXAMPLE_TEXTS: ExamplePrompt[] = [
  {
    title: "English Greeting",
    description: "A friendly English introduction",
    prompt: "Hello! Welcome to the GemmaVoice Speech API. I'm excited to help you convert text to natural sounding speech today.",
    category: "English"
  },
  {
    title: "Indonesian Greeting",
    description: "A formal Indonesian welcome message",
    prompt: "Selamat datang di GemmaVoice Speech API. Saya sangat senang bisa membantu Anda mengubah teks menjadi suara yang alami.",
    category: "Indonesian"
  },
  {
    title: "Indonesian Story",
    description: "A short Indonesian narrative",
    prompt: "Pada suatu hari di sebuah desa kecil, tinggal seorang anak perempuan bernama Siti. Dia sangat rajin dan suka membantu orang tuanya di ladang.",
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

// FAQ items for text-to-speech
const FAQ_ITEMS: FAQItem[] = [
  {
    question: "What's the difference between Render Audio and Stream Audio?",
    answer: "Render Audio generates the complete audio file before playback, ensuring consistent quality. Stream Audio plays audio progressively as it's generated, offering faster time-to-first-sound. Use Render for production/downloads; use Stream for interactive applications or previewing long texts.",
    category: "Basics"
  },
  {
    question: "Does this support Indonesian speech?",
    answer: "Yes! OpenAudio-S1-Mini supports Indonesian text-to-speech. Simply enter Indonesian text and it will be synthesized. For best results with Indonesian accents, consider using voice cloning with samples from an Indonesian speaker.",
    category: "Language"
  },
  {
    question: "How does voice cloning work?",
    answer: (
      <div className="space-y-2">
        <p>Voice cloning lets you synthesize speech in a custom voice style:</p>
        <ol className="list-decimal ml-4 space-y-1">
          <li>Upload 3-5 audio samples of the target voice</li>
          <li>Each sample should be 10-30 seconds of clear speech</li>
          <li>Ensure consistent audio quality across samples</li>
          <li>Enable voice cloning and enter your text</li>
          <li>The system will generate speech matching that voice</li>
        </ol>
        <p className="text-amber-300/80 mt-2">Note: Best results with clean, noise-free recordings of a single speaker.</p>
      </div>
    ),
    category: "Voice Cloning"
  },
  {
    question: "Which audio format should I use?",
    answer: (
      <ul className="space-y-1 mt-2">
        <li><strong>WAV:</strong> Best quality, uncompressed. Use for editing or archival.</li>
        <li><strong>MP3:</strong> Good balance of quality and size. Recommended for most uses.</li>
        <li><strong>OGG:</strong> Open format, good compression. Works well on web.</li>
        <li><strong>FLAC:</strong> Lossless compression. Quality of WAV, smaller size.</li>
      </ul>
    ),
    category: "Parameters"
  },
  {
    question: "What sample rate should I choose?",
    answer: "22050 Hz is sufficient for speech and produces smaller files. 44100 Hz (CD quality) offers better quality for music or when editing. 48000 Hz is professional video standard. Higher rates = larger files and longer generation time.",
    category: "Parameters"
  },
  {
    question: "Why does my voice cloning sound different from the samples?",
    answer: "Voice cloning captures speaking style rather than exact voice. For better results: use 3-5 samples (not just 1-2), ensure samples are clean without background noise, use samples of the same speaker and consistent speaking style, and make sure samples are 10-30 seconds each.",
    category: "Voice Cloning"
  },
  {
    question: "Why am I getting OpenAudio service unavailable errors?",
    answer: "The OpenAudio API runs as a separate container on port 21251. Check: 1) docker ps to see if openaudio_api is running, 2) docker logs openaudio_api for errors, 3) Ensure model checkpoints are in backend/openaudio-checkpoints/. Model loading takes 1-2 minutes on first start.",
    category: "Troubleshooting"
  },
  {
    question: "What does the 'Normalize' option do?",
    answer: "Normalize adjusts the audio volume to a consistent level, preventing distortion from audio that's too loud and boosting audio that's too quiet. Recommended to keep enabled unless you need precise volume control.",
    category: "Parameters"
  }
];

export function SynthesisPanel() {
  const { config } = useClientConfig();
  const { setSnippet } = useCode();
  const { push } = useToast();
  const [request, setRequest] = useState(defaultRequest);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [streamLog, setStreamLog] = useState<StreamEvent[]>([]);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStreamPlaying, setIsStreamPlaying] = useState(false);

  // Audio streaming refs for real-time playback
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const allChunksRef = useRef<ArrayBuffer[]>([]);
  const pendingChunksRef = useRef<ArrayBuffer[]>([]);
  const isProcessingRef = useRef(false);

  // Use shared voice cloning hook
  const voiceCloning = useVoiceCloning();

  // Handle example text selection
  const handleExampleSelect = (example: ExamplePrompt) => {
    setRequest(prev => ({
      ...prev,
      text: example.prompt
    }));
    push({ title: `Example loaded: ${example.title}` });
  };

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

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

  const headers = useMemo(() => ({ "Content-Type": "application/json" }), []);

  const runSynthesis = async (event: FormEvent) => {
    event.preventDefault();
    setStreamLog([]);
    setIsGenerating(true);
    try {
      // Get base64 encoded references from voice cloning hook
      const references = await voiceCloning.getReferences();
      errorLogger.logInfo('Starting text-to-speech synthesis', {
        textLength: request.text.length,
        format: request.format,
        useVoiceCloning: voiceCloning.useVoiceCloning
      });

      const { data } = await apiFetch<SpeechResponse>(config, "/v1/text-to-speech", {
        method: "POST",
        headers,
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

  const runStreaming = async () => {
    setStreamLog([]);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      setObjectUrl(null);
    }
    setAudioUrl(null);
    setIsGenerating(true);
    setIsStreamPlaying(true);
    
    // Reset audio state for streaming
    allChunksRef.current = [];
    pendingChunksRef.current = [];
    isProcessingRef.current = false;
    nextPlayTimeRef.current = 0;

    const curl = `curl -N -X POST ${config.baseUrl}/v1/text-to-speech \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
      ...request,
      stream: true,
      references: voiceCloning.useVoiceCloning ? ["<base64_audio_data>"] : undefined
    }, null, 2)}'`;

    setSnippet({
      language: "bash",
      code: curl,
      title: "Streaming TTS Request"
    });

    // Initialize AudioContext for real-time playback
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const audioContext = audioContextRef.current;
    
    // Resume audio context if suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // Function to schedule and play audio chunks with seamless gapless playback
    const scheduleChunk = async (arrayBuffer: ArrayBuffer) => {
      try {
        // Try to decode as complete audio first (WAV/MP3 chunks)
        let audioBuffer: AudioBuffer;
        try {
          audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        } catch {
          // If decoding fails, it might be raw PCM - try to interpret as raw audio
          // Assuming 16-bit PCM, mono, at the configured sample rate
          const sampleRate = request.sample_rate || 44100;
          const int16Array = new Int16Array(arrayBuffer);
          audioBuffer = audioContext.createBuffer(1, int16Array.length, sampleRate);
          const channelData = audioBuffer.getChannelData(0);
          for (let i = 0; i < int16Array.length; i++) {
            channelData[i] = int16Array[i] / 32768; // Convert to float [-1, 1]
          }
        }

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        // Schedule playback at the next available time for gapless audio
        const currentTime = audioContext.currentTime;
        const startTime = Math.max(currentTime, nextPlayTimeRef.current);
        source.start(startTime);
        
        // Update next play time to end of this buffer
        nextPlayTimeRef.current = startTime + audioBuffer.duration;
        
        console.log(`Scheduled chunk: ${audioBuffer.duration.toFixed(3)}s at ${startTime.toFixed(3)}s`);
      } catch (error) {
        console.error("Error scheduling audio chunk:", error);
      }
    };

    // Process pending chunks
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
          headers,
          body: JSON.stringify({
            ...request,
            stream: true,
            references: references.length > 0 ? references : undefined,
            reference_id: voiceCloning.useVoiceCloning && references.length > 0 ? undefined : request.reference_id
          })
        },
        (event) => {
          setStreamLog((prev) => [...prev, { event: String(event.event ?? "data"), data: event.data }]);
          if (event.event === "audio_chunk" && typeof event.data === "string") {
            // Decode base64 to ArrayBuffer
            const binaryString = atob(event.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const chunk = bytes.buffer;
            
            // Store for final download
            allChunksRef.current.push(chunk);
            
            // Queue for real-time playback
            pendingChunksRef.current.push(chunk);
            processPendingChunks();
          }
        }
      );
      
      // Create final audio URL for download after streaming completes
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
    } catch (error) {
      errorLogger.logError(error, '/v1/text-to-speech (stream)');
      const userMessage = errorLogger.getUserFriendlyMessage(error);
      push({ title: "Streaming failed", description: userMessage, variant: "error" });
    } finally {
      setIsGenerating(false);
      setIsStreamPlaying(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <InstructionsPanel
        title="🔊 Text-to-Speech with OpenAudio"
        description="Convert text to natural-sounding speech using OpenAudio-S1-mini. Supports multiple audio formats, sample rates, and voice cloning."
        steps={[
          {
            step: 1,
            title: "Enter Your Text",
            description: "Type or paste the text you want to convert to speech.",
            details: <code className="text-xs">Example: "Hello! Welcome to GemmaVoice Speech API."</code>
          },
          {
            step: 2,
            title: "Choose Audio Format and Settings",
            description: "Select output format (WAV, MP3, OGG, FLAC) and sample rate.",
            details: (
              <ul className="text-xs space-y-1 mt-2">
                <li>• <strong>WAV:</strong> Lossless, best quality, large file size</li>
                <li>• <strong>MP3:</strong> Compressed, smaller file, good quality (recommended)</li>
                <li>• <strong>Sample Rate:</strong> 22050 Hz (speech), 44100 Hz (music/high quality)</li>
              </ul>
            )
          },
          {
            step: 3,
            title: "Configure Voice (Optional)",
            description: "Use a reference ID or upload 3-5 audio samples for voice cloning.",
          },
          {
            step: 4,
            title: "Generate Audio",
            description: "Click 'Render audio' for complete generation or 'Stream audio' for progressive output.",
          }
        ]}
        tips={[
          "WAV format provides best quality but larger files - use for archival/editing",
          "MP3 is recommended for most use cases (good balance of size and quality)",
          "Higher sample rates (44100, 48000) give better quality but larger files",
          "Voice cloning works best with 3-5 clean audio samples (10-30 seconds each, same speaker)",
          "Enable 'Normalize' to prevent audio distortion and ensure consistent volume levels",
          "Streaming mode lets you hear audio as it's being generated - useful for longer texts",
        ]}
        troubleshooting={[
          {
            problem: "OpenAudio service unavailable error",
            solution: "Ensure the OpenAudio API container is running on port 21251. Check with: docker ps. Start with: docker compose up -d openaudio_api",
          },
          {
            problem: "No audio generated or silent output",
            solution: "Verify text is not empty. Check OpenAudio service logs with: docker logs openaudio_api. Ensure the service has loaded model checkpoints successfully.",
          },
          {
            problem: "Voice cloning not working",
            solution: "Upload 3-5 high-quality audio samples. Ensure samples are clear (no background noise), same speaker, and 10-30 seconds long. Check browser console for upload errors.",
          },
        ]}
      />

      {/* Indonesian Voice Guide Card */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xl">🇮🇩</span>
          <h3 className="text-sm font-semibold text-emerald-300">Indonesian Voice Guide</h3>
        </div>
        <p className="text-xs text-emerald-100/80 mb-3 leading-relaxed">
          The OpenAudio-s1-mini model supports Indonesian speech synthesis. For best results:
        </p>
        <ul className="text-xs space-y-2 text-emerald-100/70">
          <li className="flex gap-2">
            <span className="text-emerald-400">•</span>
            <span>Input text should be in standard Indonesian (Bahasa Indonesia).</span>
          </li>
          <li className="flex gap-2">
            <span className="text-emerald-400">•</span>
            <span>If the default voice sounds too "western", try using <strong>Voice Cloning</strong> with a sample of an Indonesian speaker (10-30s audio).</span>
          </li>
          <li className="flex gap-2">
            <span className="text-emerald-400">•</span>
            <span>Adjust <strong>Temperature</strong> to 0.3-0.5 for more stable pronunciation.</span>
          </li>
        </ul>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={runSynthesis} className="lg:col-span-2 flex flex-col gap-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-1">
            <textarea
              className="w-full h-32 rounded-lg bg-transparent px-4 py-3 text-sm focus:outline-none focus:bg-slate-900/50 transition-colors resize-none placeholder:text-slate-600"
              value={request.text}
              onChange={(event) => setRequest((prev) => ({ ...prev, text: event.target.value }))}
              placeholder="Enter text to convert to speech..."
              title={PARAM_HELP.text}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
                Format
                <span className="cursor-help opacity-50 hover:opacity-100 transition-opacity" title={PARAM_HELP.format}>ℹ️</span>
              </label>
              <select
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none"
                value={request.format}
                onChange={(event) => setRequest((prev) => ({ ...prev, format: event.target.value }))}
              >
                <option value="wav">WAV (Lossless)</option>
                <option value="mp3">MP3 (Compressed)</option>
                <option value="ogg">OGG (Compressed)</option>
                <option value="flac">FLAC (Lossless)</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
                Sample rate
                <span className="cursor-help opacity-50 hover:opacity-100 transition-opacity" title={PARAM_HELP.sampleRate}>ℹ️</span>
              </label>
              <input
                type="number"
                className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none"
                value={request.sample_rate}
                onChange={(event) => setRequest((prev) => ({ ...prev, sample_rate: Number(event.target.value) }))}
                placeholder="44100"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
                Top P
                <span className="cursor-help opacity-50 hover:opacity-100 transition-opacity" title={PARAM_HELP.topP}>ℹ️</span>
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none"
                value={request.top_p}
                onChange={(event) => setRequest((prev) => ({ ...prev, top_p: Number(event.target.value) }))}
                placeholder="0.85"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
              Reference ID
              <span className="cursor-help opacity-50 hover:opacity-100 transition-opacity" title={PARAM_HELP.referenceId}>ℹ️</span>
            </label>
            <input
              className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm focus:border-emerald-500/50 focus:outline-none disabled:opacity-50"
              value={request.reference_id}
              onChange={(event) => setRequest((prev) => ({ ...prev, reference_id: event.target.value }))}
              disabled={voiceCloning.useVoiceCloning}
              placeholder="e.g., default, voice_1"
            />
          </div>

          {/* Voice Cloning Section */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Mic className="h-4 w-4 text-emerald-400" />
              <h4 className="text-sm font-semibold text-emerald-300">Voice Cloning</h4>
              <span className="cursor-help text-slate-400 text-xs" title={PARAM_HELP.voiceCloning}>ℹ️</span>
            </div>
            <VoiceCloningInput
              referenceFiles={voiceCloning.referenceFiles}
              onFilesChange={voiceCloning.addReferenceFiles}
              onFileRemove={voiceCloning.removeReferenceFile}
              enabled={voiceCloning.useVoiceCloning}
              onEnabledChange={voiceCloning.setUseVoiceCloning}
              maxFiles={5}
            />
            <p className="text-xs text-slate-500 mt-2">
              Upload 3-5 clean audio samples (10-30s each) for best results.
            </p>
          </div>

          <label className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400 cursor-pointer hover:text-emerald-400 transition-colors">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500/20"
              checked={request.normalize}
              onChange={(event) => setRequest((prev) => ({ ...prev, normalize: event.target.checked }))}
            />
            Normalise audio loudness
          </label>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              disabled={isGenerating}
            >
              {isGenerating ? (
                <div className="h-4 w-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Render Audio
            </button>
            <button
              type="button"
              onClick={runStreaming}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm font-semibold text-emerald-400 hover:bg-slate-800 hover:border-emerald-500/50 transition-all flex items-center justify-center gap-2"
              disabled={isGenerating}
            >
              <Radio className="h-4 w-4" />
              Stream Audio
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-4">
          {audioUrl ? (
            <div className="flex-1 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b border-emerald-500/10">
                <Music className="h-5 w-5 text-emerald-400" />
                <h3 className="text-sm font-semibold text-emerald-300">Generated Audio</h3>
              </div>

              <audio controls className="w-full mb-4" src={audioUrl} />

              <a
                className="flex items-center justify-center gap-2 w-full rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                href={audioUrl}
                download={`speech-output.${request.format}`}
              >
                <Download className="h-4 w-4" />
                Download File
              </a>
            </div>
          ) : (
            <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/20 p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[300px]">
              <div className="h-12 w-12 rounded-full bg-slate-800/50 flex items-center justify-center">
                <Volume2 className="h-6 w-6 text-slate-600" />
              </div>
              <p className="text-sm text-slate-500">
                Generated audio will appear here
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

      {/* Example Texts Section */}
      <ExamplePrompts
        title="🎤 Try These Example Texts"
        description="Click any example to load it into the text field. Includes English and Indonesian samples!"
        examples={EXAMPLE_TEXTS}
        onSelect={handleExampleSelect}
        buttonLabel="Use this"
      />

      {/* FAQ Section */}
      <FAQSection
        title="❓ Text-to-Speech FAQ"
        description="Common questions about speech synthesis with OpenAudio"
        items={FAQ_ITEMS}
      />
    </div>
  );
}
