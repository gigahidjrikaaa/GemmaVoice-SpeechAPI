import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useClientConfig } from "../context/ConfigContext";
import { useCode } from "../context/CodeContext";
import { apiFetch, apiFetchStream } from "../lib/apiClient";
import { base64ToBlob, fileToBase64 } from "../lib/audioUtils";
import { useToast } from "./Toast";
import { InstructionsPanel } from "./InstructionsPanel";
import { AudioVisualizer } from "./AudioVisualizer";
import {
    MessageSquare, Upload, Play, Radio, FileAudio,
    User, Bot, Volume2, Mic, Activity
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

// --- Main Component ---

export function VoiceChatPanel() {
    const { config } = useClientConfig();
    const { setSnippet } = useCode();
    const { push } = useToast();

    const [activeMode, setActiveMode] = useState<"live" | "file">("live");

    // --- Live Chat State ---
    const [isConnected, setIsConnected] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [status, setStatus] = useState<string>("Ready to connect");
    const wsRef = useRef<WebSocket | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioQueueRef = useRef<string[]>([]);
    const isPlayingRef = useRef(false);
    const audioContextRef = useRef<AudioContext | null>(null);

    // --- File Analysis State ---
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [request, setRequest] = useState(defaultRequest);
    const [result, setResult] = useState<DialogueResponse | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [streamLog, setStreamLog] = useState<StreamEvent[]>([]);
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);

    // --- Cleanup ---
    useEffect(() => {
        return () => {
            stopConversation();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [objectUrl]);

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
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const wsUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/conversation/ws";
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                setIsConnected(true);
                setStatus("Connected");
                push({ title: "Connected to conversation server" });

                const mediaRecorder = new MediaRecorder(stream);
                mediaRecorderRef.current = mediaRecorder;

                mediaRecorder.ondataavailable = async (event) => {
                    if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
                        const base64Audio = await fileToBase64(event.data);
                        ws.send(JSON.stringify({
                            type: "audio",
                            data: base64Audio.split(',')[1]
                        }));
                    }
                };

                mediaRecorder.start(1000); // Send chunks every 1s
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);

                if (data.type === "text") {
                    setMessages(prev => [...prev, { role: data.role, content: data.content }]);
                } else if (data.type === "audio") {
                    audioQueueRef.current.push(data.data);
                    if (!isPlayingRef.current) {
                        playNextAudio();
                    }
                } else if (data.type === "error") {
                    push({ title: "Error", description: data.message, variant: "error" });
                }
            };

            ws.onclose = () => {
                setIsConnected(false);
                setStatus("Disconnected");
                stopConversation();
            };

            ws.onerror = (error) => {
                console.error("WebSocket error:", error);
                push({ title: "Connection error", description: "WebSocket connection failed", variant: "error" });
                stopConversation();
            };

        } catch (error) {
            console.error("Error accessing microphone:", error);
            push({ title: "Microphone error", description: "Could not access microphone", variant: "error" });
        }
    };

    const stopConversation = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
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
                            <div className={`absolute top-4 right-4 flex items-center gap-2 text-xs font-mono px-2 py-1 rounded-full border ${isConnected
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                : "border-slate-700 bg-slate-800/50 text-slate-400"
                                }`}>
                                <div className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-slate-500"}`} />
                                {status}
                            </div>

                            <div className="w-full h-48 rounded-lg border border-slate-800 bg-slate-950/50 relative overflow-hidden">
                                {isConnected ? (
                                    <AudioVisualizer stream={streamRef.current} className="w-full h-full" />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-slate-600">
                                        <div className="text-center">
                                            <Radio className="h-12 w-12 mx-auto mb-2 opacity-20" />
                                            <p className="text-sm">Visualizer ready</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={toggleConnection}
                                className={`rounded-full px-8 py-4 font-bold text-sm transition-all flex items-center gap-3 shadow-lg ${isConnected
                                    ? "bg-red-500 text-white hover:bg-red-600 hover:shadow-red-500/20"
                                    : "bg-emerald-500 text-slate-950 hover:bg-emerald-400 hover:shadow-emerald-500/20"
                                    }`}
                            >
                                {isConnected ? (
                                    <>
                                        <div className="h-3 w-3 rounded bg-white" />
                                        End Conversation
                                    </>
                                ) : (
                                    <>
                                        <Mic className="h-5 w-5" />
                                        Start Conversation
                                    </>
                                )}
                            </button>
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
        </div>
    );
}
