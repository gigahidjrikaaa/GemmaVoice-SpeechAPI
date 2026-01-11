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
import { AudioVisualizer } from "./AudioVisualizer";
import { apiFetch } from "../lib/api";
import { errorLogger } from "../lib/error";
import { addDevLog } from "../lib/devlog";
import { Mic, MicOff, Phone, PhoneOff, Volume2, Loader2, AlertCircle, Signal, RefreshCw } from "lucide-react";

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

interface AgentEvent {
  ts_ms: number;
  room_name: string;
  job_id?: string | null;
  job_type?: string | null;
  agent_identity: string;
  participant_identity?: string | null;
  status: string;
  message?: string | null;
  data?: Record<string, unknown> | null;
}

interface AgentStatusResponse {
  room_name: string;
  agent_identity: string;
  agent_present: boolean;
  agent_tracks: number;
  last_event?: AgentEvent | null;
  recent_events: AgentEvent[];
}

function formatTime(tsMs: number): string {
  try {
    return new Date(tsMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return String(tsMs);
  }
}

function getEventKind(e: AgentEvent): "ok" | "warn" | "error" {
  const status = (e.status || "").toUpperCase();
  if (status.includes("ERROR") || status.includes("FAILED")) return "error";
  if (status.includes("TIMEOUT") || status.includes("WARN")) return "warn";
  return "ok";
}

function getTranscriptTextFromEvent(e: AgentEvent): string | null {
  if (!e) return null;
  if (e.status !== "STT_FINAL_TRANSCRIPT") return null;
  const data = e.data as Record<string, unknown> | null | undefined;
  const text = typeof data?.text === "string" ? data.text : null;
  return text && text.trim() ? text : null;
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

function MicInputPanel({ inputDeviceId }: { inputDeviceId: string }) {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const previewErrorLoggedRef = useRef(false);

  const micPub = localParticipant?.getTrackPublication(Track.Source.Microphone);
  const published = Boolean(micPub);
  const mutedByPub = Boolean(micPub?.isMuted);
  const muted = !isMicrophoneEnabled || mutedByPub;

  useEffect(() => {
    let cancelled = false;

    async function ensurePreviewStream() {
      if (muted) {
        setPreviewStream((prev) => {
          prev?.getTracks().forEach((t) => t.stop());
          return null;
        });
        return;
      }

      try {
        const constraints: MediaStreamConstraints = {
          audio:
            inputDeviceId && inputDeviceId !== "default"
              ? { deviceId: { exact: inputDeviceId } }
              : true,
          video: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        previewErrorLoggedRef.current = false;
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setPreviewStream((prev) => {
          prev?.getTracks().forEach((t) => t.stop());
          return stream;
        });
      } catch (err) {
        if (!previewErrorLoggedRef.current) {
          previewErrorLoggedRef.current = true;
          addDevLog({
            level: "warn",
            source: "ui",
            message: "Mic preview getUserMedia failed (visualizer may be empty)",
            data: { error: (err as Error)?.message ?? String(err), inputDeviceId },
          });
        }
        setPreviewStream(null);
      }
    }

    ensurePreviewStream();
    return () => {
      cancelled = true;
      setPreviewStream((prev) => {
        prev?.getTracks().forEach((t) => t.stop());
        return null;
      });
    };
  }, [inputDeviceId, muted]);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-slate-300">Mic input</div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-2 rounded-full px-2 py-0.5 border ${
              muted
                ? "border-slate-800 bg-slate-900/40 text-slate-400"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {muted ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
            {muted ? "Muted" : "Live"}
          </span>
        </div>
      </div>

      <div className="mt-2 text-[11px] text-slate-500">
        {published ? (
          <>Publishing microphone track.</>
        ) : (
          <>Microphone track not published yet.</>
        )}
      </div>

      <div className="mt-3 h-20 rounded-md border border-slate-800 bg-slate-950/30 overflow-hidden">
        {!muted && previewStream ? (
          <AudioVisualizer stream={previewStream} className="h-full w-full" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-[11px] text-slate-600">
            {muted ? "Muted" : "No mic preview"}
          </div>
        )}
      </div>

      {muted ? (
        <div className="mt-2 text-[11px] text-slate-400">
          Unmute to send your voice to the agent.
        </div>
      ) : null}
    </div>
  );
}

function AgentProgressPanel({ agentStatus }: { agentStatus: AgentStatusResponse | null }) {
  const events = agentStatus?.recent_events ?? [];

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <div className="text-xs font-medium text-slate-300">Agent progress</div>

      {events.length === 0 ? (
        <div className="mt-2 text-[11px] text-slate-500">No agent events yet.</div>
      ) : (
        <div className="mt-3 space-y-2">
          {events.slice(-12).map((e) => {
            const kind = getEventKind(e);
            const dotClass =
              kind === "error"
                ? "bg-red-500"
                : kind === "warn"
                ? "bg-amber-500"
                : "bg-emerald-500";

            return (
              <div key={`${e.ts_ms}-${e.status}`} className="flex items-start gap-3">
                <div className={`mt-1 h-2 w-2 rounded-full ${dotClass}`} />
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-300">
                    <span className="text-slate-500">{formatTime(e.ts_ms)}</span>
                    <span className="mx-2 text-slate-700">•</span>
                    <span className="font-medium">{e.status}</span>
                  </div>
                  {e.message ? (
                    <div className="mt-0.5 text-[11px] text-slate-500 truncate">{e.message}</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LiveTranscriptPanel({ agentStatus }: { agentStatus: AgentStatusResponse | null }) {
  const events = agentStatus?.recent_events ?? [];
  const transcripts = events
    .map((e) => ({ ts_ms: e.ts_ms, text: getTranscriptTextFromEvent(e) }))
    .filter((x): x is { ts_ms: number; text: string } => Boolean(x.text));

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-slate-300">Live transcript</div>
        <div className="text-[10px] text-slate-500">(per utterance)</div>
      </div>

      {transcripts.length === 0 ? (
        <div className="mt-2 text-[11px] text-slate-500">No transcript yet.</div>
      ) : (
        <div className="mt-3 space-y-2">
          {transcripts.slice(-6).map((t) => (
            <div key={`${t.ts_ms}-${t.text.slice(0, 20)}`} className="rounded-md border border-slate-800/60 bg-slate-950/30 px-3 py-2">
              <div className="text-[10px] text-slate-500">{formatTime(t.ts_ms)}</div>
              <div className="mt-1 text-xs text-slate-200 break-words">{t.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Voice Assistant Visualizer ---

function VoiceAssistantView({ agentStatus }: { agentStatus: AgentStatusResponse | null }) {
  const { state, audioTrack } = useVoiceAssistant();
  const remoteParticipants = useRemoteParticipants();
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true });

  const effectiveState = agentStatus?.agent_present ? state : "idle";

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
            effectiveState === "speaking" 
              ? "bg-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.3)]" 
              : "bg-slate-800/50"
          }`}>
            <div className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
              effectiveState === "listening"
                ? "bg-blue-500/20 animate-pulse"
                : effectiveState === "speaking"
                ? "bg-emerald-500/30"
                : effectiveState === "thinking"
                ? "bg-amber-500/20 animate-pulse"
                : "bg-slate-800"
            }`}>
              {effectiveState === "speaking" ? (
                <Volume2 className="w-8 h-8 text-emerald-400" />
              ) : effectiveState === "listening" ? (
                <Mic className="w-8 h-8 text-blue-400" />
              ) : (
                <div className="w-3 h-3 rounded-full bg-slate-500" />
              )}
            </div>
          </div>
          
          {/* Status Badge */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-medium uppercase tracking-wider text-slate-400 whitespace-nowrap shadow-sm">
            {effectiveState || "Idle"}
          </div>
        </div>
        
        {remoteParticipants.length === 0 && (
          <p className="text-xs text-slate-500 animate-pulse">
            Waiting for agent to join...
          </p>
        )}
      </div>

      {/* Audio Visualizer */}
      <div className="w-full">
        <div className="mb-2 text-xs font-medium text-slate-300">Agent output</div>
        <div className="h-32 bg-slate-950/50 rounded-xl border border-slate-800/50 overflow-hidden relative">
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
    </div>
  );
}

// --- Room Session Component ---

function RoomSession({
  onDisconnect,
  onReconnect,
  reconnectDisabled,
  agentStatus,
  inputDeviceId,
}: {
  onDisconnect: () => void;
  onReconnect: () => void;
  reconnectDisabled: boolean;
  agentStatus: AgentStatusResponse | null;
  inputDeviceId: string;
}) {
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
          {agentStatus ? (
            <span className="ml-3 text-[11px] text-slate-500">
              Agent: {agentStatus.agent_present ? "joined" : "not in room"}
              {agentStatus.last_event?.status ? ` • ${agentStatus.last_event.status}` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onReconnect}
            disabled={reconnectDisabled}
            className="inline-flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/30 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Reconnect and re-dispatch the agent"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Signal className="w-3 h-3" />
            <span>LiveKit SFU</span>
          </div>
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

            {agentStatus?.last_event ? (
              <div className="mt-2 w-full max-w-xl rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 text-left">
                <div className="text-xs font-medium text-slate-300">Agent status</div>
                <div className="mt-1 text-xs text-slate-500">
                  {agentStatus.agent_present ? "Agent is in the room." : "Agent is not in the room yet."}
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  <span className="text-slate-500">Last event:</span> {agentStatus.last_event.status}
                  {agentStatus.last_event.message ? ` — ${agentStatus.last_event.message}` : ""}
                </div>
              </div>
            ) : null}
          </div>
        ) : connectionState === ConnectionState.Connected ? (
          <div className="z-10 w-full">
            <div className="mx-auto w-full max-w-5xl px-4">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-800/50 bg-slate-950/20 p-4">
                  <VoiceAssistantView agentStatus={agentStatus} />
                </div>
                <div className="space-y-4">
                  <MicInputPanel inputDeviceId={inputDeviceId} />
                  <LiveTranscriptPanel agentStatus={agentStatus} />
                  <AgentProgressPanel agentStatus={agentStatus} />
                </div>
              </div>
            </div>
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
  const [sessionKey, setSessionKey] = useState(0);
  const [agentStatus, setAgentStatus] = useState<AgentStatusResponse | null>(null);
  const hasCheckedStatus = useRef(false);
  const lastAgentPresenceRef = useRef<boolean | null>(null);
  const lastAgentEventKeyRef = useRef<string | null>(null);

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

  const reconnectSession = useCallback(async () => {
    try {
      addDevLog({ level: "warn", source: "livekit", message: "Refresh requested (rejoining room)" });

      const roomToReset = tokenData?.room_name;
      if (roomToReset) {
        try {
          addDevLog({
            level: "info",
            source: "livekit",
            message: `Attempting to kick agent before rejoin (room=${roomToReset})`,
          });
          await apiFetch<{ kicked: boolean }>(config, "/v1/livekit/agent/kick", {
            method: "POST",
            body: JSON.stringify({ room_name: roomToReset }),
          });
        } catch (err) {
          // Best-effort: reconnect still works even if the kick fails.
          addDevLog({
            level: "warn",
            source: "livekit",
            message: "Agent kick failed (continuing with reconnect)",
            data: { error: errorLogger.getUserFriendlyMessage(err) },
          });
        }
      }

      // Force the LiveKitRoom to unmount and disconnect, then remount with a new token.
      setIsSessionActive(false);
      clearToken();
      setSessionKey((k) => k + 1);

      // Let React commit the unmount before requesting a new token.
      await new Promise((resolve) => setTimeout(resolve, 150));

      await requestToken();
      setIsSessionActive(true);
      push({ title: "Refreshing...", description: "Rejoining the room" });
    } catch (err) {
      const message = errorLogger.getUserFriendlyMessage(err);
      addDevLog({
        level: "error",
        source: "livekit",
        message: "Refresh failed",
        data: { error: message },
      });
      push({ title: "Refresh Failed", description: message, variant: "error" });
    }
  }, [clearToken, push, requestToken, tokenData?.room_name, config]);

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

  // Poll agent status while a session is active (helps troubleshooting when stuck)
  useEffect(() => {
    if (!isSessionActive || !tokenData?.room_name) {
      setAgentStatus(null);
      return;
    }

    let cancelled = false;
    const roomName = tokenData.room_name;

    const tick = async () => {
      try {
        const { data } = await apiFetch<AgentStatusResponse>(
          config,
          `/v1/livekit/agent/status?room_name=${encodeURIComponent(roomName)}&limit=15`
        );
        if (cancelled) return;

        setAgentStatus(data);

        // Log only meaningful deltas so the console stays readable.
        const prevPresence = lastAgentPresenceRef.current;
        if (prevPresence === null || prevPresence !== data.agent_present) {
          lastAgentPresenceRef.current = data.agent_present;
          addDevLog({
            level: data.agent_present ? "info" : "warn",
            source: "livekit",
            message: data.agent_present ? "Agent is in the room" : "Agent is not in the room",
            data: {
              room: data.room_name,
              agent_identity: data.agent_identity,
              agent_tracks: data.agent_tracks,
              last_event: data.last_event?.status ?? null,
            },
          });
        }

        const last = data.last_event;
        const eventKey = last ? `${last.ts_ms}:${last.status}:${last.message ?? ""}` : null;
        if (eventKey && eventKey !== lastAgentEventKeyRef.current) {
          const lastEvent: AgentEvent | null | undefined = last;
          if (!lastEvent) return;
          lastAgentEventKeyRef.current = eventKey;
          addDevLog({
            level: getEventKind(lastEvent) === "error" ? "error" : "debug",
            source: "livekit",
            message: `Agent event: ${lastEvent.status}`,
            data: { message: lastEvent.message ?? null, data: lastEvent.data ?? null },
          });
        }
      } catch (err) {
        if (!cancelled) {
          // Don’t spam; just keep the last good status.
          addDevLog({
            level: "warn",
            source: "livekit",
            message: "Agent status poll failed",
            data: { error: errorLogger.getUserFriendlyMessage(err) },
          });
        }
      }
    };

    // Immediate + interval
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isSessionActive, tokenData?.room_name, config]);

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
        key={sessionKey}
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
        <RoomSession
          onDisconnect={endSession}
          onReconnect={reconnectSession}
          reconnectDisabled={loading}
          agentStatus={agentStatus}
          inputDeviceId={inputDeviceId}
        />
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
