import { useEffect, useRef, useState } from "react";
import { useClientConfig } from "../context/ConfigContext";
import { useCode } from "../context/CodeContext";
import { useToast } from "./Toast";
import { InstructionsPanel } from "./InstructionsPanel";
import { AudioVisualizer } from "./AudioVisualizer";
import { fileToBase64 } from "../lib/audioUtils";
import { Mic, Radio, Volume2, User, Bot } from "lucide-react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function ConversationPanel() {
  const { config } = useClientConfig();
  const { setSnippet } = useCode();
  const { push } = useToast();
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<string>("Ready to connect");

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      stopConversation();
    };
  }, []);

  // Update code snippet
  useEffect(() => {
    const wsUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/conversation/ws";
    const code = `// WebSocket Connection for Live Conversation
const ws = new WebSocket("${wsUrl}");

ws.onopen = () => {
  console.log("Connected to conversation server");
};

ws.onmessage = async (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === "audio") {
    // Play received audio
    playAudio(data.audio);
  } else if (data.type === "text") {
    // Display text transcript
    console.log(data.role, data.content);
  }
};

// Send audio from microphone
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        // Convert blob to base64 and send
        ws.send(JSON.stringify({
          type: "audio",
          data: base64Audio
        }));
      }
    };
    recorder.start(500);
  });`;

    setSnippet({
      language: "javascript",
      code,
      title: "Live Conversation Logic"
    });
  }, [config.baseUrl, setSnippet]);

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

        // Start recording
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

        mediaRecorder.start(500); // Send chunks every 500ms
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
    if (isConnected) {
      stopConversation();
    } else {
      startConversation();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <InstructionsPanel
        title="🎙️ Live Conversation"
        description="Have a real-time voice conversation with Gemma 3. Speak naturally and listen to the response."
        steps={[
          {
            step: 1,
            title: "Connect",
            description: "Click 'Start Conversation' to connect to the server and enable your microphone.",
          },
          {
            step: 2,
            title: "Speak",
            description: "Talk to the AI. Your voice is streamed in real-time.",
          },
          {
            step: 3,
            title: "Listen",
            description: "The AI responds with generated speech.",
          }
        ]}
        tips={[
          "Use headphones to prevent audio feedback (echo)",
          "Speak clearly for better recognition",
          "The conversation context is maintained during the session"
        ]}
        troubleshooting={[
          {
            problem: "Connection failed",
            solution: "Ensure the backend server is running and the WebSocket endpoint is accessible."
          },
          {
            problem: "No audio response",
            solution: "Check your volume and ensure audio permissions are granted."
          }
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Visualizer & Controls */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 flex flex-col items-center gap-6 relative overflow-hidden">
            {/* Status Indicator */}
            <div className={`absolute top-4 right-4 flex items-center gap-2 text-xs font-mono px-2 py-1 rounded-full border ${isConnected
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-slate-700 bg-slate-800/50 text-slate-400"
              }`}>
              <div className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-slate-500"}`} />
              {status}
            </div>

            {/* Audio Visualizer */}
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

            {/* Main Action Button */}
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
        </div>

        {/* Chat Log */}
        <div className="flex flex-col gap-4 h-[500px]">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Volume2 className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-200">Conversation Log</h3>
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            {messages.length === 0 ? (
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
