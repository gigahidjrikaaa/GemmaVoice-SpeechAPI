import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { clearDevLogs, type DevLogEntry } from "../lib/devlog";
import { useDevLogs } from "../hooks/useDevLogs";

function levelBadge(level: DevLogEntry["level"]) {
  switch (level) {
    case "error":
      return { label: "ERR", cls: "border-red-500/30 bg-red-500/10 text-red-300" };
    case "warn":
      return { label: "WRN", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" };
    case "debug":
      return { label: "DBG", cls: "border-slate-800 bg-slate-900/70 text-slate-400" };
    case "info":
    default:
      return { label: "INF", cls: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" };
  }
}

function levelClass(level: DevLogEntry["level"]) {
  switch (level) {
    case "error":
      return "text-red-400";
    case "warn":
      return "text-amber-400";
    case "info":
      return "text-slate-300";
    case "debug":
      return "text-slate-500";
    default:
      return "text-slate-300";
  }
}

function sourceBadge(source: DevLogEntry["source"]) {
  switch (source) {
    case "api":
      return "API";
    case "livekit":
      return "LiveKit";
    case "ws":
      return "WS";
    case "ui":
      return "UI";
    default:
      return source;
  }
}

export function DevLogsPanel() {
  const logs = useDevLogs();
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const rendered = useMemo(() => {
    return logs.slice(-300);
  }, [logs]);

  useEffect(() => {
    if (!autoScroll) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [rendered, autoScroll]);

  const jumpToLatest = () => {
    bottomRef.current?.scrollIntoView({ block: "end" });
    setAutoScroll(true);
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;

    // If the user scrolls up, pause auto-scroll. If they scroll back to the bottom, resume.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 16;
    if (nearBottom && !autoScroll) setAutoScroll(true);
    if (!nearBottom && autoScroll) setAutoScroll(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Logs</span>
          <span className="text-[10px] text-slate-500">({logs.length})</span>
          {!autoScroll ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
                Paused
              </span>
              <button
                type="button"
                onClick={jumpToLatest}
                className="text-[10px] px-2 py-0.5 rounded-full border border-slate-800 bg-slate-900/40 text-slate-300 hover:bg-slate-900/70"
              >
                Jump to latest
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-400 select-none">
            <input
              type="checkbox"
              className="accent-emerald-500"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <button
            type="button"
            onClick={() => clearDevLogs()}
            className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-slate-300 hover:text-slate-100 bg-slate-900/60 hover:bg-slate-800 border border-slate-800 transition-colors"
            aria-label="Clear logs"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40"
      >
        {rendered.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            No logs yet. Interact with the UI to capture API and LiveKit events.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800/60 font-mono">
            {rendered.map((log) => (
              <li key={log.id} className="px-3 py-2 hover:bg-slate-900/30">
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-slate-600 shrink-0 pt-0.5">
                    {log.ts.replace("T", " ").replace("Z", "")}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${levelBadge(log.level).cls}`}
                    title={log.level}
                  >
                    {levelBadge(log.level).label}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-slate-800 bg-slate-900/70 text-slate-300 shrink-0">
                    {sourceBadge(log.source)}
                  </span>
                  <span className={`text-[11px] leading-relaxed ${levelClass(log.level)}`}>{log.message}</span>
                </div>
                {log.data !== undefined ? (
                  <details className="mt-1">
                    <summary className="text-[10px] text-slate-500 cursor-pointer select-none">Details</summary>
                    <pre className="mt-1 p-2 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-300 overflow-x-auto">
                      {JSON.stringify(log.data, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </li>
            ))}
            <div ref={bottomRef} />
          </ul>
        )}
      </div>
    </div>
  );
}
