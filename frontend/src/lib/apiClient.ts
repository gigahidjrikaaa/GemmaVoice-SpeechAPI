import type { ClientConfig } from "../context/ConfigContext";
import { addDevLog } from "./devlog";

export type ApiError = {
  error: string;
  detail?: string;
  requestId?: string;
};

export type ApiResponse<T> = {
  data: T;
  requestId?: string;
};

/**
 * Fetch wrapper with API key and error handling
 */
export async function apiFetch<T>(
  config: ClientConfig,
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const url = `${config.baseUrl}${endpoint}`;
  const startedAt = performance.now();
  const method = (options.method || "GET").toUpperCase();
  addDevLog({ level: "info", source: "api", message: `${method} ${endpoint}` });
  const headers = new Headers(options.headers);

  if (config.apiKey) {
    headers.set("X-API-Key", config.apiKey);
  }

  // Set Content-Type for JSON bodies (whether object or already stringified)
  // Skip if body is FormData or if Content-Type is already set
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    // If body is an object, stringify it and set content type
    if (typeof options.body === "object") {
      options.body = JSON.stringify(options.body);
      headers.set("Content-Type", "application/json");
    } else if (typeof options.body === "string") {
      // If body is a string that looks like JSON, set content type
      const trimmed = options.body.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        headers.set("Content-Type", "application/json");
      }
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const requestId = response.headers.get("X-Request-ID") || undefined;

  const durationMs = Math.round(performance.now() - startedAt);
  addDevLog({
    level: response.ok ? "info" : "warn",
    source: "api",
    message: `${method} ${endpoint} → ${response.status} (${durationMs}ms)`,
    data: { status: response.status, statusText: response.statusText, durationMs, requestId },
  });

  if (!response.ok) {
    let error: ApiError;
    try {
      error = await response.json();
    } catch {
      error = {
        error: `HTTP ${response.status}: ${response.statusText}`,
        requestId,
      };
    }

    addDevLog({
      level: "error",
      source: "api",
      message: `API error: ${method} ${endpoint} → ${response.status}`,
      data: { ...error, status: response.status },
    });
    throw error;
  }

  const data = await response.json();
  return { data, requestId };
}

/**
 * Streaming fetch for Server-Sent Events or newline-delimited JSON
 */
export async function apiFetchStream(
  config: ClientConfig,
  endpoint: string,
  options: RequestInit,
  onChunk: (chunk: any) => void,
  onComplete?: () => void
): Promise<void> {
  const url = `${config.baseUrl}${endpoint}`;
  const startedAt = performance.now();
  const method = (options.method || "GET").toUpperCase();
  addDevLog({ level: "info", source: "api", message: `STREAM ${method} ${endpoint} (start)` });
  const headers = new Headers(options.headers);

  if (config.apiKey) {
    headers.set("X-API-Key", config.apiKey);
  }

  // Set Content-Type for JSON bodies (whether object or already stringified)
  // Skip if body is FormData or if Content-Type is already set
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    // If body is an object, stringify it and set content type
    if (typeof options.body === "object") {
      options.body = JSON.stringify(options.body);
      headers.set("Content-Type", "application/json");
    } else if (typeof options.body === "string") {
      // If body is a string that looks like JSON, set content type
      const trimmed = options.body.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        headers.set("Content-Type", "application/json");
      }
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let error: ApiError;
    try {
      error = await response.json();
    } catch {
      error = {
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    addDevLog({
      level: "error",
      source: "api",
      message: `Stream error: ${method} ${endpoint} → ${response.status}`,
      data: { ...error, status: response.status },
    });
    throw error;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    // SSE state
    let currentEvent = "message";
    let currentData = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        onComplete?.();
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages (terminated by double newline)
      const messages = buffer.split("\n\n");
      buffer = messages.pop() || ""; // Keep incomplete message in buffer

      for (const message of messages) {
        if (!message.trim()) continue;

        // Parse SSE message lines
        const lines = message.split("\n");
        currentEvent = "message"; // Reset
        currentData = "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.substring(6).trim();
          } else if (line.startsWith("data:")) {
            const dataLine = line.substring(5).trim();
            currentData += (currentData ? "\n" : "") + dataLine;
          }
        }

        // Parse data and call handler
        if (currentData) {
          try {
            const parsedData = JSON.parse(currentData);
            onChunk({ event: currentEvent, data: parsedData });
          } catch (e) {
            console.warn("Failed to parse SSE data:", currentData, e);
          }
        }
      }
    }
  } finally {
    const durationMs = Math.round(performance.now() - startedAt);
    addDevLog({ level: "info", source: "api", message: `STREAM ${method} ${endpoint} (end, ${durationMs}ms)` });
    reader.releaseLock();
  }
}

/**
 * WebSocket connection for real-time streaming
 */
export function createWebSocket(
  config: ClientConfig,
  endpoint: string,
  onMessage: (data: any) => void,
  onError?: (error: Event) => void,
  onClose?: () => void
): WebSocket {
  const wsUrl = config.baseUrl.replace(/^http/, "ws") + endpoint;
  const ws = new WebSocket(wsUrl);

  addDevLog({ level: "info", source: "ws", message: `WS connect ${endpoint}`, data: { wsUrl } });

  ws.onopen = () => {
    addDevLog({ level: "info", source: "ws", message: `WS open ${endpoint}` });
    // Send API key if configured
    if (config.apiKey) {
      ws.send(JSON.stringify({ type: "auth", apiKey: config.apiKey }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (e) {
      console.warn("Failed to parse WebSocket message:", event.data, e);
    }
  };

  ws.onerror = (event) => {
    console.error("WebSocket error:", event);
    addDevLog({ level: "error", source: "ws", message: `WS error ${endpoint}`, data: { event } });
    onError?.(event);
  };

  ws.onclose = () => {
    console.log("WebSocket closed");
    addDevLog({ level: "warn", source: "ws", message: `WS closed ${endpoint}` });
    onClose?.();
  };

  return ws;
}
