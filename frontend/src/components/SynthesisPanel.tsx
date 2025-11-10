import { FormEvent, useEffect, useMemo, useState } from "react";
import { useClientConfig } from "../context/ConfigContext";
import { apiFetch, apiFetchStream } from "../lib/apiClient";
import { base64ToBlob } from "../lib/audioUtils";
import { useVoiceCloning } from "../hooks/useVoiceCloning";
import { VoiceCloningInput } from "./VoiceCloningInput";
import { useToast } from "./Toast";
import { InstructionsPanel } from "./InstructionsPanel";
import { errorLogger } from "../lib/errorLogger";

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

export function SynthesisPanel() {
  const { config } = useClientConfig();
  const { push } = useToast();
  const [request, setRequest] = useState(defaultRequest);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [streamLog, setStreamLog] = useState<StreamEvent[]>([]);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  
  // Use shared voice cloning hook
  const voiceCloning = useVoiceCloning();

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  const headers = useMemo(() => ({ "Content-Type": "application/json" }), []);

  const runSynthesis = async (event: FormEvent) => {
    event.preventDefault();
    setStreamLog([]);
    try {
      // Get base64 encoded references from voice cloning hook
      const references = await voiceCloning.getReferences();
      errorLogger.logInfo('Starting text-to-speech synthesis', { 
        textLength: request.text.length,
        format: request.format,
        sampleRate: request.sample_rate,
        useVoiceCloning: voiceCloning.useVoiceCloning,
        referencesCount: references.length
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
        errorLogger.logInfo('Synthesis completed', { 
          audioBlobSize: blob.size,
          format 
        });
      }
      push({ title: "Synthesis complete" });
    } catch (error) {
      errorLogger.logError(error, '/v1/text-to-speech', { 
        textLength: request.text.length,
        format: request.format 
      });
      const userMessage = errorLogger.getUserFriendlyMessage(error);
      push({ title: "Synthesis failed", description: userMessage, variant: "error" });
    }
  };

  const runStreaming = async () => {
    setStreamLog([]);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      setObjectUrl(null);
    }
    setAudioUrl(null);
    const chunks: ArrayBuffer[] = [];
    try {
      // Get references from voice cloning hook
      const references = await voiceCloning.getReferences();
      errorLogger.logInfo('Starting streaming text-to-speech synthesis', { 
        textLength: request.text.length,
        format: request.format,
        sampleRate: request.sample_rate,
        useVoiceCloning: voiceCloning.useVoiceCloning,
        referencesCount: references.length
      });

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
          errorLogger.logDebug('Stream event received', { 
            eventType: event.event,
            hasData: !!event.data
          });
          setStreamLog((prev) => [...prev, { event: String(event.event ?? "data"), data: event.data }]);
          if (event.event === "audio_chunk" && typeof event.data === "string") {
            const chunk = Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0)).buffer;
            chunks.push(chunk);
          }
        }
      );
      if (chunks.length) {
        const blob = new Blob(chunks, { type: `audio/${request.format ?? "wav"}` });
        const url = URL.createObjectURL(blob);
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        setObjectUrl(url);
        setAudioUrl(url);
        errorLogger.logInfo('Streaming synthesis completed', { 
          audioBlobSize: blob.size,
          chunksCount: chunks.length,
          format: request.format 
        });
      }
      push({ title: "Streaming synthesis finished" });
    } catch (error) {
      errorLogger.logError(error, '/v1/text-to-speech (stream)', { 
        textLength: request.text.length,
        format: request.format 
      });
      const userMessage = errorLogger.getUserFriendlyMessage(error);
      push({ title: "Streaming failed", description: userMessage, variant: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
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
              <ul className="text-sm space-y-1 mt-2">
                <li>• <strong>WAV:</strong> Lossless, best quality, large file size</li>
                <li>• <strong>MP3:</strong> Compressed, smaller file, good quality (recommended)</li>
                <li>• <strong>OGG:</strong> Open format, good compression</li>
                <li>• <strong>FLAC:</strong> Lossless compression, better than WAV for storage</li>
                <li>• <strong>Sample Rate:</strong> 22050 Hz (speech), 44100 Hz (music/high quality)</li>
              </ul>
            )
          },
          {
            step: 3,
            title: "Configure Voice (Optional)",
            description: "Use a reference ID or upload 3-5 audio samples for voice cloning.",
            details: (
              <p className="text-sm mt-2">
                Voice cloning creates a custom voice based on your audio samples. Best results with 3-5 clean recordings (10-30 seconds each) of the same speaker.
              </p>
            )
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
            solution: "Ensure OpenAudio container is running on port 21251. Check with: docker ps. Start with: docker compose up -d openaudio_service",
          },
          {
            problem: "No audio generated or silent output",
            solution: "Verify text is not empty. Check OpenAudio service logs with: docker logs openaudio_service. Ensure the service has loaded model checkpoints successfully.",
          },
          {
            problem: "Voice cloning not working",
            solution: "Upload 3-5 high-quality audio samples. Ensure samples are clear (no background noise), same speaker, and 10-30 seconds long. Check browser console for upload errors.",
          },
          {
            problem: "Audio playback fails in browser",
            solution: "Try different format (MP3 instead of WAV). Ensure browser supports the audio format. Check browser console for MIME type errors.",
          },
          {
            problem: "File download not working",
            solution: "Check browser download settings and permissions. Try right-click → Save As on the audio player. Verify audio was generated successfully first.",
          },
        ]}
      />
      <form onSubmit={runSynthesis} className="grid gap-4 md:grid-cols-2">
        <label className="flex h-full flex-col gap-2 md:col-span-2">
          <span className="text-sm font-medium flex items-center gap-1">
            Text
            <span className="cursor-help text-slate-400" title={PARAM_HELP.text}>ℹ️</span>
          </span>
          <textarea
            className="h-32 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={request.text}
            onChange={(event) => setRequest((prev) => ({ ...prev, text: event.target.value }))}
            placeholder="Enter text to convert to speech..."
            title={PARAM_HELP.text}
          />
        </label>
        <div className="flex flex-col gap-2">
          <label className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1">
            Format
            <span className="cursor-help" title={PARAM_HELP.format}>ℹ️</span>
          </label>
          <select
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={request.format}
            onChange={(event) => setRequest((prev) => ({ ...prev, format: event.target.value }))}
            title={PARAM_HELP.format}
          >
            <option value="wav">WAV (Lossless)</option>
            <option value="mp3">MP3 (Compressed)</option>
            <option value="ogg">OGG (Compressed)</option>
            <option value="flac">FLAC (Lossless compressed)</option>
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1">
            Sample rate
            <span className="cursor-help" title={PARAM_HELP.sampleRate}>ℹ️</span>
          </label>
          <input
            type="number"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={request.sample_rate}
            onChange={(event) => setRequest((prev) => ({ ...prev, sample_rate: Number(event.target.value) }))}
            placeholder="44100"
            title={PARAM_HELP.sampleRate}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs uppercase tracking-wide text-slate-400 flex items-center gap-1">
            Reference ID
            <span className="cursor-help" title={PARAM_HELP.referenceId}>ℹ️</span>
          </label>
          <input
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={request.reference_id}
            onChange={(event) => setRequest((prev) => ({ ...prev, reference_id: event.target.value }))}
            disabled={voiceCloning.useVoiceCloning}
            placeholder="e.g., default, voice_1"
            title={PARAM_HELP.referenceId}
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
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={request.top_p}
            onChange={(event) => setRequest((prev) => ({ ...prev, top_p: Number(event.target.value) }))}
            placeholder="0.85"
            title={PARAM_HELP.topP}
          />
        </div>
        
        {/* Voice Cloning Section */}
        <div className="md:col-span-2 rounded-md border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <h4 className="text-sm font-semibold text-emerald-300">🎭 Voice Cloning</h4>
            <span className="cursor-help text-slate-400" title={PARAM_HELP.voiceCloning}>ℹ️</span>
          </div>
          <VoiceCloningInput
            referenceFiles={voiceCloning.referenceFiles}
            onFilesChange={voiceCloning.addReferenceFiles}
            onFileRemove={voiceCloning.removeReferenceFile}
            enabled={voiceCloning.useVoiceCloning}
            onEnabledChange={voiceCloning.setUseVoiceCloning}
            maxFiles={5}
          />
          <p className="text-xs text-slate-400 mt-2">
            💡 Tip: Upload 3-5 clean audio samples (10-30 seconds each) for best voice cloning results
          </p>
        </div>

        <label className="flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400 md:col-span-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border border-slate-700 bg-slate-950"
            checked={request.normalize}
            onChange={(event) => setRequest((prev) => ({ ...prev, normalize: event.target.checked }))}
            title={PARAM_HELP.normalize}
          />
          Normalise audio loudness
          <span className="cursor-help" title={PARAM_HELP.normalize}>ℹ️</span>
        </label>
        <div className="flex items-center gap-2 md:col-span-2">
          <button type="submit" className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950">
            Render audio
          </button>
          <button
            type="button"
            onClick={runStreaming}
            className="rounded-md border border-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-300"
          >
            Stream audio
          </button>
        </div>
      </form>
      {audioUrl ? (
        <div className="rounded-md border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-emerald-300">Preview</h3>
          <audio controls className="mt-2 w-full" src={audioUrl} />
          <a
            className="mt-3 inline-flex items-center text-xs text-emerald-300 underline"
            href={audioUrl}
            download="speech-output"
          >
            Download audio
          </a>
        </div>
      ) : null}
      {streamLog.length ? (
        <div className="rounded-md border border-slate-800 bg-slate-900/60 p-4">
          <h3 className="text-sm font-semibold text-emerald-300">Streaming events</h3>
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
