# Frontend Features Status & Implementation Guide

## 📊 Feature Implementation Status

### ✅ Completed Features (7/10)

#### 1. Model Selection UI ✅
**Status**: Fully implemented
**Location**: `src/components/SettingsPanel.tsx`, `src/context/ModelsContext.tsx`
**Features**:
- Dropdown to select LLM models
- Displays context length for each model
- Shows loading states
- Persists selection in context

**How to use**:
1. Open the frontend application
2. Expand "Connection settings"
3. Scroll to "🤖 LLM Model" section
4. Select from available models

---

#### 2. Settings Persistence ✅
**Status**: Fully implemented
**Location**: `src/context/ConfigContext.tsx`
**Features**:
- Auto-saves to localStorage
- Persists: API URL, API key, streaming mode, model selection
- Clears settings button available

**Storage key**: `aicare-config`

**How to verify**:
```javascript
// In browser console
localStorage.getItem('aicare-config')
```

---

#### 3. Error Boundaries ✅
**Status**: Fully implemented
**Location**: `src/components/ErrorBoundary.tsx`, used in `src/components/TabView.tsx`
**Features**:
- Catches React errors
- Shows user-friendly error messages
- Provides "Try again" button
- Logs errors to console

**How to test**:
1. Intentionally trigger an error in a component
2. Should show error UI instead of blank screen

---

#### 4. Shared Audio Utilities ✅
**Status**: Fully implemented
**Location**: `src/lib/audioUtils.ts`
**Functions**:
- `fileToBase64(file)` - Convert File/Blob to base64
- `base64ToBlob(base64, mimeType)` - Convert base64 to Blob
- `base64ToObjectURL(base64, mimeType)` - Create object URL
- Plus additional utilities

**Usage example**:
```typescript
import { fileToBase64, base64ToBlob } from '../lib/audioUtils';

// Convert file to base64
const base64 = await fileToBase64(audioFile);

// Convert base64 back to blob
const blob = base64ToBlob(base64Data, 'audio/wav');
```

---

#### 5. Voice Cloning (Deduplicated) ✅
**Status**: Fully implemented via shared hook
**Location**: `src/hooks/useVoiceCloning.ts`, `src/components/VoiceCloningInput.tsx`
**Features**:
- Upload reference audio files
- Toggle voice cloning on/off
- Shared across SynthesisPanel and ConversationPanel

**How to use**:
1. Go to "Text to Speech" or "Dialogue" tab
2. Toggle "Enable voice cloning"
3. Upload reference audio files
4. Generate speech with your voice

---

#### 6. Streaming Mode Selection ✅
**Status**: UI exists, REST streaming implemented
**Location**: `src/components/SettingsPanel.tsx`
**Options**:
- REST (HTTP streaming) - ✅ Working
- WebSocket - ⚠️ UI only, not implemented

---

#### 7. Toast Notifications ✅
**Status**: Fully implemented
**Location**: `src/components/Toast.tsx`
**Features**:
- Success/error notifications
- Auto-dismiss
- Multiple toasts support

**Usage**:
```typescript
const { push } = useToast();
push({ title: "Success!", description: "Operation completed" });
push({ title: "Error", description: "Something went wrong", variant: "error" });
```

---

### ❌ Missing Features (5/10)

#### 1. WebSocket Support ❌
**Status**: Not implemented
**Priority**: Medium
**Backend support**: ✅ Yes (`/v1/generate_ws` endpoint exists)

**What's needed**:
- WebSocket client implementation in `apiClient.ts`
- Update GenerationPanel to use WebSocket when selected
- Handle WebSocket connection lifecycle
- Reconnection logic on disconnect

**Implementation guide**:
```typescript
// src/lib/wsClient.ts (to be created)
export const createWebSocketConnection = (
  baseUrl: string,
  endpoint: string,
  apiKey: string
) => {
  const wsUrl = baseUrl.replace(/^http/, 'ws') + endpoint + `?api_key=${apiKey}`;
  const ws = new WebSocket(wsUrl);
  
  ws.onopen = () => console.log('WS connected');
  ws.onclose = () => console.log('WS disconnected');
  ws.onerror = (error) => console.error('WS error:', error);
  
  return ws;
};
```

**Backend endpoint**: `ws://localhost:21250/v1/generate_ws`

---

#### 2. Conversation Export ❌
**Status**: Not implemented
**Priority**: High
**Location**: Should be added to `ConversationPanel.tsx`

**What's needed**:
- Export as JSON button
- Export as text button
- Download functionality

