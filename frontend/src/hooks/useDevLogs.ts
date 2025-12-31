import { useEffect, useState } from "react";
import type { DevLogEntry } from "../lib/devlog";
import { subscribeDevLogs } from "../lib/devlog";

export function useDevLogs() {
  const [logs, setLogs] = useState<DevLogEntry[]>([]);

  useEffect(() => {
    return subscribeDevLogs(setLogs);
  }, []);

  return logs;
}
