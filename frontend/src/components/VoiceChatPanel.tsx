import { ChangeEvent, FormEvent, useEffect, useRef, useState, useCallback } from "react";
import { useClientConfig } from "../context/ConfigContext";
import { useCode } from "../context/CodeContext";
import { apiFetch, apiFetchStream } from "../lib/apiClient";
import { base64ToBlob, fileToBase64 } from "../lib/audioUtils";
import { useToast } from "./Toast";
import { InstructionsPanel } from "./InstructionsPanel";
import { FAQSection, type FAQItem } from "./FAQSection";
import { AudioVisualizer } from "./AudioVisualizer";
import { useVAD, float32ToWav } from "../hooks/useVAD";
import { LiveKitVoiceChat } from "./LiveKitVoiceChat";
import {
    MessageSquare, Upload, Play, Radio, FileAudio,
    User, Bot, Volume2, Mic, Activity, Zap, Hand, Wifi, Server
} from "lucide-react";

// --- Types ---

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

type Message = {
    role: "user" | "assistant";
    content: string;
};

const defaultRequest = {
    instructions: "You are a helpful voice assistant. Keep responses concise and conversational.",
    stream_audio: true
};

const PARAM_HELP = {
    audio: "Upload an audio file (WAV, MP3, WEBM) containing the user's query.",
    instructions: "System instructions for the AI assistant. Defines the persona and behavior.",
    streamAudio: "If enabled, audio response is streamed back in chunks for lower latency."
};

// FAQ items for voice chat
const FAQ_ITEMS: FAQItem[] = [
    {
        question: "What's the difference between Live Chat and File Analysis?",
        answer: "Live Chat uses WebSocket for real-time voice conversation - you speak, and the AI responds immediately. File Analysis processes a pre-recorded audio file and returns transcription, AI response, and synthesized audio. Use Live Chat for interactive conversations; File Analysis for processing existing recordings.",
        category: "Basics"
    },
    {
        question: "Does Voice Chat support Indonesian?",
        answer: "Yes! Voice Chat combines Whisper (STT) + Gemma 3 (LLM) + OpenAudio (TTS), all of which support Indonesian. You can speak in Indonesian, and the AI will understand and respond in Indonesian. Set your instructions to include 'Respond in Indonesian' for best results.",
        category: "Language"
    },
    {
        question: "How do system instructions work?",
        answer: (
            <div className="space-y-2">
                <p>System instructions define the AI's persona and behavior. Examples:</p>
                <ul className="list-disc ml-4 space-y-1">
                    <li>"You are a helpful voice assistant. Keep responses concise."</li>
                    <li>"Anda adalah asisten virtual berbahasa Indonesia yang ramah."</li>
                    <li>"You are a technical support agent who helps troubleshoot software."</li>
                </ul>
            </div>
        ),
        category: "Configuration"
    },
    {
        question: "Why is Live Chat not connecting?",
        answer: "Live Chat uses WebSocket, which requires: 1) Microphone permissions granted in your browser, 2) HTTPS or localhost (WebSockets may be blocked on insecure HTTP), 3) All backend services running (gemma_service, whisper_service, openaudio_api). Check browser console for specific errors.",
        category: "Troubleshooting"
    },
    {
        question: "How can I improve response quality?",
        answer: (
            <ul className="space-y-1 mt-2">
                <li>• Use a good quality microphone in a quiet environment</li>
                <li>• Speak clearly and at a normal pace</li>
                <li>• Write clear, specific system instructions</li>
                <li>• Use headphones to prevent echo (especially in Live Chat)</li>
                <li>• For File Analysis, ensure audio is clear without background noise</li>
            </ul>
        ),
        category: "Tips"
    },
    {
        question: "What happens if I get audio feedback/echo in Live Chat?",
        answer: "Use headphones! Without them, the AI's audio response can be picked up by your microphone, creating echo. This is especially important in Live Chat mode where the conversation is continuous.",
        category: "Troubleshooting"
    },
    {
        question: "What audio formats work for File Analysis?",
        answer: "File Analysis accepts WAV, MP3, WEBM, and most common audio formats. Maximum file size is typically 10MB. For best results, use clear audio recordings with minimal background noise.",
        category: "Basics"
    },
    {
        question: "Can I use Voice Chat for long conversations?",
        answer: "Live Chat is designed for short, interactive exchanges. For longer conversations, consider using File Analysis with longer recordings, or use the Text Generation tab for extended written conversations. The WebSocket connection may timeout after extended periods of inactivity.",
        category: "Limitations"
    }
];

