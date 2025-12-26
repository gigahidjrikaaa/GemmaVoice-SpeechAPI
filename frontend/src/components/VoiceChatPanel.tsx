import { useState, useRef, useEffect, useCallback, ChangeEvent, FormEvent } from "react";
import { 
    Mic, 
    Square, 
    Play, 
    Upload, 
    FileAudio, 
    MessageSquare, 
    Activity, 
    Wifi, 
    Server, 
    Radio, 
    Zap, 
    Hand, 
    User, 
    Bot, 
    Volume2,
    CheckCircle2,
    Loader2
} from "lucide-react";
import { useClientConfig } from "../context/ConfigContext";
import { apiFetch, apiFetchStream } from "../lib/api";
import { useToast } from "./Toast";
import { useVAD } from "../hooks/useVAD";
import { AudioVisualizer } from "./AudioVisualizer";
import { LiveKitVoiceChat } from "./LiveKitVoiceChat";
import { InstructionsPanel } from "./InstructionsPanel";
import { FAQSection, type FAQItem } from "./FAQSection";
import { errorLogger } from "../lib/error";

// --- Types ---

interface Message {
    role: "user" | "assistant" | "system";
    content: string;
}

interface DialogueResponse {
    transcript?: string;
    assistant_text?: string;
    audio_base64?: string;
}

interface StreamLogEntry {
    event: string;
    data: unknown;
}

// --- Constants ---

const PARAM_HELP = {
    audio: "Upload an audio file (WAV, MP3, WEBM) containing speech to analyze.",
    instructions: "System instructions to guide the AI's persona and response style.",
    stream_audio: "If enabled, audio chunks will be played as they arrive (lower latency)."
};

const FAQ_ITEMS: FAQItem[] = [
    {
        question: "What is the difference between WebSocket and LiveKit?",
        answer: "WebSocket is a direct connection to the backend, suitable for simple 1-on-1 conversations. LiveKit is a WebRTC-based SFU (Selective Forwarding Unit) that handles real-time audio/video routing, better for production and scaling.",
        category: "Architecture"
    },
    {
        question: "How does VAD work?",
        answer: "VAD (Voice Activity Detection) runs locally in your browser using an ONNX model. It detects when you are speaking and automatically sends audio to the server, so you don't have to press a button.",
        category: "Features"
    },
    {
        question: "Can I interrupt the AI?",
        answer: "In LiveKit mode, interruption handling is built-in. In WebSocket mode, the system is currently half-duplex (turn-based), so it's best to wait for the AI to finish.",
        category: "Usage"
    }
];

// --- Helper Functions ---

const fileToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = (reader.result as string).split(",")[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

const base64ToBlob = (base64: string, type: string = 'audio/wav'): Blob => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type });
};

