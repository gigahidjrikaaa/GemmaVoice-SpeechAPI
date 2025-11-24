# Frontend Text Generation Issues - Summary & Fixes

## Current Status

✅ **Error Handler Fixed** - No more blank page crash  
✅ **Backend Running** - Returning 200 for streaming, processing requests  
❌ **Streaming Results Not Showing** - Events received but not displayed  
❌ **Sync Generation Validation Error** - "Input should be a valid dictionary or object"

---

## Issue 1: Streaming Results Not Displaying

**Backend Logs:**
```
2025-11-24 06:32:09,748 | INFO | Starting SSE stream
2025-11-24 06:32:09,752 | INFO | Request processed
2025-11-24 06:32:09,752 | INFO | "POST /v1/generate_stream HTTP/1.1" 200
```

**Problem:** The frontend receives SSE events and logs them, but doesn't display the generated text.

**Root Cause:** The `apiFetchStream` function in `apiClient.ts` is parsing SSE events, but the GenerationPanel's event handler is only logging them to `streamLog`. It's not extracting the actual text tokens to display.

**Fix Needed:**
The streaming handler needs to:
1. Parse SSE event types (`event: text`, `event: done`)
2. Extract text from `data.text` field
3. Accumulate text tokens for display
4. Show final result when `event: done` is received

---

## Issue 2: Sync Generation Validation Error

**Error:** `"Input should be a valid dictionary or object to extract fields from"`

**Problem:** This is a Pydantic validation error from the backend. It means the backend endpoint received a request but couldn't parse the body as a valid `GenerationRequest` object.

**Possible Causes:**
1. Request body is not valid JSON
2. Content-Type header missing or incorrect
3. Body is empty or malformed
4. FastAPI isn't parsing the JSON correctly

**Debug Steps:**
1. Check backend logs for the actual request body received
2. Verify `Content-Type: application/json` header is sent
3. Ensure `JSON.stringify(payload)` produces valid JSON
4. Check if backend is expecting different field names

---

## Recommended Actions

### For Streaming Display:

Update `GenerationPanel.tsx` line 132-135 to properly handle SSE events:

```tsx
}, (event) => {
  errorLogger.logDebug('Stream event received', { event: event.event, dataType: typeof event.data });
  setStreamLog((prev) => [...prev, { event: String(event.event ?? "data"), data: event.data }]);
  
  // Handle text events
  if (event.event === 'text' && event.data && typeof event.data === 'object') {
    const textData = event.data as { text?: string };
    if (textData.text) {
      // Append to result display
      setResult((prev) => ({
        generated_text: (prev?.generated_text || '') + textData.text
      }));
    }
  }
  
  // Handle done event
  if (event.event === 'done') {
    push({ title: "Streaming complete" });
  }
});
```

### For Sync Validation Error:

Add debug logging to see what's being sent:

```tsx
mutationFn: async (payload) => {
  console.log('Sending payload:', payload);
  console.log('JSON payload:', JSON.stringify(payload));
  
  errorLogger.logInfo('Starting text generation', { payload });
  const { data } = await apiFetch<GenerationResponse>(config, "/v1/generate", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  // ...
}
```

Then check browser console to see the exact payload being sent.

---

## Backend SSE Format Reference

Based on the code, SSE events should follow this format:

```
event: text
data: {"text": "Hello"}

event: text  
data: {"text": " world"}

event: usage
data: {"total_tokens": 10, "finish_reason": "stop"}

event: done
data: {}
```

The frontend needs to parse these event types and extract the `text` field from the `data` object.
