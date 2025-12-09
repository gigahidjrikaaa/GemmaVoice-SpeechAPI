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
  VoiceAssistantControlBar,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track } from "livekit-client";
import { useClientConfig } from "../context/ConfigContext";
import { useToast } from "./Toast";
import { Mic, MicOff, Phone, PhoneOff, Volume2, Loader2, AlertCircle } from "lucide-react";

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

function useConnectionDetails() {
  const { config } = useClientConfig();
  const [status, setStatus] = useState<LiveKitStatus | null>(null);
  const [tokenData, setTokenData] = useState<TokenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if LiveKit is enabled
  const checkStatus = useCallback(async () => {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (config.apiKey) {
        headers["X-API-Key"] = config.apiKey;
      }

      const res = await fetch(`${config.baseUrl}/v1/livekit/status`, {
        headers,
      });
      if (!res.ok) throw new Error("Failed to check LiveKit status");
      const data: LiveKitStatus = await res.json();
      setStatus(data);
      return data;
    } catch (err) {
      console.error("LiveKit status check failed:", err);
      setStatus({ enabled: false, url: null, default_room: null });
      return null;
    }
  }, [config.baseUrl, config.apiKey]);

  // Request a new token
  const requestToken = useCallback(async (roomName?: string) => {
    setLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (config.apiKey) {
        headers["X-API-Key"] = config.apiKey;
      }

      const res = await fetch(`${config.baseUrl}/v1/livekit/token`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          room_name: roomName,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to get token");
      }

      const data: TokenResponse = await res.json();
      setTokenData(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Token request failed";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [config.baseUrl, config.apiKey]);

  // Clear token
  const clearToken = useCallback(() => {
    setTokenData(null);
    setError(null);
  }, []);

  return {
    status,
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
    <div className="flex items-center justify-center gap-4 p-4">
      {/* Mic Toggle */}
      <button
        onClick={toggleMicrophone}
        disabled={!isConnected}
        className={`flex items-center justify-center w-14 h-14 rounded-full transition-all ${
          isMuted
            ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
            : "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
        } disabled:opacity-50 disabled:cursor-not-allowed`}
        title={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
      </button>

      {/* End Call */}
      <button
        onClick={handleDisconnect}
        disabled={!isConnected}
        className="flex items-center justify-center w-14 h-14 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
  const agentTrack = tracks.find(
    (t: { participant: { identity: string } }) => t.participant.identity === "gemma-voice-agent"
  );

  return (
    <div className="flex flex-col items-center justify-center gap-6 p-6">
      {/* Agent Status */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div
            className={`w-3 h-3 rounded-full ${
              state === "listening"
                ? "bg-blue-500 animate-pulse"
                : state === "speaking"
                ? "bg-emerald-500 animate-pulse"
                : state === "thinking"
                ? "bg-yellow-500 animate-pulse"
                : "bg-slate-600"
            }`}
          />
          <span className="text-sm text-slate-400 capitalize">
            {state || "Waiting for agent..."}
          </span>
        </div>
        {remoteParticipants.length === 0 && (
          <p className="text-xs text-slate-500">
            Agent is connecting to the room...
          </p>
        )}
      </div>

      {/* Audio Visualizer */}
      <div className="w-full max-w-md h-24 bg-slate-900/50 rounded-lg overflow-hidden">
        {audioTrack && (
          <BarVisualizer
            state={state}
            trackRef={audioTrack}
            barCount={50}
            options={{
              minHeight: 2,
            }}
            className="h-full"
          />
        )}
        {!audioTrack && (
          <div className="flex items-center justify-center h-full text-slate-600">
            <Volume2 className="w-8 h-8" />
          </div>
        )}
      </div>

      {/* Connection Info */}
      <div className="text-xs text-slate-500 text-center">
        {remoteParticipants.length > 0 ? (
          <span className="text-emerald-400">
            ✓ Agent connected
          </span>
        ) : (
          <span>Waiting for agent to join...</span>
        )}
      </div>
    </div>
  );
}

// --- Room Session Component ---

function RoomSession({ onDisconnect }: { onDisconnect: () => void }) {
  const connectionState = useConnectionState();
  
  return (
    <div className="flex flex-col h-full">
      {/* Connection Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/50 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              connectionState === ConnectionState.Connected
                ? "bg-emerald-500"
                : connectionState === ConnectionState.Connecting
                ? "bg-yellow-500 animate-pulse"
                : "bg-red-500"
            }`}
          />
          <span className="text-xs text-slate-400">
            {connectionState === ConnectionState.Connected
              ? "Connected"
              : connectionState === ConnectionState.Connecting
              ? "Connecting..."
              : connectionState === ConnectionState.Reconnecting
              ? "Reconnecting..."
              : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center">
        {connectionState === ConnectionState.Connecting ? (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <p className="text-sm text-slate-400">Connecting to room...</p>
          </div>
        ) : connectionState === ConnectionState.Connected ? (
          <VoiceAssistantView />
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
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

export function LiveKitVoiceChat() {
  const { push } = useToast();
  const {
    status,
    tokenData,
    loading,
    error,
    checkStatus,
    requestToken,
    clearToken,
  } = useConnectionDetails();

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
      await requestToken();
      setIsSessionActive(true);
      push({ title: "Connecting to voice session..." });
    } catch (err) {
      push({
        title: "Connection Failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "error",
      });
    }
  }, [requestToken, push]);

  // End session
  const endSession = useCallback(() => {
    setIsSessionActive(false);
    clearToken();
    push({ title: "Session ended" });
  }, [clearToken, push]);

  // Handle room events
  const handleConnected = useCallback(() => {
    push({ title: "Connected to voice room" });
  }, [push]);

  const handleDisconnected = useCallback(() => {
    if (isSessionActive) {
      endSession();
    }
  }, [isSessionActive, endSession]);

  const handleError = useCallback(
    (err: Error) => {
      console.error("Room error:", err);
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
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <AlertCircle className="w-12 h-12 text-slate-600 mb-4" />
        <h3 className="text-lg font-medium text-slate-200 mb-2">
          LiveKit Not Configured
        </h3>
        <p className="text-sm text-slate-400 max-w-md">
          LiveKit voice chat requires server configuration. Please set{" "}
          <code className="px-1.5 py-0.5 bg-slate-800 rounded text-xs">
            LIVEKIT_URL
          </code>
          ,{" "}
          <code className="px-1.5 py-0.5 bg-slate-800 rounded text-xs">
            LIVEKIT_API_KEY
          </code>
          , and{" "}
          <code className="px-1.5 py-0.5 bg-slate-800 rounded text-xs">
            LIVEKIT_API_SECRET
          </code>{" "}
          environment variables.
        </p>
      </div>
    );
  }

  // Render session active state with LiveKitRoom
  if (isSessionActive && tokenData) {
    return (
      <LiveKitRoom
        serverUrl={tokenData.url}
        token={tokenData.token}
        connect={true}
        audio={true}
        video={false}
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
    <div className="flex flex-col items-center justify-center h-full p-8">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center">
          <Phone className="w-8 h-8 text-emerald-400" />
        </div>

        <h3 className="text-xl font-semibold text-slate-200 mb-2">
          LiveKit Voice Chat
        </h3>
        <p className="text-sm text-slate-400 mb-6">
          Start a real-time voice conversation with the Gemma AI assistant.
          This mode uses LiveKit for low-latency, high-quality audio.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={startSession}
          disabled={loading || (status !== null && !status.enabled)}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium"
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

        <p className="mt-4 text-xs text-slate-500">
          Ensure you have microphone permissions enabled in your browser.
        </p>
      </div>
    </div>
  );
}

export default LiveKitVoiceChat;