export function VoiceChatPanel() {
    const { config } = useClientConfig();
    const { push } = useToast();
    
    // --- State ---
    const [connectionMode, setConnectionMode] = useState<"websocket" | "livekit">("websocket");
    const [activeMode, setActiveMode] = useState<"live" | "file">("live");
    const [inputMode, setInputMode] = useState<"vad" | "push">("vad");
    
    // Live Chat State
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [status, setStatus] = useState("Disconnected");
    const [messages, setMessages] = useState<Message[]>([]);
    const [audioBytes, setAudioBytes] = useState(0);
    const [chunksSent, setChunksSent] = useState(0);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [recordingTime, setRecordingTime] = useState(0);

    // WebSocket pipeline telemetry (helps detect "stuck" stages)
    const [pipelineStage, setPipelineStage] = useState<string>("Idle");
    const [lastServerEventType, setLastServerEventType] = useState<string | null>(null);
    const [lastServerUpdateAt, setLastServerUpdateAt] = useState<number | null>(null);
    const [uiNowMs, setUiNowMs] = useState<number>(() => Date.now());
    
    // File Analysis State
    const [fileName, setFileName] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [result, setResult] = useState<DialogueResponse | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [streamLog, setStreamLog] = useState<StreamLogEntry[]>([]);
    const [request, setRequest] = useState({
        instructions: "You are a helpful voice assistant. Respond concisely.",
        stream_audio: true
    });

    const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
    const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
    const [selectedInputDeviceId, setSelectedInputDeviceId] = useState<string>("default");
    const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState<string>("default");

    const supportsSetSinkId =
        typeof window !== "undefined" &&
        typeof (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId === "function";

    // Refs
    const wsRef = useRef<WebSocket | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioQueueRef = useRef<string[]>([]);
    const isPlayingRef = useRef(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const fileAudioRef = useRef<HTMLAudioElement | null>(null);

    // VAD Hook
    const vad = useVAD({
        inputDeviceId: selectedInputDeviceId,
        onSpeechStart: () => {
            console.log("[VAD] Speech started");
            if (isConnected && inputMode === "vad") {
                startRecording();
            }
        },
        onSpeechEnd: () => {
            console.log("[VAD] Speech ended");
            if (isConnected && inputMode === "vad") {
                stopRecording();
            }
        }
    });

    const refreshDevices = useCallback(async () => {
        try {
            if (!navigator.mediaDevices?.enumerateDevices) return;
            const devices = await navigator.mediaDevices.enumerateDevices();
            setAudioInputs(devices.filter((d) => d.kind === "audioinput"));
            setAudioOutputs(devices.filter((d) => d.kind === "audiooutput"));
        } catch (error) {
            console.warn("Failed to enumerate media devices", error);
        }
    }, []);

    useEffect(() => {
        refreshDevices();
        const mediaDevices = navigator.mediaDevices;
        mediaDevices?.addEventListener?.("devicechange", refreshDevices);
        return () => mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
    }, [refreshDevices]);

    useEffect(() => {
        if (!isConnected) return;
        const intervalId = window.setInterval(() => setUiNowMs(Date.now()), 1000);
        return () => window.clearInterval(intervalId);
    }, [isConnected]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopConversation();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, []);

    useEffect(() => {
        if (!supportsSetSinkId) return;
        if (!fileAudioRef.current) return;
        if (!audioUrl) return;

        const el = fileAudioRef.current as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
        if (!el.setSinkId) return;

        const sinkId = selectedOutputDeviceId;
        if (!sinkId || sinkId === "default") return;
        el.setSinkId(sinkId).catch((error) => {
            console.warn("Failed to set output device", error);
        });
    }, [audioUrl, selectedOutputDeviceId, supportsSetSinkId]);

    // --- Audio Playback Logic ---
    const playNextAudio = useCallback(async () => {
        if (audioQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            return;
        }

        isPlayingRef.current = true;
        const base64Audio = audioQueueRef.current.shift();
        if (!base64Audio) {
            isPlayingRef.current = false;
            return;
        }

        try {
            const blob = base64ToBlob(base64Audio, 'audio/wav'); // Assuming WAV for now
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);

            if (supportsSetSinkId && selectedOutputDeviceId && selectedOutputDeviceId !== "default") {
                const el = audio as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
                if (el.setSinkId) {
                    await el.setSinkId(selectedOutputDeviceId);
                }
            }
            
            audio.onended = () => {
                URL.revokeObjectURL(url);
                playNextAudio();
            };
            
            audio.onerror = (e) => {
                console.error("Audio playback error:", e);
                isPlayingRef.current = false;
            };

            await audio.play();
        } catch (err) {
            console.error("Error playing audio chunk:", err);
            isPlayingRef.current = false;
        }
    }, [selectedOutputDeviceId, supportsSetSinkId]);

    // --- WebSocket Logic ---

    const startConversation = async () => {
        try {
            setStatus("Connecting...");
            setPipelineStage("Connecting");
            setLastServerEventType(null);
            setLastServerUpdateAt(null);

            const audioConstraints: MediaTrackConstraints | boolean =
                selectedInputDeviceId && selectedInputDeviceId !== "default"
                    ? { deviceId: { exact: selectedInputDeviceId } }
                    : true;
            
            if (inputMode === "vad") {
                // First establish WebSocket connection
                const wsBaseUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/conversation/ws";
                const wsUrl = config.apiKey ? `${wsBaseUrl}?api_key=${encodeURIComponent(config.apiKey)}` : wsBaseUrl;
                const ws = new WebSocket(wsUrl);
                wsRef.current = ws;

                ws.onopen = async () => {
                    setIsConnected(true);
                    setStatus("🔄 Starting VAD...");
                    setPipelineStage("Connected (VAD)");
                    setLastServerUpdateAt(Date.now());
                    push({ title: "Connected", description: "Starting voice detection..." });

                    // Prepare a MediaRecorder stream for VAD-triggered recording
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                        streamRef.current = stream;
                        const mediaRecorder = new MediaRecorder(stream);
                        mediaRecorderRef.current = mediaRecorder;

                        mediaRecorder.ondataavailable = async (event) => {
                            if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
                                try {
                                    const base64Audio = await fileToBase64(event.data);
                                    ws.send(JSON.stringify({
                                        type: "audio",
                                        data: base64Audio,
                                    }));
                                    setChunksSent((prev) => prev + 1);
                                } catch (err) {
                                    console.error("[VoiceChat] Error converting audio chunk:", err);
                                }
                            }
                        };
                    } catch (err) {
                        console.error("Error accessing microphone:", err);
                        push({ title: "Microphone Error", description: "Could not access microphone", variant: "error" });
                        setStatus("Microphone error - check permissions");
                        return;
                    }
                    
                    // Start VAD after WebSocket is connected
                    try {
                        await vad.start();
                        setStatus("🎤 Listening for speech...");
                        setPipelineStage("Listening");
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
            const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
            streamRef.current = stream;

            // Pass API key via query parameter since browsers can't set WebSocket headers
            const wsBaseUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/conversation/ws";
            const wsUrl = config.apiKey ? `${wsBaseUrl}?api_key=${encodeURIComponent(config.apiKey)}` : wsBaseUrl;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                setIsConnected(true);
                setStatus("Connected - Hold mic button to speak");
                    setPipelineStage("Connected (Push-to-Talk)");
                    setLastServerUpdateAt(Date.now());
                push({ title: "Connected", description: "Ready for conversation" });

                const mediaRecorder = new MediaRecorder(stream);
                mediaRecorderRef.current = mediaRecorder;

                mediaRecorder.ondataavailable = async (event) => {
                    if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
                        try {
                            const base64Audio = await fileToBase64(event.data);
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
            };

            ws.onmessage = handleWebSocketMessage;
            ws.onclose = handleWebSocketClose;
            ws.onerror = handleWebSocketError;

        } catch (error) {
            console.error("Error accessing microphone:", error);
            push({ title: "Microphone Error", description: "Could not access microphone", variant: "error" });
        }
    };

    const handleWebSocketMessage = useCallback((event: MessageEvent) => {
        let data: any;
        try {
            data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        } catch (err) {
            console.warn("[VoiceChat] Non-JSON message:", event.data);
            return;
        }

        setLastServerUpdateAt(Date.now());
        setLastServerEventType(typeof data?.type === "string" ? data.type : null);
        console.log("Voice chat message:", data);

        if (data.type === "ready") {
            if (inputMode === "vad") {
                setStatus("🎤 Listening for speech...");
                setPipelineStage("Listening");
            } else {
                setStatus("✅ " + (data.message || "Ready"));
                setPipelineStage("Ready");
            }
        } else if (data.type === "buffering") {
            setAudioBytes(data.bytes || 0);
            setPipelineStage("Uploading audio");
        } else if (data.type === "processing") {
            setStatus(data.message || "Processing...");
            const msg = String(data.message || "").toLowerCase();
            if (msg.includes("transcrib")) setPipelineStage("Transcribing");
            else if (msg.includes("synth") || msg.includes("tts") || msg.includes("speech")) setPipelineStage("Synthesizing speech");
            else if (msg.includes("generat") || msg.includes("think") || msg.includes("infer")) setPipelineStage("Generating reply");
            else setPipelineStage("Processing");
        } else if (data.type === "transcript") {
            setMessages(prev => [...prev, { role: data.role, content: data.content }]);
            setPipelineStage("Transcript received");
            if (inputMode === "vad") {
                setStatus("🎤 Listening for speech...");
                setPipelineStage("Listening");
            }
        } else if (data.type === "text") {
            setMessages(prev => [...prev, { role: data.role, content: data.content }]);
            setPipelineStage("Reply text received");
        } else if (data.type === "audio") {
            audioQueueRef.current.push(data.data);
            setPipelineStage("Receiving audio");
            if (!isPlayingRef.current) {
                playNextAudio();
            }
        } else if (data.type === "error") {
            push({ title: "Error", description: data.message, variant: "error" });
            setStatus("Error - try again");
            setPipelineStage("Error");
        }
    }, [inputMode, push, playNextAudio]);

    const handleWebSocketClose = useCallback(() => {
        setIsConnected(false);
        setStatus("Disconnected");
        setPipelineStage("Disconnected");
        stopConversation();
    }, []);

    const handleWebSocketError = useCallback((error: Event) => {
        console.error("WebSocket error:", error);
        push({ title: "Connection Error", description: "WebSocket connection failed", variant: "error" });
        setPipelineStage("Connection error");
        stopConversation();
    }, [push]);
    
    const startRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "inactive") {
            setAudioBytes(0);
            setChunksSent(0);
            setRecordingTime(0);
            setPipelineStage("Recording");
            
            recordingTimerRef.current = setInterval(() => {
                setRecordingTime(prev => prev + 0.1);
            }, 100);
            
            mediaRecorderRef.current.start(250); // Send chunks every 250ms
            setIsRecording(true);
            setStatus("🎙️ Recording... Release to send");
        }
    };
    
    const stopRecording = () => {
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
        
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setStatus("⏳ Processing...");
            setPipelineStage("Waiting for server");
            
            // Send end_turn signal after a delay
            setTimeout(() => {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: "end_turn" }));
                }
            }, 300);
        }
    };

    const stopConversation = () => {
        vad.stop();
        
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
        setPipelineStage("Disconnected");
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

    const handleFileSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const file = fileInputRef.current?.files?.[0];
        if (!file) {
            push({ title: "No file selected", description: "Please upload an audio file.", variant: "error" });
            return;
        }

        setIsProcessing(true);
        setStreamLog([]);

        const form = new FormData();
        form.append("audio", file);
        form.append("instructions", request.instructions);
        form.append("stream_audio", String(request.stream_audio));

        try {
            errorLogger.logInfo('Starting file analysis', { fileName: file.name });
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
            push({ title: "Analysis Complete", description: "Dialogue processed successfully." });
        } catch (error) {
            errorLogger.logError(error, '/v1/conversation/dialogue');
            const userMessage = errorLogger.getUserFriendlyMessage(error);
            push({ title: "Analysis Failed", description: userMessage, variant: "error" });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFileStream = async () => {
        const file = fileInputRef.current?.files?.[0];
        if (!file) {
            push({ title: "No file selected", description: "Please upload an audio file.", variant: "error" });
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
            errorLogger.logInfo('Starting streaming file analysis', { fileName: file.name });
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
            push({ title: "Streaming Complete", description: "Dialogue processed successfully." });
        } catch (error) {
            errorLogger.logError(error, '/v1/conversation/dialogue (stream)');
            const userMessage = errorLogger.getUserFriendlyMessage(error);
            push({ title: "Streaming Failed", description: userMessage, variant: "error" });
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex flex-col gap-6 h-full">
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

            {/* Connection Mode Selector */}
            <div className="flex items-center justify-between bg-slate-900/50 p-2 rounded-xl border border-slate-800">
                <div className="flex items-center gap-4">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-2">Connection</span>
                    <div className="flex p-1 bg-slate-950 rounded-lg border border-slate-800">
                        <button
                            onClick={() => setConnectionMode("websocket")}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                                connectionMode === "websocket"
                                    ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
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
                                    ? "bg-purple-500 text-white shadow-lg shadow-purple-500/20"
                                    : "text-slate-400 hover:text-slate-200"
                            }`}
                        >
                            <Server className="h-3 w-3" />
                            LiveKit
                        </button>
                    </div>
                </div>
                <span className="text-xs text-slate-500 mr-2 hidden sm:block">
                    {connectionMode === "livekit" 
                        ? "Low-latency SFU for production" 
                        : "Direct WebSocket for development"}
                </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Input Device</label>
                        <select
                            className="rounded bg-slate-900 border border-slate-800 px-2 py-1.5 text-xs text-slate-300 focus:border-emerald-500/50 focus:outline-none"
                            value={selectedInputDeviceId}
                            onChange={(e) => setSelectedInputDeviceId(e.target.value)}
                            disabled={connectionMode === "websocket" && isConnected}
                        >
                            <option value="default">Default</option>
                            {audioInputs.map((device, index) => (
                                <option key={device.deviceId} value={device.deviceId}>
                                    {device.label || `Microphone ${index + 1}`}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Output Device</label>
                        <select
                            className="rounded bg-slate-900 border border-slate-800 px-2 py-1.5 text-xs text-slate-300 focus:border-emerald-500/50 focus:outline-none disabled:opacity-50"
                            value={selectedOutputDeviceId}
                            onChange={(e) => setSelectedOutputDeviceId(e.target.value)}
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
            </div>

            {/* LiveKit Mode */}
            {connectionMode === "livekit" && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden min-h-[500px]">
                    <LiveKitVoiceChat inputDeviceId={selectedInputDeviceId} outputDeviceId={selectedOutputDeviceId} />
                </div>
            )}

            {/* WebSocket Mode */}
            {connectionMode === "websocket" && (
                <div className="grid gap-6 lg:grid-cols-3">
                    {/* Left Column: Controls */}
                    <div className="lg:col-span-2 flex flex-col gap-6">
                        
                        {/* Mode Switcher */}
                        <div className="flex p-1 bg-slate-900/50 rounded-lg border border-slate-800 w-fit">
                            <button
                                onClick={() => setActiveMode("live")}
                                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                                    activeMode === "live"
                                        ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20"
                                        : "text-slate-400 hover:text-slate-200"
                                }`}
                            >
                                <Mic className="h-4 w-4" />
                                Live Chat
                            </button>
                            <button
                                onClick={() => setActiveMode("file")}
                                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                                    activeMode === "file"
                                        ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20"
                                        : "text-slate-400 hover:text-slate-200"
                                }`}
                            >
                                <FileAudio className="h-4 w-4" />
                                File Analysis
                            </button>
                        </div>

                        {/* LIVE CHAT CONTROLS */}
                        {activeMode === "live" && (
                            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 flex flex-col items-center gap-6 relative overflow-hidden">
                                {/* Status Bar */}
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

                                {/* Pipeline / liveness indicator */}
                                {isConnected && (
                                    <div className="w-full text-[11px] text-slate-400 flex items-center justify-between">
                                        <span>
                                            Stage: <span className="text-slate-200">{pipelineStage}</span>
                                            {lastServerEventType ? (
                                                <>
                                                    <span className="text-slate-600"> · </span>
                                                    <span className="text-slate-500">last event</span>: {lastServerEventType}
                                                </>
                                            ) : null}
                                        </span>
                                        <span className="text-slate-500">
                                            {lastServerUpdateAt
                                                ? `Last server update: ${Math.max(0, Math.round((uiNowMs - lastServerUpdateAt) / 1000))}s ago`
                                                : "Last server update: —"}
                                        </span>
                                    </div>
                                )}

                                {/* Visualizer */}
                                <div className={`w-full h-48 rounded-lg border bg-slate-950/50 relative overflow-hidden transition-all ${
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
                                </div>

                                {/* Controls */}
                                <div className="flex flex-col items-center gap-4 w-full">
                                    {!isConnected ? (
                                        <>
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
                                            
                                            <button
                                                onClick={toggleConnection}
                                                className="w-full max-w-xs rounded-lg px-8 py-4 font-bold text-sm transition-all flex items-center justify-center gap-3 shadow-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 hover:shadow-emerald-500/20 hover:scale-[1.02]"
                                            >
                                                <Radio className="h-5 w-5" />
                                                Connect to Voice Chat
                                            </button>
                                        </>
                                    ) : inputMode === "vad" ? (
                                        /* VAD Mode UI */
                                        <div className="flex flex-col items-center gap-4 w-full">
                                            <div className={`w-24 h-24 rounded-full flex items-center justify-center shadow-xl transition-all ${
                                                vad.isLoading
                                                    ? "bg-slate-700 animate-pulse"
                                                    : isRecording
                                                        ? "bg-red-500 text-white scale-110 shadow-red-500/40"
                                                        : vad.isListening
                                                            ? "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white"
                                                            : "bg-slate-700 text-slate-400"
                                            }`}>
                                                <Mic className={`h-8 w-8 ${isRecording ? "animate-pulse" : ""}`} />
                                            </div>
                                            
                                            <div className="text-center space-y-1">
                                                <p className="text-sm font-medium text-slate-200">
                                                    {vad.isLoading ? "Loading VAD..." : isRecording ? "Listening..." : "Waiting for speech..."}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    {vad.isLoading ? "Please wait" : "Speak naturally"}
                                                </p>
                                            </div>

                                            <button
                                                onClick={toggleConnection}
                                                className="mt-2 rounded-full px-4 py-2 text-xs transition-all flex items-center gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/30"
                                            >
                                                <Square className="h-3 w-3 fill-current" />
                                                Disconnect
                                            </button>
                                        </div>
                                    ) : (
                                        /* Push-to-Talk Mode UI */
                                        <div className="flex flex-col items-center gap-4 w-full">
                                            <button
                                                onMouseDown={startRecording}
                                                onMouseUp={stopRecording}
                                                onMouseLeave={stopRecording}
                                                onTouchStart={startRecording}
                                                onTouchEnd={stopRecording}
                                                className={`w-24 h-24 rounded-full font-bold text-sm transition-all flex flex-col items-center justify-center shadow-xl select-none ${
                                                    isRecording
                                                        ? "bg-red-500 text-white scale-110 shadow-red-500/40"
                                                        : "bg-gradient-to-br from-blue-500 to-blue-600 text-white hover:from-blue-400 hover:to-blue-500 hover:shadow-blue-500/30 hover:scale-105 active:scale-95"
                                                }`}
                                            >
                                                <Mic className={`h-8 w-8 ${isRecording ? "animate-pulse" : ""}`} />
                                            </button>
                                            
                                            <div className="text-center space-y-1">
                                                <p className="text-sm font-medium text-slate-200">
                                                    {isRecording ? "Recording..." : "Push to Talk"}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    {isRecording ? "Release to send" : "Hold button to speak"}
                                                </p>
                                            </div>

                                            <button
                                                onClick={toggleConnection}
                                                className="mt-2 rounded-full px-4 py-2 text-xs transition-all flex items-center gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/30"
                                            >
                                                <Square className="h-3 w-3 fill-current" />
                                                Disconnect
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* FILE ANALYSIS CONTROLS */}
                        {activeMode === "file" && (
                            <form onSubmit={handleFileSubmit} className="flex flex-col gap-4">
                                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Upload className="h-4 w-4 text-emerald-400" />
                                        <h4 className="text-sm font-semibold text-emerald-300">Upload Audio</h4>
                                        <span className="cursor-help text-slate-400 text-xs" title={PARAM_HELP.audio}>ℹ️</span>
                                    </div>

                                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-700 border-dashed rounded-lg cursor-pointer bg-slate-900/30 hover:bg-slate-800/50 hover:border-emerald-500/50 transition-all group">
                                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                            <FileAudio className="w-8 h-8 mb-3 text-slate-400 group-hover:text-emerald-400 transition-colors" />
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
                                            <CheckCircle2 className="h-4 w-4" />
                                            <span className="truncate">{fileName}</span>
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <MessageSquare className="h-4 w-4 text-emerald-400" />
                                        <h4 className="text-sm font-semibold text-emerald-300">Instructions</h4>
                                    </div>
                                    <textarea
                                        className="w-full h-24 rounded-lg bg-slate-950 border border-slate-800 px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors resize-none placeholder:text-slate-600 text-slate-200"
                                        value={request.instructions}
                                        onChange={(event) => setRequest((prev) => ({ ...prev, instructions: event.target.value }))}
                                        placeholder="Enter system instructions..."
                                        title={PARAM_HELP.instructions}
                                    />
                                </div>

                                <div className="flex items-center gap-3 pt-2">
                                    <button
                                        type="submit"
                                        className="flex-1 rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10"
                                        disabled={isProcessing}
                                    >
                                        {isProcessing ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
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

                    {/* Right Column: Output */}
                    <div className="flex flex-col gap-4 h-[600px] rounded-xl border border-slate-800 bg-slate-900/50 p-4">
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
                                        <MessageSquare className="h-8 w-8 mb-2 opacity-20" />
                                        <p className="text-sm">No messages yet.</p>
                                        <p className="text-xs mt-1 opacity-70">Start the conversation to see the transcript.</p>
                                    </div>
                                ) : (
                                    messages.map((msg, idx) => (
                                        <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                            <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                                                msg.role === 'user' ? 'bg-slate-700 text-slate-300' : 'bg-emerald-500/20 text-emerald-400'
                                            }`}>
                                                {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                                            </div>
                                            <div className={`rounded-lg p-3 text-sm max-w-[85%] ${
                                                msg.role === 'user'
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
                                                <audio ref={fileAudioRef} controls className="w-full" src={audioUrl} />
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
            )}

            <FAQSection
                title="❓ Voice Chat FAQ"
                description="Common questions about voice-based conversation with Gemma 3"
                items={FAQ_ITEMS}
            />
        </div>
    );
}