**Implementation guide**:
```typescript
// Add to ConversationPanel.tsx

const exportConversationAsJSON = () => {
  const data = JSON.stringify(messages, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `conversation-${new Date().toISOString()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const exportConversationAsText = () => {
  const text = messages
    .map(m => `[${m.timestamp.toLocaleString()}] ${m.role}: ${m.text}`)
    .join('\n\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `conversation-${new Date().toISOString()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
};

// Add buttons in UI:
<button onClick={exportConversationAsJSON}>Export as JSON</button>
<button onClick={exportConversationAsText}>Export as Text</button>
```

---

#### 3. Audio Format Selection in ConversationPanel ❌
**Status**: Not implemented
**Priority**: Medium
**Location**: `ConversationPanel.tsx` - currently hardcoded

**What's needed**:
- Format selector (WAV, MP3, FLAC)
- Sample rate selector
- Apply to TTS requests

**Implementation**:
```typescript
// Add state
const [audioFormat, setAudioFormat] = useState<'wav' | 'mp3' | 'flac'>('wav');
const [sampleRate, setSampleRate] = useState(44100);

// Add UI in settings section
<select value={audioFormat} onChange={(e) => setAudioFormat(e.target.value)}>
  <option value="wav">WAV</option>
  <option value="mp3">MP3</option>
  <option value="flac">FLAC</option>
</select>

// Use in TTS request
body: JSON.stringify({
  text: assistantText,
  response_format: audioFormat,
  sample_rate: sampleRate,
  // ... other options
})
```

---

#### 4. Voice Preview Before Cloning ❌
**Status**: Not implemented
**Priority**: Low
**Location**: Should be added to `VoiceCloningInput.tsx`

**What's needed**:
- Play uploaded reference audio
- Waveform visualization (optional)
- Duration indicator

**Implementation**:
```typescript
// Add to VoiceCloningInput.tsx
const [previewUrl, setPreviewUrl] = useState<string | null>(null);

const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
  // Existing code...
  
  // Add preview
  if (files && files[0]) {
    const url = URL.createObjectURL(files[0]);
    setPreviewUrl(url);
  }
};

// Add UI
{previewUrl && (
  <audio controls src={previewUrl} className="w-full" />
)}
```

---

#### 5. Rate Limit Feedback ❌
**Status**: Not implemented
**Priority**: High
**Backend support**: ✅ Yes (backend sends 429 status)

**What's needed**:
- Detect 429 responses
- Show rate limit message
- Display retry-after time
- Disable buttons during cooldown

**Implementation**:
```typescript
// In apiClient.ts, modify apiFetch:
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  throw new Error(
    retryAfter 
      ? `Rate limited. Try again in ${retryAfter} seconds.`
      : 'Rate limited. Please slow down your requests.'
  );
}

// In components:
const [rateLimitedUntil, setRateLimitedUntil] = useState<Date | null>(null);

// Show UI:
{rateLimitedUntil && Date.now() < rateLimitedUntil.getTime() && (
  <div className="text-yellow-400 text-sm">
    ⏳ Rate limited. Try again in {Math.ceil((rateLimitedUntil.getTime() - Date.now()) / 1000)}s
  </div>
)}
```

---

### ⚠️ Issues to Fix (2)

#### 1. Duplicate `base64ToBlob` in DialoguePanel ⚠️
**Location**: `src/components/DialoguePanel.tsx` line 205
**Issue**: Function is duplicated despite `audioUtils.ts` existing

**Fix**:
```typescript
// Remove the local function definition
// Add import at top:
import { base64ToBlob } from '../lib/audioUtils';
```

---

#### 2. Inconsistent Loading UI ⚠️
**Issue**: Different loading patterns across components
- Some use spinner emoji (⚙️, 🔄)
- Some use text "Loading..."
- Some have no visual feedback

**Solution**: Create a shared Loading component

**Implementation**:
```typescript
// src/components/LoadingSpinner.tsx
export function LoadingSpinner({ 
  size = 'md',
  text
}: { 
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}) {
  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg'
  };
  
  return (
    <div className={`flex items-center gap-2 ${sizeClasses[size]}`}>
      <div className="animate-spin">⚙️</div>
      {text && <span className="text-slate-400">{text}</span>}
    </div>
  );
}

// Usage:
<LoadingSpinner size="md" text="Generating..." />
```

---

## 🎯 Accessibility Improvements Needed

### Current State
- ❌ Limited ARIA labels
- ❌ Inconsistent keyboard navigation
- ⚠️ Some buttons lack focus indicators
- ⚠️ No screen reader announcements

### Required Improvements

#### 1. Add ARIA Labels
```typescript
// Before:
<button onClick={handleSubmit}>Generate</button>

