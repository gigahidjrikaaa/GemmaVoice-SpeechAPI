import { ClientConfig } from "../context/ConfigContext";

export class APIError extends Error {
  constructor(public status: number, message: string, public data?: any) {
    super(message);
    this.name = "APIError";
  }
}

/**
 * Generic fetch wrapper for API requests
 */
export async function apiFetch<T>(
  config: ClientConfig,
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T; response: Response }> {
  const url = `${config.baseUrl}${endpoint}`;
  
  const headers = new Headers(options.headers);
  if (config.apiKey) {
    headers.set("X-API-Key", config.apiKey);
  }
  
  // Set default Content-Type if not provided and not FormData
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `API Error: ${response.status} ${response.statusText}`;
    let errorData;
    
    try {
      errorData = await response.json();
      if (errorData.detail) {
        errorMessage = errorData.detail;
      } else if (errorData.message) {
        errorMessage = errorData.message;
      }
    } catch (e) {
      // Ignore JSON parse error
    }

    throw new APIError(response.status, errorMessage, errorData);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return { data: {} as T, response };
  }

  const data = await response.json();
  return { data, response };
}

/**
 * Helper for handling streaming responses (Server-Sent Events or NDJSON)
 */
export async function apiFetchStream(
  config: ClientConfig,
  endpoint: string,
  options: RequestInit,
  onEvent: (event: { event?: string; data: any }) => void
): Promise<void> {
  const url = `${config.baseUrl}${endpoint}`;
  
  const headers = new Headers(options.headers);
  if (config.apiKey) {
    headers.set("X-API-Key", config.apiKey);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `Stream Error: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData.detail) errorMessage = errorData.detail;
    } catch (e) { /* ignore */ }
    throw new APIError(response.status, errorMessage);
  }

  if (!response.body) {
    throw new Error("Response body is null");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        try {
          // Try parsing as JSON (NDJSON)
          const json = JSON.parse(trimmedLine);
          onEvent({ data: json });
        } catch (e) {
          // If not JSON, check for SSE format (data: ...)
          if (trimmedLine.startsWith("data: ")) {
            try {
              const jsonStr = trimmedLine.slice(6);
              const json = JSON.parse(jsonStr);
              onEvent({ event: "data", data: json });
            } catch (jsonError) {
              // If data is not JSON, pass as string
              onEvent({ event: "data", data: trimmedLine.slice(6) });
            }
          } else if (trimmedLine.startsWith("event: ")) {
             // Handle named events if needed, for now we just log or ignore
             // In a full SSE parser we'd store the event name and wait for data
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
