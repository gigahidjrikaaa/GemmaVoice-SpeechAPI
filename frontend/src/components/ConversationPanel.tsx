import { useEffect, useRef, useState } from "react";
import { useClientConfig } from "../context/ConfigContext";
import { apiFetch } from "../lib/apiClient";
import { useToast } from "./Toast";
import { base64ToBlob } from "../lib/audioUtils";
import { useVoiceCloning } from "../hooks/useVoiceCloning";
import { VoiceCloningInput } from "./VoiceCloningInput";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioUrl?: string;
  timestamp: Date;
  isPlaying?: boolean;
};

type TranscriptionResponse = {
  text: string;
  language?: string;
};

type GenerationResponse = {
  text: string;
};

type SpeechResponse = {
  audio_base64: string;
  response_format: string;
  media_type: string;
};

export function ConversationPanel() {
  const { config } = useClientConfig();
  const { push } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful AI assistant. Keep your responses concise and conversational."
  );
  const [useVoiceResponse, setUseVoiceResponse] = useState(true);
  const [autoPlayResponse, setAutoPlayResponse] = useState(true);
  const voiceCloning = useVoiceCloning();
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await processAudio(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      push({ title: "Recording started", description: "Speak now..." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Microphone access denied";
      push({ title: "Recording failed", description: message, variant: "error" });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    
    try {
      // Step 1: Speech-to-Text (Whisper)
      const formData = new FormData();
      formData.append("file", audioBlob, "recording.webm");

      const { data: transcription } = await apiFetch<TranscriptionResponse>(
        config,
        "/v1/speech-to-text",
        {
          method: "POST",
          body: formData,
        }
      );

      const userText = transcription.text.trim();
      if (!userText) {
        push({ title: "No speech detected", variant: "error" });
        setIsProcessing(false);
        return;
      }

      // Add user message
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        text: userText,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Step 2: Generate response (Gemma LLM)
      const conversationHistory = [...messages, userMessage]
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
        .join("\n");

      const prompt = `${systemPrompt}\n\nConversation history:\n${conversationHistory}\n\nAssistant:`;

      const { data: generation } = await apiFetch<GenerationResponse>(
        config,
        "/v1/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            max_tokens: 200,
            temperature: 0.7,
            top_p: 0.9,
          }),
        }
      );

      const assistantText = generation.text.trim();

      // Step 3: Text-to-Speech (OpenAudio) - Optional
      let audioUrl: string | undefined;
      if (useVoiceResponse) {
        try {
          // Get references from voice cloning hook
          const references = await voiceCloning.getReferences();

          const { data: speech } = await apiFetch<SpeechResponse>(
            config,
            "/v1/text-to-speech",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: assistantText,
                format: "mp3",
                sample_rate: 24000,
                normalize: true,
                references: references.length > 0 ? references : undefined,
              }),
            }
          );

          const audioBlob = base64ToBlob(speech.audio_base64, `audio/${speech.response_format}`);
          audioUrl = URL.createObjectURL(audioBlob);
        } catch (error) {
          console.error("TTS failed:", error);
          push({ 
            title: "TTS unavailable", 
            description: "Response shown as text only", 
            variant: "error" 
          });
        }
      }

      // Add assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: assistantText,
        audioUrl,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      // Auto-play audio if enabled
      if (audioUrl && autoPlayResponse) {
        setTimeout(() => playAudio(assistantMessage.id, audioUrl), 100);
      }

      push({ title: "Response generated" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Processing failed";
      push({ title: "Error", description: message, variant: "error" });
    } finally {
      setIsProcessing(false);
    }
  };

  const playAudio = (messageId: string, audioUrl: string) => {
    // Stop current audio if playing
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }

    const audio = new Audio(audioUrl);
    currentAudioRef.current = audio;

    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, isPlaying: true } : { ...m, isPlaying: false }
      )
    );

    audio.onended = () => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, isPlaying: false } : m))
      );
      currentAudioRef.current = null;
    };

    audio.play();
  };

  const clearConversation = () => {
    setMessages([]);
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
  };

  const exportConversationAsJSON = () => {
    if (messages.length === 0) {
      push({ title: "No messages to export", variant: "error" });
      return;
    }
    const data = JSON.stringify(messages, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    push({ title: "Conversation exported as JSON" });
  };

  const exportConversationAsText = () => {
    if (messages.length === 0) {
      push({ title: "No messages to export", variant: "error" });
      return;
    }
    const text = messages
      .map(m => `[${m.timestamp.toLocaleString()}] ${m.role === 'user' ? 'You' : 'Assistant'}: ${m.text}`)
      .join('\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    push({ title: "Conversation exported as text" });
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Settings Panel */}
      <div className="rounded-md border border-slate-800 bg-slate-900/60 p-4">
        <h3 className="text-sm font-semibold text-emerald-300 mb-3">⚙️ Conversation Settings</h3>
        
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">System Prompt</span>
            <textarea
              className="h-20 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Define the AI assistant's personality and behavior..."
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border border-slate-700 bg-slate-950"
                checked={useVoiceResponse}
                onChange={(e) => setUseVoiceResponse(e.target.checked)}
              />
              🔊 Voice responses
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border border-slate-700 bg-slate-950"
                checked={autoPlayResponse}
                onChange={(e) => setAutoPlayResponse(e.target.checked)}
                disabled={!useVoiceResponse}
              />
              ▶️ Auto-play
            </label>
          </div>

          {/* Voice Cloning Section */}
          {useVoiceResponse && (
            <VoiceCloningInput
              referenceFiles={voiceCloning.referenceFiles}
              onFilesChange={voiceCloning.addReferenceFiles}
              onFileRemove={voiceCloning.removeReferenceFile}
              enabled={voiceCloning.useVoiceCloning}
              onEnabledChange={voiceCloning.setUseVoiceCloning}
              maxFiles={5}
              className="border-t border-slate-700 pt-3"
            />
          )}
        </div>
      </div>

      {/* Conversation Area */}
      <div className="flex-1 rounded-md border border-slate-800 bg-slate-900/60 p-4 overflow-y-auto min-h-[400px] max-h-[600px]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-emerald-300">💬 Live Conversation</h3>
          {messages.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={exportConversationAsJSON}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                title="Export as JSON"
              >
                📄 Export JSON
              </button>
              <button
                onClick={exportConversationAsText}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                title="Export as Text"
              >
                📝 Export TXT
              </button>
              <button
                onClick={clearConversation}
                className="text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                Clear chat
              </button>
            </div>
          )}
        </div>

        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="text-6xl mb-4">🎙️</div>
            <p className="text-slate-400 text-sm">No messages yet</p>
            <p className="text-slate-500 text-xs mt-2">
              Click the microphone button below to start a conversation
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    message.role === "user"
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-800 text-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold">
                      {message.role === "user" ? "You" : "Assistant"}
                    </span>
                    <span className="text-xs opacity-60">
                      {message.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.text}</p>
                  
                  {message.audioUrl && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => playAudio(message.id, message.audioUrl!)}
                        className={`text-xs px-2 py-1 rounded ${
                          message.isPlaying
                            ? "bg-emerald-500 text-white"
                            : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                        } transition-colors`}
                      >
                        {message.isPlaying ? "🔊 Playing..." : "▶️ Play audio"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="rounded-md border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-center justify-center gap-4">
          {!isRecording && !isProcessing && (
            <button
              onClick={startRecording}
              className="flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-colors shadow-lg"
            >
              <span className="text-xl">🎙️</span>
              <span>Start Recording</span>
            </button>
          )}

          {isRecording && (
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 rounded-full bg-red-500 px-6 py-3 text-sm font-semibold text-white hover:bg-red-400 transition-colors shadow-lg animate-pulse"
            >
              <span className="text-xl">⏹️</span>
              <span>Stop Recording</span>
            </button>
          )}

          {isProcessing && (
            <div className="flex items-center gap-3 px-6 py-3 text-sm text-emerald-300">
              <div className="animate-spin">⚙️</div>
              <span>Processing your message...</span>
            </div>
          )}
        </div>

        <div className="mt-3 text-center">
          <p className="text-xs text-slate-400">
            {isRecording
              ? "🔴 Recording in progress - speak clearly"
              : isProcessing
              ? "Processing: STT → LLM → TTS"
              : `${messages.length} message(s) in conversation`}
          </p>
        </div>
      </div>
    </div>
  );
}
