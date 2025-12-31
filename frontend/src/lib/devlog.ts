export type DevLogLevel = "debug" | "info" | "warn" | "error";
export type DevLogSource = "api" | "livekit" | "ws" | "ui";

export type DevLogEntry = {
  id: string;
  ts: string;
  level: DevLogLevel;
  source: DevLogSource;
  message: string;
  data?: unknown;
};

type DevLogListener = (entries: DevLogEntry[]) => void;

const MAX_LOGS = 500;

let entries: DevLogEntry[] = [];
const listeners = new Set<DevLogListener>();

function makeId() {
  // Good enough for a debug panel; avoid pulling in deps.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function addDevLog(partial: Omit<DevLogEntry, "id" | "ts"> & { ts?: string }) {
  const entry: DevLogEntry = {
    id: makeId(),
    ts: partial.ts ?? new Date().toISOString(),
    level: partial.level,
    source: partial.source,
    message: partial.message,
    data: partial.data,
  };

  entries = [...entries, entry].slice(-MAX_LOGS);
  for (const listener of listeners) {
    listener(entries);
  }
}

export function getDevLogs() {
  return entries;
}

export function clearDevLogs() {
  entries = [];
  for (const listener of listeners) {
    listener(entries);
  }
}

export function subscribeDevLogs(listener: DevLogListener) {
  listeners.add(listener);
  // Push current state immediately
  listener(entries);
  return () => {
    listeners.delete(listener);
  };
}