// --- Main Component ---

export function VoiceChatPanel() {
    const { config } = useClientConfig();
    const { setSnippet } = useCode();
    const { push } = useToast();

    const [connectionMode, setConnectionMode] = useState<"websocket" | "livekit">("websocket");
    const [activeMode, setActiveMode] = useState<"live" | "file">("live");
    const [inputMode, setInputMode] = useState<"vad" | "push">("vad"); // VAD or Push-to-talk

    // --- Live Chat State ---
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [status, setStatus] = useState<string>("Ready to connect");
    const [audioBytes, setAudioBytes] = useState(0);
    const [recordingTime, setRecordingTime] = useState(0);
    const [chunksSent, setChunksSent] = useState(0);
    const [speechProbability, setSpeechProbability] = useState(0);
    const wsRef = useRef<WebSocket | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioQueueRef = useRef<string[]>([]);
    const isPlayingRef = useRef(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const vadStartTimeRef = useRef<number | null>(null);

    // --- File Analysis State ---
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [request, setRequest] = useState(defaultRequest);
    const [result, setResult] = useState<DialogueResponse | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [streamLog, setStreamLog] = useState<StreamEvent[]>([]);
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);

    // --- VAD Speech Detection Callbacks ---
    const handleSpeechStart = useCallback(() => {
        console.log("[VAD] Speech started");
        vadStartTimeRef.current = Date.now();
        setIsRecording(true);
        setRecordingTime(0);
        setStatus("🎙️ Listening...");
        
        // Start recording time counter
        recordingTimerRef.current = setInterval(() => {
            setRecordingTime(prev => prev + 0.1);
        }, 100);
    }, []);

    const handleSpeechEnd = useCallback(async (audio: Float32Array) => {
        console.log("[VAD] Speech ended, samples:", audio.length);
        
        // Stop the timer
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
        
        setIsRecording(false);
        setStatus("⏳ Processing...");
        
        // Convert Float32Array to WAV and send
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            try {
                const wavBlob = float32ToWav(audio, 16000);
                const base64 = await fileToBase64(wavBlob);
                console.log("[VAD] Sending audio, base64 length:", base64.length);
                
                wsRef.current.send(JSON.stringify({
                    type: "audio",
                    data: base64,
                    format: "wav" // Tell backend it's already WAV
                }));
                
                // Send end_turn immediately since VAD already detected speech end
                wsRef.current.send(JSON.stringify({ type: "end_turn" }));
                setChunksSent(1);
            } catch (err) {
                console.error("[VAD] Error sending audio:", err);
                setStatus("Error sending audio");
            }
        }
    }, []);

    const handleFrameProcessed = useCallback((probs: { isSpeech: number; notSpeech: number }) => {
        setSpeechProbability(probs.isSpeech);
    }, []);

    // --- VAD Hook ---
    const vad = useVAD({
        onSpeechStart: handleSpeechStart,
        onSpeechEnd: handleSpeechEnd,
        onFrameProcessed: handleFrameProcessed,
        positiveSpeechThreshold: 0.6,
        negativeSpeechThreshold: 0.4,
        redemptionMs: 400, // 400ms of silence before ending
        minSpeechMs: 200, // Require 200ms of speech to trigger
    });

    // --- Cleanup ---
    useEffect(() => {
        return () => {
            stopConversation();
            vad.stop();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [objectUrl, vad]);

    // --- Code Snippet Updates ---
    useEffect(() => {
        if (activeMode === "live") {
            const wsUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/conversation/ws";
            const code = `// WebSocket Connection for Live Conversation
const ws = new WebSocket("${wsUrl}");

ws.onopen = () => {
  console.log("Connected to conversation server");
  
  // Start recording and sending audio
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          // Convert to base64 and send
          // Implementation details omitted for brevity
        }
      };
      recorder.start(500);
    });
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "audio") playAudio(data.data);
  if (data.type === "text") console.log(data.role, data.content);
};`;
            setSnippet({ language: "javascript", code, title: "Live Conversation Logic" });
        } else {
            const curl = `curl -X POST ${config.baseUrl}/v1/conversation/dialogue \\
  -H "Content-Type: multipart/form-data" \\
  -F "audio=@/path/to/audio.wav" \\
  -F "instructions='${request.instructions}'" \\
  -F "stream_audio=${request.stream_audio}"`;
            setSnippet({ language: "bash", code: curl, title: "Dialogue Request" });
        }
    }, [activeMode, request, config.baseUrl, setSnippet]);

    // --- Live Chat Logic ---

    const playNextAudio = async () => {
        if (audioQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            return;
        }

        isPlayingRef.current = true;
        const audioBase64 = audioQueueRef.current.shift();

        if (!audioBase64) {
            playNextAudio();
            return;
        }

        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }

            const res = await fetch(`data:audio/wav;base64,${audioBase64}`);
            const arrayBuffer = await res.arrayBuffer();
            const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);

            const source = audioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContextRef.current.destination);
            source.onended = () => {
                playNextAudio();
            };
            source.start(0);
        } catch (error) {
            console.error("Error playing audio:", error);
            playNextAudio();
        }
    };

    const startConversation = async () => {
        try {
            // For VAD mode, we don't need getUserMedia here - VAD handles it
            if (inputMode === "vad") {
                // First establish WebSocket connection
                const wsBaseUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/conversation/ws";
                const wsUrl = config.apiKey ? `${wsBaseUrl}?api_key=${encodeURIComponent(config.apiKey)}` : wsBaseUrl;
                const ws = new WebSocket(wsUrl);
                wsRef.current = ws;

                ws.onopen = async () => {
                    setIsConnected(true);
                    setStatus("🔄 Starting VAD...");
                    push({ title: "Connected - starting voice detection" });
                    
                    // Start VAD after WebSocket is connected
                    try {
                        await vad.start();
                        setStatus("🎤 Listening for speech...");
                    } catch (err) {
                        console.error("[VAD] Failed to start:", err);
                        push({ title: "VAD Error", description: "Failed to start voice detection", variant: "error" });
                        setStatus("VAD failed - try Push-to-Talk mode");
                    }
                };

                ws.onmessage = handleWebSocketMessage;
                ws.onclose = handleWebSocketClose;
                ws.onerror = handleWebSocketError;
                return;
            }

            // Push-to-talk mode: use MediaRecorder
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Pass API key via query parameter since browsers can't set WebSocket headers
            const wsBaseUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/conversation/ws";
            const wsUrl = config.apiKey ? `${wsBaseUrl}?api_key=${encodeURIComponent(config.apiKey)}` : wsBaseUrl;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                setIsConnected(true);
                setStatus("Connected - Hold mic button to speak");
                push({ title: "Connected to conversation server" });

                const mediaRecorder = new MediaRecorder(stream);
                mediaRecorderRef.current = mediaRecorder;

                mediaRecorder.ondataavailable = async (event) => {
                    console.log("[VoiceChat] ondataavailable fired, size:", event.data.size, "bytes, WS state:", ws.readyState);
                    if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
                        try {
                            const base64Audio = await fileToBase64(event.data);
                            console.log("[VoiceChat] Sending chunk, base64 length:", base64Audio.length);
                            ws.send(JSON.stringify({
                                type: "audio",
                                data: base64Audio
                            }));
                            setChunksSent(prev => prev + 1);
                        } catch (err) {
                            console.error("[VoiceChat] Error converting audio chunk:", err);
                        }
                    }
                };
                
                mediaRecorder.onstart = () => {
                    console.log("[VoiceChat] MediaRecorder started");
                };
                
                mediaRecorder.onstop = () => {
                    console.log("[VoiceChat] MediaRecorder stopped");
                };
                
                mediaRecorder.onerror = (e) => {
                    console.error("[VoiceChat] MediaRecorder error:", e);
                };
                
                // Don't auto-start recording - wait for push-to-talk
            };

            ws.onmessage = handleWebSocketMessage;
            ws.onclose = handleWebSocketClose;
            ws.onerror = handleWebSocketError;

        } catch (error) {
            console.error("Error accessing microphone:", error);
            push({ title: "Microphone error", description: "Could not access microphone", variant: "error" });
        }
    };

    // --- WebSocket Event Handlers ---
    const handleWebSocketMessage = useCallback((event: MessageEvent) => {
        const data = JSON.parse(event.data);
        console.log("Voice chat message:", data);

        if (data.type === "ready") {
            if (inputMode === "vad") {
                setStatus("🎤 Listening for speech...");
            } else {
                setStatus("✅ " + (data.message || "Ready"));
            }
        } else if (data.type === "buffering") {
            setAudioBytes(data.bytes || 0);
        } else if (data.type === "processing") {
            setStatus(data.message || "Processing...");
        } else if (data.type === "transcript") {
            setMessages(prev => [...prev, { role: data.role, content: data.content }]);
            if (inputMode === "vad") {
                setStatus("🎤 Listening for speech...");
            }
        } else if (data.type === "text") {
            setMessages(prev => [...prev, { role: data.role, content: data.content }]);
        } else if (data.type === "audio") {
            audioQueueRef.current.push(data.data);
            if (!isPlayingRef.current) {
                playNextAudio();
            }
        } else if (data.type === "error") {
            push({ title: "Error", description: data.message, variant: "error" });
            setStatus("Error - try again");
        }
    }, [inputMode, push]);

    const handleWebSocketClose = useCallback(() => {
        setIsConnected(false);
        setStatus("Disconnected");
        stopConversation();
    }, []);

    const handleWebSocketError = useCallback((error: Event) => {
        console.error("WebSocket error:", error);
        push({ title: "Connection error", description: "WebSocket connection failed", variant: "error" });
        stopConversation();
    }, [push]);
    
    const startRecording = () => {
        console.log("[VoiceChat] startRecording called, mediaRecorder state:", mediaRecorderRef.current?.state);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "inactive") {
            setAudioBytes(0);
            setChunksSent(0);
            setRecordingTime(0);
            
            // Start the stopwatch
            recordingTimerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 0.1);
            }, 100);
            
            mediaRecorderRef.current.start(250); // Send chunks every 250ms
            setIsRecording(true);
            setStatus("🎙️ Recording... Release to send");
            console.log("[VoiceChat] MediaRecorder.start(250) called");
        } else {
            console.warn("[VoiceChat] Cannot start recording - recorder state:", mediaRecorderRef.current?.state);
        }
    };
    
    const stopRecording = () => {
        console.log("[VoiceChat] stopRecording called, mediaRecorder state:", mediaRecorderRef.current?.state);
        
        // Stop the stopwatch
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
        
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setStatus("⏳ Processing...");
            console.log("[VoiceChat] MediaRecorder.stop() called");
            
            // Send end_turn signal after a longer delay to ensure all chunks are sent
            setTimeout(() => {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    console.log("[VoiceChat] Sending end_turn signal");
                    wsRef.current.send(JSON.stringify({ type: "end_turn" }));
                }
            }, 300);
        }
    };

    const stopConversation = () => {
        // Stop VAD if running
        vad.stop();
        
        // Stop timer
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
        
        if (mediaRecorderRef.current) {
            if (mediaRecorderRef.current.state === "recording") {
                mediaRecorderRef.current.stop();
            }
            mediaRecorderRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        setIsConnected(false);
        setIsRecording(false);
        setStatus("Disconnected");
    };

    const toggleConnection = () => {
        if (isConnected) stopConversation();
        else startConversation();
    };

    // --- File Analysis Logic ---

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        if (event.target.files?.length) {
            setFileName(event.target.files[0].name);
            setResult(null);
            setAudioUrl(null);
        } else {
            setFileName(null);
        }
    };

    const handleFileSubmit = async (event: FormEvent<HTMLFormElement>) => {
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
            const { data } = await apiFetch<DialogueResponse>(config, "/v1/conversation/dialogue", {
                method: "POST",
                body: form
            });
            setResult(data);
            if (data.audio_base64) {
                const blob = base64ToBlob(data.audio_base64, 'audio/wav');
                if (objectUrl) URL.revokeObjectURL(objectUrl);
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

    const handleFileStream = async () => {
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
                "/v1/conversation/dialogue",
                { method: "POST", body: form },
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
                if (objectUrl) URL.revokeObjectURL(objectUrl);
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
                title="🎙️ Voice Chat"
                description="Interact with Gemma 3 using your voice. Choose between real-time conversation or file-based analysis."
                steps={[
                    { step: 1, title: "Select Mode", description: "Choose 'Live Chat' for real-time or 'File Analysis' for pre-recorded audio." },
                    { step: 2, title: "Provide Input", description: "Speak into your microphone or upload an audio file." },
                    { step: 3, title: "Get Response", description: "Receive both text transcript and synthesized audio response." }
                ]}
                tips={[
                    "Use headphones for Live Chat to avoid echo.",
                    "File Analysis is better for long, complex queries.",
                    "Instructions apply to both modes to set the persona."
                ]}
            />

            {/* Connection Mode Selector (WebSocket vs LiveKit) */}
            <div className="flex items-center gap-4">
                <span className="text-xs text-slate-500 uppercase tracking-wider">Connection:</span>
                <div className="flex p-1 bg-slate-900/50 rounded-lg border border-slate-800">
                    <button
                        onClick={() => setConnectionMode("websocket")}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                            connectionMode === "websocket"
                                ? "bg-blue-500 text-slate-950 shadow-lg shadow-blue-500/20"
                                : "text-slate-400 hover:text-slate-200"
                        }`}
                    >
                        <Wifi className="h-3 w-3" />
                        WebSocket
                    </button>
                    <button
                        onClick={() => setConnectionMode("livekit")}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                            connectionMode === "livekit"
                                ? "bg-purple-500 text-slate-950 shadow-lg shadow-purple-500/20"
                                : "text-slate-400 hover:text-slate-200"
                        }`}
                    >
                        <Server className="h-3 w-3" />
                        LiveKit
                    </button>
                </div>
                <span className="text-xs text-slate-600">
                    {connectionMode === "livekit" 
                        ? "Low-latency SFU for production" 
                        : "Direct WebSocket for development"}
                </span>
            </div>

            {/* LiveKit Mode */}
            {connectionMode === "livekit" && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden" style={{ minHeight: "400px" }}>
                    <LiveKitVoiceChat />
                </div>
            )}

            {/* WebSocket Mode - Original UI */}
            {connectionMode === "websocket" && (
                <>
                    {/* Mode Switcher */}
                    <div className="flex p-1 bg-slate-900/50 rounded-lg border border-slate-800 w-fit">
                        <button
                            onClick={() => setActiveMode("live")}
                            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeMode === "live"
                                    ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20"
                                    : "text-slate-400 hover:text-slate-200"
                                }`}
                        >
                            <Mic className="h-4 w-4" />
                            Live Chat
                        </button>
                        <button
                            onClick={() => setActiveMode("file")}
                            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeMode === "file"
                            ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                >
                    <FileAudio className="h-4 w-4" />
                    File Analysis
                </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Left Column: Controls */}
                <div className="lg:col-span-2 flex flex-col gap-6">

                    {/* LIVE CHAT MODE */}
                    {activeMode === "live" && (
                        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 flex flex-col items-center gap-6 relative overflow-hidden">
                            {/* Status bar */}
                            <div className={`w-full flex items-center justify-between text-xs font-mono px-3 py-2 rounded-lg border ${
                                isRecording
                                    ? "border-red-500/50 bg-red-500/10 text-red-400"
                                    : isConnected
                                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                        : "border-slate-700 bg-slate-800/50 text-slate-400"
                                }`}>
                                <div className="flex items-center gap-2">
                                    <div className={`h-2 w-2 rounded-full ${
                                        isRecording ? "bg-red-500 animate-pulse" : isConnected ? "bg-emerald-500 animate-pulse" : "bg-slate-500"
                                    }`} />
                                    <span>{status}</span>
                                </div>
                                {isRecording && (
                                    <span className="text-red-300">{(audioBytes / 1024).toFixed(1)} KB</span>
                                )}
                            </div>

                            {/* Audio Visualizer */}
                            <div className={`w-full h-40 rounded-lg border bg-slate-950/50 relative overflow-hidden transition-all ${
                                isRecording ? "border-red-500/50 shadow-lg shadow-red-500/10" : "border-slate-800"
                            }`}>
                                {isConnected ? (
                                    <AudioVisualizer stream={streamRef.current} className="w-full h-full" />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-slate-600">
                                        <div className="text-center">
                                            <Radio className="h-10 w-10 mx-auto mb-2 opacity-20" />
                                            <p className="text-sm">Click Connect to start</p>
                                        </div>
                                    </div>
                                )}
                                {isRecording && (
                                    <div className="absolute inset-0 border-4 border-red-500/30 rounded-lg pointer-events-none animate-pulse" />
                                )}
                            </div>

                            {/* Main Controls */}
                            <div className="flex flex-col items-center gap-4 w-full">
                                {!isConnected ? (
                                    <>
                                        {/* Input Mode Toggle */}
                                        <div className="flex gap-2 p-1 bg-slate-800/50 rounded-lg border border-slate-700">
                                            <button
                                                onClick={() => setInputMode("vad")}
                                                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-all ${
                                                    inputMode === "vad"
                                                        ? "bg-emerald-500 text-slate-950 font-medium"
                                                        : "text-slate-400 hover:text-slate-200"
                                                }`}
                                            >
                                                <Zap className="h-4 w-4" />
                                                Auto Detect (VAD)
                                            </button>
                                            <button
                                                onClick={() => setInputMode("push")}
                                                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-all ${
                                                    inputMode === "push"
                                                        ? "bg-blue-500 text-white font-medium"
                                                        : "text-slate-400 hover:text-slate-200"
                                                }`}
                                            >
                                                <Hand className="h-4 w-4" />
                                                Push-to-Talk
                                            </button>
                                        </div>
                                        
                                        <p className="text-slate-500 text-xs text-center max-w-xs">
                                            {inputMode === "vad" 
                                                ? "VAD mode: AI automatically detects when you start and stop speaking"
                                                : "Push-to-Talk: Hold the button while speaking"}
                                        </p>
                                        
                                        <button
                                            onClick={toggleConnection}
                                            className="rounded-full px-8 py-4 font-bold text-sm transition-all flex items-center gap-3 shadow-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 hover:shadow-emerald-500/20 hover:scale-105"
                                        >
                                            <Radio className="h-5 w-5" />
                                            Connect to Voice Chat
                                        </button>
                                    </>
                                ) : inputMode === "vad" ? (
                                    /* VAD Mode UI */
                                    <>
                                        {/* Speech Probability Indicator */}
                                        <div className="w-full max-w-xs">
                                            <div className="flex justify-between text-xs text-slate-500 mb-1">
                                                <span>Speech Detection</span>
                                                <span>{(speechProbability * 100).toFixed(0)}%</span>
                                            </div>
                                            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full transition-all duration-100 ${
                                                        isRecording ? "bg-red-500" : speechProbability > 0.5 ? "bg-emerald-500" : "bg-slate-600"
                                                    }`}
                                                    style={{ width: `${speechProbability * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                        
                                        {/* VAD Status Circle */}
                                        <div className={`w-32 h-32 rounded-full flex flex-col items-center justify-center shadow-xl transition-all ${
                                            vad.isLoading
                                                ? "bg-slate-700 animate-pulse"
                                                : isRecording
                                                    ? "bg-red-500 text-white scale-110 shadow-red-500/40"
                                                    : vad.isListening
                                                        ? "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white"
                                                        : "bg-slate-700 text-slate-400"
                                        }`}>
                                            <Mic className={`h-10 w-10 mb-1 ${isRecording ? "animate-pulse" : ""}`} />
                                            {vad.isLoading ? (
                                                <span className="text-xs">Loading VAD...</span>
                                            ) : isRecording ? (
                                                <span className="text-lg font-mono tabular-nums">
                                                    {recordingTime.toFixed(1)}s
                                                </span>
                                            ) : (
                                                <span className="text-xs opacity-80">
                                                    {vad.isListening ? "Listening..." : "Starting..."}
                                                </span>
                                            )}
                                        </div>
                                        
                                        {/* Recording Stats */}
                                        {isRecording && (
                                            <div className="flex gap-4 text-xs text-slate-400">
                                                <span>⏱️ {recordingTime.toFixed(1)}s</span>
                                            </div>
                                        )}
                                        
                                        <p className="text-slate-500 text-xs text-center max-w-xs">
                                            {vad.isLoading 
                                                ? "Loading voice activity detection model..."
                                                : isRecording 
                                                    ? "Speaking detected! Keep talking..." 
                                                    : "Just start speaking - I'll detect when you're done"}
                                        </p>
                                        
                                        {vad.error && (
                                            <p className="text-red-400 text-xs text-center">
                                                VAD Error: {vad.error}
                                            </p>
                                        )}
                                        
                                        <button
                                            onClick={toggleConnection}
                                            className="rounded-full px-4 py-2 text-xs transition-all flex items-center gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/30"
                                        >
                                            <div className="h-2 w-2 rounded bg-red-400" />
                                            Disconnect
                                        </button>
                                    </>
                                ) : (
                                    /* Push-to-Talk Mode UI */
                                    <>
                                        {/* Large Push-to-Talk Button */}
                                        <button
                                            onMouseDown={startRecording}
                                            onMouseUp={stopRecording}
                                            onMouseLeave={stopRecording}
                                            onTouchStart={startRecording}
                                            onTouchEnd={stopRecording}
                                            className={`w-32 h-32 rounded-full font-bold text-sm transition-all flex flex-col items-center justify-center shadow-xl select-none ${
                                                isRecording
                                                    ? "bg-red-500 text-white scale-110 shadow-red-500/40"
                                                    : "bg-gradient-to-br from-blue-500 to-blue-600 text-white hover:from-blue-400 hover:to-blue-500 hover:shadow-blue-500/30 hover:scale-105 active:scale-95"
                                            }`}
                                        >
                                            <Mic className={`h-10 w-10 mb-1 ${isRecording ? "animate-pulse" : ""}`} />
                                            {isRecording ? (
                                                <span className="text-lg font-mono tabular-nums">
                                                    {recordingTime.toFixed(1)}s
                                                </span>
                                            ) : (
                                                <span className="text-xs opacity-80">Hold to Speak</span>
                                            )}
                                        </button>
                                        
                                        {/* Recording Stats */}
                                        {isRecording && (
                                            <div className="flex gap-4 text-xs text-slate-400">
                                                <span>⏱️ {recordingTime.toFixed(1)}s</span>
                                                <span>📦 {chunksSent} chunks</span>
                                            </div>
                                        )}
                                        
                                        <p className="text-slate-500 text-xs text-center max-w-xs">
                                            Hold the button while speaking, then release to send your message
                                        </p>
                                        
                                        <button
                                            onClick={toggleConnection}
                                            className="rounded-full px-4 py-2 text-xs transition-all flex items-center gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/30"
                                        >
                                            <div className="h-2 w-2 rounded bg-red-400" />
                                            Disconnect
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* FILE ANALYSIS MODE */}
                    {activeMode === "file" && (
                        <form onSubmit={handleFileSubmit} className="flex flex-col gap-4">
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
                                    Run Analysis
                                </button>
                                <button
                                    type="button"
                                    onClick={handleFileStream}
                                    className="flex-1 rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm font-semibold text-emerald-400 hover:bg-slate-800 hover:border-emerald-500/50 transition-all flex items-center justify-center gap-2"
                                    disabled={isProcessing}
                                >
                                    <Activity className="h-4 w-4" />
                                    Stream Analysis
                                </button>
                            </div>
                        </form>
                    )}
                </div>

                {/* Right Column: Results/Log */}
                <div className="flex flex-col gap-4 h-[600px]">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                        <MessageSquare className="h-4 w-4 text-emerald-400" />
                        <h3 className="text-sm font-semibold text-slate-200">
                            {activeMode === "live" ? "Conversation Log" : "Analysis Results"}
                        </h3>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">

                        {/* LIVE CHAT MESSAGES */}
                        {activeMode === "live" && (
                            messages.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center p-4">
                                    <p className="text-sm">No messages yet.</p>
                                    <p className="text-xs mt-1 opacity-70">Start the conversation to see the transcript.</p>
                                </div>
                            ) : (
                                messages.map((msg, idx) => (
                                    <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-slate-700 text-slate-300' : 'bg-emerald-500/20 text-emerald-400'
                                            }`}>
                                            {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                                        </div>
                                        <div className={`rounded-lg p-3 text-sm max-w-[85%] ${msg.role === 'user'
                                            ? 'bg-slate-800 text-slate-200 rounded-tr-none'
                                            : 'bg-emerald-500/10 text-emerald-100 border border-emerald-500/20 rounded-tl-none'
                                            }`}>
                                            {msg.content}
                                        </div>
                                    </div>
                                ))
                            )
                        )}

                        {/* FILE ANALYSIS RESULTS */}
                        {activeMode === "file" && (
                            (result || audioUrl) ? (
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
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-600 text-center p-4">
                                    <MessageSquare className="h-8 w-8 mb-2 opacity-20" />
                                    <p className="text-sm">Analysis results will appear here.</p>
                                </div>
                            )
                        )}
                    </div>
                </div>
            </div>
                </>
            )}

            {/* FAQ Section */}
            <FAQSection
                title="❓ Voice Chat FAQ"
                description="Common questions about voice-based conversation with Gemma 3"
                items={FAQ_ITEMS}
            />
        </div>
    );
}