// After:
<button 
  onClick={handleSubmit}
  aria-label="Generate text from prompt"
  aria-busy={isLoading}
>
  Generate
</button>
```

#### 2. Keyboard Navigation
- Ensure all interactive elements are keyboard accessible
- Add proper tab order
- Implement keyboard shortcuts (optional)

```typescript
// Example: Add Ctrl+Enter to submit
<textarea
  onKeyDown={(e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      handleSubmit();
    }
  }}
  aria-label="Enter your prompt here"
/>
```

#### 3. Focus Management
```css
/* Add to global CSS */
button:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 2px solid theme('colors.emerald.400');
  outline-offset: 2px;
}
```

#### 4. Screen Reader Announcements
```typescript
// Use aria-live regions
<div 
  role="status" 
  aria-live="polite" 
  aria-atomic="true"
  className="sr-only"
>
  {isLoading && "Generating response..."}
  {error && `Error: ${error}`}
  {success && "Generation complete"}
</div>
```

---

## 📚 How to Use the Frontend - Complete Guide

### Getting Started

#### 1. Start the Application
```bash
cd frontend
npm install
npm run dev
```

Access at: **http://localhost:5174**

#### 2. Configure Connection
1. Open the app
2. Expand **"Connection settings"** at the top
3. Set **API base URL**: `http://localhost:21250`
4. (Optional) Set API key if authentication is enabled
5. Click **"Save"**

---

### Features Guide

#### 🤖 Text Generation Tab
**Purpose**: Generate text using the Gemma LLM

**How to use**:
1. Select this tab
2. Enter your prompt in the text area
3. (Optional) Adjust settings:
   - Max tokens: Maximum response length
   - Temperature: Creativity level (0.0 = focused, 1.0 = creative)
   - Top P: Nucleus sampling parameter
4. Click **"Generate"**
5. See the response appear below

**Tips**:
- Use clear, specific prompts
- Adjust temperature based on use case:
  - 0.1-0.3: Factual, deterministic
  - 0.7-0.9: Creative, varied
- Max tokens: 50-100 for short responses, 500+ for detailed

---

#### 🔊 Text-to-Speech Tab
**Purpose**: Convert text to speech using OpenAudio

**How to use**:
1. Select this tab
2. Enter text to synthesize
3. Configure options:
   - **Format**: WAV, MP3, or FLAC
   - **Sample Rate**: Audio quality (44100 Hz recommended)
   - **Reference ID**: Voice preset (or use voice cloning)
4. **Enable voice cloning** (optional):
   - Toggle "Enable voice cloning"
   - Click "Choose files" under "Reference Audio"
   - Upload 1-3 audio samples of the voice to clone (WAV recommended)
5. Click **"Synthesize"** or **"Stream Synthesis"**
6. Listen to the audio or download it

**Tips**:
- For voice cloning: Use clear, high-quality audio samples
- WAV format: Best quality, larger file
- MP3 format: Smaller file, good quality
- Streaming: Lower latency, good for real-time

---

#### 🎙️ Speech-to-Text Tab
**Purpose**: Transcribe audio using Whisper

**How to use**:
1. Select this tab
2. Upload an audio file or record:
   - Click **"Choose file"** to upload
   - Or use browser's recorder (if available)
3. (Optional) Set language hint
4. Click **"Transcribe"**
5. View the transcription and segments

**Tips**:
- Use clear audio with minimal background noise
- Supported formats: WAV, MP3, M4A, FLAC
- Longer files take more time to process

---

#### 💬 Dialogue Tab (Full Conversation)
**Purpose**: Full voice conversation pipeline (STT → LLM → TTS)

**How to use**:
1. Select this tab
2. (Optional) Customize system prompt
   - Defines the AI's personality and behavior
3. Configure voice response options:
   - Toggle "Use voice response" (enable TTS)
   - Toggle "Auto-play response" (automatically play audio)
4. (Optional) Enable voice cloning for AI responses
5. Click **"Start Recording"** (🎙️)
6. Speak your message
7. Click **"Stop Recording"** (⏹️)
8. Wait for processing:
   - Speech-to-Text converts your audio
   - LLM generates a response
   - Text-to-Speech creates audio response (if enabled)
9. View conversation history
10. Click **"Clear chat"** to reset

**Tips**:
- Speak clearly and pause between sentences
- System prompt examples:
  - "You are a helpful coding assistant."
  - "You are a friendly therapist. Be empathetic."
  - "You are a knowledgeable teacher. Explain simply."
