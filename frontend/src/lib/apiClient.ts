import type { ClientConfig } from "../context/ConfigContext";

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
  const headers = new Headers(options.headers);

  if (config.apiKey) {
    headers.set("X-API-Key", config.apiKey);
  }

  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const requestId = response.headers.get("X-Request-ID") || undefined;

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
  const headers = new Headers(options.headers);

  if (config.apiKey) {
    headers.set("X-API-Key", config.apiKey);
  }

  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
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
    throw error;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining data in buffer
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            onChunk(parsed);
          } catch (e) {
            console.warn("Failed to parse final buffer:", buffer, e);
          }
        }
        onComplete?.();
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Split on newlines and process complete chunks
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed);
          onChunk(parsed);
        } catch (e) {
          console.warn("Failed to parse chunk:", trimmed, e);
        }
      }
    }
  } finally {
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

  ws.onopen = () => {
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
    onError?.(event);
  };

  ws.onclose = () => {
    console.log("WebSocket closed");
    onClose?.();
  };

  return ws;
}
