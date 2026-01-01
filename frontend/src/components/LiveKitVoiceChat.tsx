/**
 * LiveKit Voice Chat Component
 *
 * This component provides a real-time voice conversation interface using LiveKit.
 * It connects to a LiveKit room and allows bidirectional audio communication
 * with the GemmaVoice agent.
 */

import { useCallback, useEffect, useState, useRef } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useRoomContext,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
  useVoiceAssistant,
  BarVisualizer,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track } from "livekit-client";
import { useClientConfig } from "../context/ConfigContext";
import { useToast } from "./Toast";
import { apiFetch } from "../lib/api";
import { errorLogger } from "../lib/error";
import { addDevLog } from "../lib/devlog";
import { Mic, MicOff, Phone, PhoneOff, Volume2, Loader2, AlertCircle, Signal } from "lucide-react";

// --- Types ---

interface TokenResponse {
  token: string;
  url: string;
  room_name: string;
  participant_identity: string;
}

interface LiveKitStatus {
  enabled: boolean;
  url: string | null;
  default_room: string | null;
}

// --- Connection Details Hook ---

type AgentDispatchConfig = {
  agentInstructions?: string;
  agentVoiceReferenceId?: string;
  agentLanguage?: string;
};

function useConnectionDetails(agentConfig?: AgentDispatchConfig) {
  const { config } = useClientConfig();
  const [status, setStatus] = useState<LiveKitStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [tokenData, setTokenData] = useState<TokenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if LiveKit is enabled
  const checkStatus = useCallback(async () => {
    try {
      const { data } = await apiFetch<LiveKitStatus>(config, "/v1/livekit/status");
      setStatus(data);
      setStatusError(null);

      addDevLog({
        level: "info",
        source: "livekit",
        message: `Status: enabled=${data.enabled} url=${data.url ?? "<unset>"}`,
        data,
      });
      return data;
    } catch (err) {
      errorLogger.logError(err, '/v1/livekit/status');
      setStatus({ enabled: false, url: null, default_room: null });
      setStatusError(errorLogger.getUserFriendlyMessage(err));

      addDevLog({
        level: "error",
        source: "livekit",
        message: "Status check failed (/v1/livekit/status)",
        data: { error: errorLogger.getUserFriendlyMessage(err) },
      });
      return null;
    }
  }, [config]);

  // Request a new token
  const requestToken = useCallback(async (roomName?: string) => {
    setLoading(true);
    setError(null);

    try {
      errorLogger.logInfo('Requesting LiveKit token', { roomName });

      const body: Record<string, unknown> = {
        room_name: roomName,
      };
      if (agentConfig?.agentInstructions?.trim()) {
        body.agent_instructions = agentConfig.agentInstructions.trim();
      }
      if (agentConfig?.agentVoiceReferenceId?.trim()) {
        body.agent_voice_reference_id = agentConfig.agentVoiceReferenceId.trim();
      }
      if (agentConfig?.agentLanguage?.trim()) {
        body.agent_language = agentConfig.agentLanguage.trim();
      }

      const { data } = await apiFetch<TokenResponse>(config, "/v1/livekit/token", {
        method: "POST",
        body: JSON.stringify(body),
      });

      setTokenData(data);

      addDevLog({
        level: "info",
        source: "livekit",
        message: `Token issued: room=${data.room_name} identity=${data.participant_identity}`,
        data: { room: data.room_name, identity: data.participant_identity, url: data.url },
      });
      return data;
    } catch (err) {
      errorLogger.logError(err, '/v1/livekit/token');
      const message = errorLogger.getUserFriendlyMessage(err);
      setError(message);

      addDevLog({
        level: "error",
        source: "livekit",
        message: "Token request failed (/v1/livekit/token)",
        data: { error: message, roomName },
      });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [config, agentConfig?.agentInstructions, agentConfig?.agentLanguage, agentConfig?.agentVoiceReferenceId]);

  // Clear token
  const clearToken = useCallback(() => {
    setTokenData(null);
    setError(null);
  }, []);

  return {
    status,
    statusError,
    tokenData,
    loading,
    error,
    checkStatus,
    requestToken,
    clearToken,
  };
}

// --- Room Controls Component ---

function RoomControls({ onDisconnect }: { onDisconnect: () => void }) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const [isMuted, setIsMuted] = useState(!isMicrophoneEnabled);

  const toggleMicrophone = useCallback(async () => {
    if (!localParticipant) return;
    
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
      setIsMuted(isMicrophoneEnabled);
    } catch (err) {
      console.error("Failed to toggle microphone:", err);
    }
  }, [localParticipant, isMicrophoneEnabled]);

  const handleDisconnect = useCallback(() => {
    room?.disconnect();
    onDisconnect();
  }, [room, onDisconnect]);

  const isConnected = connectionState === ConnectionState.Connected;

  return (
    <div className="flex items-center justify-center gap-6 p-6 bg-slate-900/50 border-t border-slate-800">
      {/* Mic Toggle */}
      <button
        onClick={toggleMicrophone}
        disabled={!isConnected}
        className={`flex items-center justify-center w-16 h-16 rounded-full transition-all shadow-lg ${
          isMuted
            ? "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
            : "bg-emerald-500 text-slate-950 hover:bg-emerald-400 hover:scale-105"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
        title={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
      </button>

      {/* End Call */}
      <button
        onClick={handleDisconnect}
        disabled={!isConnected}
        className="flex items-center justify-center w-16 h-16 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:scale-105 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        title="End Call"
      >
        <PhoneOff className="w-6 h-6" />
      </button>
    </div>
  );
}

// --- Voice Assistant Visualizer ---

function VoiceAssistantView() {
  const { state, audioTrack } = useVoiceAssistant();
  const remoteParticipants = useRemoteParticipants();
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true });

  // Find agent's audio track (type explicitly to avoid implicit any)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const agentTrack = tracks.find(
    (t: { participant: { identity: string } }) => t.participant.identity === "gemma-voice-agent"
  );

  return (
    <div className="flex flex-col items-center justify-center gap-8 p-8 w-full max-w-2xl mx-auto">
      {/* Agent Status */}
      <div className="text-center space-y-2">
        <div className="relative inline-block">
          <div className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 ${
            state === "speaking" 
              ? "bg-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.3)]" 
              : "bg-slate-800/50"
          }`}>
            <div className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
              state === "listening"
                ? "bg-blue-500/20 animate-pulse"
                : state === "speaking"
                ? "bg-emerald-500/30"
                : state === "thinking"
                ? "bg-amber-500/20 animate-pulse"
                : "bg-slate-800"
            }`}>
              {state === "speaking" ? (
                <Volume2 className="w-8 h-8 text-emerald-400" />
              ) : state === "listening" ? (
                <Mic className="w-8 h-8 text-blue-400" />
              ) : (
                <div className="w-3 h-3 rounded-full bg-slate-500" />
              )}
            </div>
          </div>
          
          {/* Status Badge */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-medium uppercase tracking-wider text-slate-400 whitespace-nowrap shadow-sm">
            {state || "Idle"}
          </div>
        </div>
        
        {remoteParticipants.length === 0 && (
          <p className="text-xs text-slate-500 animate-pulse">
            Waiting for agent to join...
          </p>
        )}
      </div>

      {/* Audio Visualizer */}
      <div className="w-full h-32 bg-slate-950/50 rounded-xl border border-slate-800/50 overflow-hidden relative">
        {audioTrack ? (
          <BarVisualizer
            state={state}
            trackRef={audioTrack}
            barCount={40}
            options={{ minHeight: 4 }}
            className="h-full w-full opacity-80"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="w-1 h-8 bg-slate-800 rounded-full" />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Room Session Component ---

function RoomSession({ onDisconnect }: { onDisconnect: () => void }) {
  const connectionState = useConnectionState();
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (
      payload: Uint8Array,
      participant?: { identity?: string },
      kind?: unknown,
      topic?: string
    ) => {
      try {
        const text = new TextDecoder().decode(payload);
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          // keep raw text
        }

        addDevLog({
          level: "info",
          source: "livekit",
          message: `Data message received${topic ? ` (topic=${topic})` : ""} from ${participant?.identity ?? "unknown"}`,
          data: { topic, kind, payload: parsed },
        });
      } catch (err) {
        addDevLog({
          level: "warn",
          source: "livekit",
          message: "Failed to decode data message",
          data: { error: (err as Error)?.message ?? String(err) },
        });
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room]);
  
  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Connection Status Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/50 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            connectionState === ConnectionState.Connected
              ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
              : connectionState === ConnectionState.Connecting
              ? "bg-amber-500 animate-pulse"
              : "bg-red-500"
          }`} />
          <span className="text-xs font-medium text-slate-300">
            {connectionState === ConnectionState.Connected
              ? "Connected to Room"
              : connectionState === ConnectionState.Connecting
              ? "Establishing Connection..."
              : "Disconnected"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Signal className="w-3 h-3" />
          <span>LiveKit SFU</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-900/10 via-slate-950/50 to-slate-950 pointer-events-none" />
        
        {connectionState === ConnectionState.Connecting ? (
          <div className="flex flex-col items-center gap-4 z-10">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <p className="text-sm text-slate-400">Connecting to secure room...</p>
          </div>
        ) : connectionState === ConnectionState.Connected ? (
          <div className="z-10 w-full">
            <VoiceAssistantView />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center z-10">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm text-slate-400">Connection lost</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <RoomControls onDisconnect={onDisconnect} />
      
      {/* Audio Renderer (required for audio playback) */}
      <RoomAudioRenderer />
    </div>
  );
}

// --- Main Component ---
export interface LiveKitVoiceChatProps {
  inputDeviceId?: string;
  outputDeviceId?: string;

  // Optional: per-session agent dispatch metadata
  agentInstructions?: string;
  agentVoiceReferenceId?: string;
  agentLanguage?: string;
}

export function LiveKitVoiceChat({
  inputDeviceId = "default",
  outputDeviceId = "default",
  agentInstructions,
  agentVoiceReferenceId,
  agentLanguage,
}: LiveKitVoiceChatProps) {
  const { push } = useToast();
  const {
    status,
    statusError,
    tokenData,
    loading,
    error,
    checkStatus,
    requestToken,
    clearToken,
  } = useConnectionDetails({
    agentInstructions,
    agentVoiceReferenceId,
    agentLanguage,
  });

  const { config } = useClientConfig();

  const [isSessionActive, setIsSessionActive] = useState(false);
  const hasCheckedStatus = useRef(false);

  // Check LiveKit status on mount
  useEffect(() => {
    if (!hasCheckedStatus.current) {
      hasCheckedStatus.current = true;
      checkStatus();
    }
  }, [checkStatus]);

  // Start a new session
  const startSession = useCallback(async () => {
    try {
      addDevLog({ level: "info", source: "livekit", message: "Starting session (requesting token)" });
      await requestToken();
      setIsSessionActive(true);
      push({ title: "Connecting...", description: "Establishing voice session" });
    } catch (err) {
      const message = errorLogger.getUserFriendlyMessage(err);
      addDevLog({
        level: "error",
        source: "livekit",
        message: "Start session failed",
        data: { error: message },
      });
      push({
        title: "Connection Failed",
        description: message,
        variant: "error",
      });
    }
  }, [requestToken, push]);

  // End session
  const endSession = useCallback(() => {
    addDevLog({
      level: "info",
      source: "livekit",
      message: "Ending session (disconnecting)",
      data: tokenData ? { room: tokenData.room_name, identity: tokenData.participant_identity } : undefined,
    });
    setIsSessionActive(false);
    clearToken();
    push({ title: "Session Ended", description: "Voice chat disconnected" });
  }, [clearToken, push, tokenData]);

  // Handle room events
  const handleConnected = useCallback(() => {
    addDevLog({
      level: "info",
      source: "livekit",
      message: "Room connected",
      data: tokenData ? { room: tokenData.room_name, identity: tokenData.participant_identity, url: tokenData.url } : undefined,
    });
    push({ title: "Connected", description: "Voice session active" });
  }, [push, tokenData]);

  const handleDisconnected = useCallback(() => {
    addDevLog({
      level: "warn",
      source: "livekit",
      message: "Room disconnected",
      data: tokenData ? { room: tokenData.room_name, identity: tokenData.participant_identity } : undefined,
    });
    if (isSessionActive) {
      endSession();
    }
  }, [isSessionActive, endSession, tokenData]);

  const handleError = useCallback(
    (err: Error) => {
      errorLogger.logError(err, 'LiveKit Room Error');
      addDevLog({
        level: "error",
        source: "livekit",
        message: "Room error",
        data: { error: err.message },
      });
      push({
        title: "Room Error",
        description: err.message,
        variant: "error",
      });
    },
    [push]
  );

  // Render not available state
  if (status && !status.enabled) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-slate-950/50">
        <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-slate-600" />
        </div>
        <h3 className="text-lg font-medium text-slate-200 mb-2">
          LiveKit Not Configured
        </h3>
        <p className="text-sm text-slate-400 max-w-md leading-relaxed">
          LiveKit voice chat requires server configuration. Please set{" "}
          <code className="px-1.5 py-0.5 bg-slate-800 rounded text-xs text-emerald-400 font-mono">
            LIVEKIT_URL
          </code>
          ,{" "}
          <code className="px-1.5 py-0.5 bg-slate-800 rounded text-xs text-emerald-400 font-mono">
            LIVEKIT_API_KEY
          </code>
          , and{" "}
          <code className="px-1.5 py-0.5 bg-slate-800 rounded text-xs text-emerald-400 font-mono">
            LIVEKIT_API_SECRET
          </code>{" "}
          environment variables.
        </p>
        <p className="mt-4 text-xs text-slate-500 max-w-md leading-relaxed">
          Current API base URL: <span className="font-mono">{config.baseUrl}</span>
          {statusError ? (
            <>
              <br />
              Status check error: <span className="font-mono">{statusError}</span>
            </>
          ) : null}
        </p>
      </div>
    );
  }

  // Render session active state with LiveKitRoom
  if (isSessionActive && tokenData) {
    const roomOptions = {
      audioCaptureDefaults:
        inputDeviceId && inputDeviceId !== "default" ? { deviceId: inputDeviceId } : undefined,
      audioOutput:
        outputDeviceId && outputDeviceId !== "default" ? { deviceId: outputDeviceId } : undefined,
    };

    return (
      <LiveKitRoom
        serverUrl={tokenData.url}
        token={tokenData.token}
        connect={true}
        audio={true}
        video={false}
        options={roomOptions}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onError={handleError}
        className="h-full"
      >
        <RoomSession onDisconnect={endSession} />
      </LiveKitRoom>
    );
  }

  // Render start session UI
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 bg-slate-950/30">
      <div className="max-w-md text-center">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.1)]">
          <Phone className="w-8 h-8 text-emerald-400" />
        </div>

        <h3 className="text-xl font-semibold text-slate-200 mb-3">
          LiveKit Voice Chat
        </h3>
        <p className="text-sm text-slate-400 mb-8 leading-relaxed">
          Start a real-time voice conversation with the Gemma AI assistant.
          This mode uses LiveKit for low-latency, high-quality audio streaming.
        </p>

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <button
          onClick={startSession}
          disabled={loading || (status !== null && !status.enabled)}
          className="w-full inline-flex items-center justify-center gap-3 px-6 py-4 rounded-xl bg-emerald-500 text-slate-950 hover:bg-emerald-400 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed font-bold shadow-lg shadow-emerald-500/20"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <Phone className="w-5 h-5" />
              Start Voice Session
            </>
          )}
        </button>

        <p className="mt-6 text-xs text-slate-500 flex items-center justify-center gap-2">
          <Mic className="w-3 h-3" />
          Microphone permission required
        </p>
      </div>
    </div>
  );
}

export default LiveKitVoiceChat;