- Voice cloning makes AI sound like you!

---

### ⚙️ Settings Panel

**Location**: Top of the page, "Connection settings"

**Options**:
1. **API base URL**: Backend server address
2. **API key**: Authentication (if required)
3. **Streaming mode**: REST or WebSocket (WebSocket not yet implemented)
4. **LLM Model**: Select which model to use
   - Shows context length
   - Changes affect all generation requests

**Actions**:
- **Save**: Persist settings (saved to localStorage)
- **Clear Settings**: Reset to defaults

---

## 🔧 Developer Guide

### Project Structure

```
frontend/
├── src/
│   ├── components/       # React components
│   │   ├── GenerationPanel.tsx
│   │   ├── SynthesisPanel.tsx
│   │   ├── TranscriptionPanel.tsx
│   │   ├── ConversationPanel.tsx
│   │   ├── DialoguePanel.tsx
│   │   ├── SettingsPanel.tsx
│   │   ├── VoiceCloningInput.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── Toast.tsx
│   │   └── TabView.tsx
│   ├── context/          # React contexts
│   │   ├── ConfigContext.tsx      # API config & settings
│   │   ├── ModelsContext.tsx      # Model selection
│   │   └── TabsContext.tsx        # Tab navigation
│   ├── hooks/            # Custom hooks
│   │   ├── useModels.ts
│   │   └── useVoiceCloning.ts
│   ├── lib/              # Utility functions
│   │   ├── apiClient.ts           # API communication
│   │   └── audioUtils.ts          # Audio utilities
│   ├── App.tsx           # Main app component
│   └── main.tsx          # Entry point
├── .env                  # Environment variables
├── .env.example          # Example env file
├── vite.config.ts        # Vite configuration
└── package.json          # Dependencies
```

### Adding a New Feature

1. **Create component** in `src/components/`
2. **Add state management** (use existing contexts or create new)
3. **Implement API calls** using `apiClient.ts`
4. **Add to tab view** in `App.tsx`
5. **Test thoroughly**
6. **Update this documentation**

### Common Patterns

#### Making API Calls
```typescript
import { apiFetch } from '../lib/apiClient';
import { useClientConfig } from '../context/ConfigContext';

const { config } = useClientConfig();

const response = await apiFetch<ResponseType>(
  config,
  '/v1/endpoint',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }
);
```

#### Streaming Responses
```typescript
import { apiFetchStream } from '../lib/apiClient';

await apiFetchStream(
  config,
  '/v1/endpoint',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  },
  (chunk) => {
    // Handle each chunk
    console.log(chunk);
  }
);
```

#### Using Toast Notifications
```typescript
import { useToast } from './Toast';

const { push } = useToast();

// Success
push({ title: "Success!", description: "Operation completed" });

// Error
push({ 
  title: "Error", 
  description: "Something went wrong", 
  variant: "error" 
});
```

---

## 🐛 Troubleshooting

### Frontend won't connect to backend
1. Check backend is running: `curl http://localhost:21250/health/live`
2. Verify API URL in settings: Should be `http://localhost:21250`
3. Check browser console for CORS errors
4. Clear localStorage: `localStorage.clear()` in console

### Voice cloning not working
1. Ensure audio files are clear quality
2. Use WAV format for best results
3. Check file size (max 10MB per file)
4. Try 2-3 different voice samples

### Audio playback issues
1. Check browser audio permissions
2. Try different audio format (WAV vs MP3)
3. Check browser console for errors
4. Verify backend TTS service is running

### Settings not saving
1. Check browser allows localStorage
2. Clear and re-enter settings
3. Hard refresh browser (Ctrl+Shift+R)

---

## 📝 Next Steps / Roadmap

### High Priority
1. ✅ Fix duplicate `base64ToBlob` in DialoguePanel
2. ✅ Add conversation export (JSON/Text)
3. ✅ Implement rate limit feedback
4. ❌ Add WebSocket support

### Medium Priority
5. ❌ Audio format selection in ConversationPanel
6. ❌ Create shared LoadingSpinner component
7. ❌ Improve accessibility (ARIA labels, keyboard nav)

### Low Priority
8. ❌ Voice preview before cloning
9. ❌ Waveform visualization
10. ❌ Conversation templates
11. ❌ Keyboard shortcuts
12. ❌ Dark/light theme toggle

---

## 📄 License & Credits

Part of the GemmaVoice (Gemma 3 Speech API) project.

Frontend built with:
- React 18
- TypeScript
- Vite
- Tailwind CSS
