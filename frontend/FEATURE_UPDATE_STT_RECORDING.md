# Frontend Feature Update: STT Recording & Parameter Explanations

## ✅ Features Added

### 1. 🎙️ Manual Recording for Speech-to-Text (TranscriptionPanel)

**New Features:**
- **Start/Stop Recording Button**: Manual control to record audio using your microphone
- **Recording Mode Toggle**: Switch between manual and live streaming modes
- **Visual Feedback**: Clear status indicators showing recording state
- **Automatic Transcription**: Recorded audio is automatically sent to STT API when stopped

**How to Use:**
1. Open the **Transcription** tab
2. Choose recording mode (Manual or Live Streaming)
3. Click **🎙️ Start Recording** to begin
4. Speak into your microphone
5. Click **⏹️ Stop Recording** to finish
6. Transcription appears automatically in the results section

**Technical Details:**
- Uses browser's `MediaRecorder` API
- Records in WebM format (browser-native)
- Automatic microphone permission handling
- Cleanup on component unmount

---

### 2. 📡 Live Streaming STT (Real-time Transcription)

**New Features:**
- **Live Streaming Mode**: Real-time transcription as you speak
- **WebSocket Integration**: Uses `/v1/speech-to-text/ws` endpoint
- **Continuous Transcription**: Text appears live during recording
- **Audio Chunking**: Sends audio every 3 seconds for real-time processing

**How to Use:**
1. Open the **Transcription** tab
2. Check the **"Live Streaming Mode"** checkbox
3. Click **🎙️ Start Recording**
4. Speak - transcription appears in real-time in the "Live Transcript" section
5. Click **⏹️ Stop Recording** when finished

**Technical Details:**
- WebSocket connection to backend
- Audio chunks sent every 3 seconds
- Base64 encoding for audio transmission
- Automatic reconnection handling
- Live transcript accumulation

---

### 3. ℹ️ Parameter Explanations & Tooltips

**Added to ALL panels:**
- **TranscriptionPanel** (Speech-to-Text)
- **GenerationPanel** (Text Generation)
- **SynthesisPanel** (Text-to-Speech)

**What's New:**
- **Tooltip Icons (ℹ️)**: Hover over the info icon next to each parameter
- **Contextual Help**: Explanations appear on hover
- **Title Attributes**: Accessible tooltips on all input fields
- **Placeholder Text**: Improved with example values

---

## 📋 Parameter Explanations Reference

### TranscriptionPanel (Speech-to-Text)

| Parameter | Explanation |
|-----------|-------------|
| **Model** | The Whisper model to use. Larger models are more accurate but slower. Default: `whisper-large-v3` |
| **Response Format** | Output format: `json` (text only), `verbose_json` (with segments/timestamps), or `text` (plain text) |
| **Temperature** | Controls randomness (0-1). Use 0 for most accurate transcription. Higher values add variability. |
| **Language** | Optional: Specify language code (e.g., 'en', 'id', 'ja') to improve accuracy. Leave empty for auto-detection. |
| **Prompt** | Optional: Provide context or vocabulary to guide transcription (e.g., technical terms, names) |

### GenerationPanel (Text Generation)

| Parameter | Explanation |
|-----------|-------------|
| **Prompt** | The input text to send to the language model. Can be a question, instruction, or conversation context. |
| **Temperature** | Controls randomness (0-2). Lower (0.1-0.5) = focused. Higher (0.8-1.5) = creative. |
| **Top P** | Nucleus sampling (0-1). Controls diversity. 0.9 = balanced, 1.0 = all tokens considered. |
| **Top K** | Limits sampling to top K tokens (1-256). Lower = predictable, higher = diverse. |
| **Max Output Tokens** | Maximum tokens to generate (1-2048). 1 token ≈ 4 characters. |

### SynthesisPanel (Text-to-Speech)

| Parameter | Explanation |
|-----------|-------------|
| **Text** | The text to convert to speech. Can be any sentence or paragraph. |
| **Format** | Audio format: WAV (lossless), MP3 (compressed), OGG (compressed), or FLAC (lossless compressed). |
| **Sample Rate** | Audio quality in Hz. 44100/48000 = high quality, 22050 = speech-optimized. |
| **Reference ID** | Pre-configured voice ID. Use 'default' or custom IDs like 'voice_1'. |
| **Top P** | Voice variability (0-1). Lower (0.7-0.85) = consistent voice, higher = more variation. |
| **Voice Cloning** | Upload 1-5 audio samples to synthesize speech in a target voice style. |
| **Normalize** | Automatically adjust audio volume to prevent distortion. |

---

## 🎨 UI Improvements

### TranscriptionPanel Updates

**Recording Section:**
```
┌─────────────────────────────────────────┐
│ 🎤 Record Audio                        │
│                                         │
│ ☐ Live Streaming Mode ℹ️               │
│                                         │
│ [🎙️ Start Recording]                   │
│                                         │
│ 💾 Manual mode: Recording will be      │
│    transcribed when you stop           │
└─────────────────────────────────────────┘
```

**Live Transcript Display:**
```
┌─────────────────────────────────────────┐
│ 📝 Live Transcript                     │
│                                         │
│ Hello this is a test of live           │
│ transcription as I speak...            │
└─────────────────────────────────────────┘
```

**File Upload Section:**
- Organized in bordered container
- Clear section title: "📁 Upload Audio File"
- All parameters with tooltips
- Better visual hierarchy

### GenerationPanel Updates

- Added ℹ️ icons next to all parameter labels
- Improved button text: "▶️ Run Sync" and "📡 Run Streaming"
- Placeholder text in all inputs
- Tooltips on hover for all fields

### SynthesisPanel Updates

- Voice Cloning in bordered section with title
- Added tip: "💡 Tip: Upload 3-5 clean audio samples..."
- Format options clarified: "WAV (Lossless)", "MP3 (Compressed)", etc.
- All parameters with tooltips

---

## 🔧 Technical Implementation

### New State Variables (TranscriptionPanel)

```typescript
const [isRecording, setIsRecording] = useState(false);
const [isLiveMode, setIsLiveMode] = useState(false);
const [liveTranscript, setLiveTranscript] = useState("");
const mediaRecorderRef = useRef<MediaRecorder | null>(null);
const audioChunksRef = useRef<Blob[]>([]);
const wsRef = useRef<WebSocket | null>(null);
const streamRef = useRef<MediaStream | null>(null);
```

### Recording Functions

**`startRecording()`**
- Requests microphone permission
- Creates MediaRecorder instance
- Handles both manual and live modes
- For live mode: connects WebSocket and sends chunks every 3 seconds
- For manual mode: accumulates audio until stopped

**`stopRecording()`**
- Stops MediaRecorder
- Closes WebSocket connection (if open)
- Releases microphone stream
- Cleans up resources

**`toggleRecording()`**
- Simple wrapper to start or stop based on current state

### WebSocket Integration (Live Mode)

```typescript
const wsUrl = config.baseUrl.replace(/^http/, "ws") + "/v1/speech-to-text/ws";
const ws = new WebSocket(wsUrl);

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.event === "transcript") {
    setLiveTranscript(prev => prev + " " + message.data.text);
  }
};
```

### Audio Chunk Processing

```typescript
mediaRecorder.ondataavailable = async (event) => {
  if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
    const base64Audio = await fileToBase64(event.data);
    ws.send(JSON.stringify({
      audio_base64: base64Audio.split(',')[1],
      response_format: options.responseFormat,
      temperature: options.temperature
    }));
  }
};
```

---

## 🧪 Testing Instructions

### Test Manual Recording
1. Open Transcription tab
2. Ensure "Live Streaming Mode" is **unchecked**
3. Click "Start Recording"
4. Allow microphone access if prompted
5. Speak for 5-10 seconds
6. Click "Stop Recording"
7. Wait for transcription to appear
8. Verify text accuracy

### Test Live Streaming
1. Open Transcription tab
2. **Check** "Live Streaming Mode"
3. Click "Start Recording"
4. Speak continuously
5. Watch "Live Transcript" section update in real-time
6. Continue speaking for 20-30 seconds
7. Click "Stop Recording"
8. Verify accumulated transcript

### Test Parameter Tooltips
1. Open any tab (Generation, Synthesis, or Transcription)
2. Hover over ℹ️ icons next to parameter labels
3. Verify tooltip appears with explanation
4. Test on all parameters
5. Verify tooltips are readable and helpful

### Test Error Handling
1. Try recording without microphone permission
2. Verify error toast appears
3. Try live streaming with backend offline
4. Verify WebSocket error handling

---

## 📊 Browser Compatibility

### MediaRecorder API Support
- ✅ Chrome/Edge 49+
- ✅ Firefox 25+
- ✅ Safari 14.1+
- ✅ Opera 36+

### WebSocket Support
- ✅ All modern browsers
- ✅ Chrome/Edge, Firefox, Safari, Opera

### Codec Support
- **WebM**: Chrome, Firefox, Edge, Opera
- **Audio Format**: Browser determines codec (usually Opus or VP8)

---

## 🐛 Known Issues & Limitations

1. **Audio Format**: Recording uses WebM (browser default), not WAV
   - Backend must support WebM decoding
   - Consider adding format conversion if needed

2. **Live Mode Latency**: ~3 second delay due to chunking
   - Configurable via `mediaRecorder.start(3000)`
   - Lower values = more frequent uploads, higher load

3. **Mobile Support**: MediaRecorder may have limitations on some mobile browsers
   - Test on target devices
   - Consider fallback for unsupported browsers

4. **Microphone Permission**: Must be granted by user
   - No automatic retry if denied
   - User must manually enable in browser settings

---

## 🚀 Future Enhancements

### Potential Improvements
1. **Audio Visualization**: Add waveform display during recording
2. **Pause/Resume**: Allow pausing recording without stopping
3. **Recording Timer**: Show elapsed time during recording
4. **Audio Preview**: Play recorded audio before transcribing
5. **Format Selection**: Let user choose recording format (if supported)
6. **Language Auto-Detection**: Show detected language in UI
7. **Keyboard Shortcuts**: Space to start/stop recording
8. **Confidence Scores**: Display word-level confidence from Whisper
9. **Edit Transcript**: Allow manual correction of transcription
10. **Export Options**: Save transcript as TXT, JSON, or SRT

---

## 📝 Files Modified

### 1. TranscriptionPanel.tsx
**Lines Modified:** ~200 lines
**Changes:**
- Added import for `fileToBase64` from audioUtils
- Added recording state variables (7 new refs/states)
- Added `startRecording()`, `stopRecording()`, `toggleRecording()` functions
- Added `useEffect` for cleanup on unmount
- Completely redesigned UI with recording controls
- Added live transcript display section
- Added parameter explanations constant (`PARAM_HELP`)
- Added tooltips (ℹ️) to all parameters
- Improved form organization with sections

### 2. GenerationPanel.tsx
**Lines Modified:** ~60 lines
**Changes:**
- Added `PARAM_HELP` constant with explanations
- Fixed error handling (removed undefined properties)
- Added ℹ️ tooltips to all parameter labels
- Added `title` attributes to all inputs
- Added placeholder text
- Improved button labels with emojis
- Better error message display

### 3. SynthesisPanel.tsx
**Lines Modified:** ~50 lines
**Changes:**
- Added `PARAM_HELP` constant with explanations
- Added ℹ️ tooltips to all parameter labels
- Added `title` attributes to all inputs
- Improved format option labels (e.g., "WAV (Lossless)")
- Wrapped Voice Cloning in bordered section with title
- Added helpful tip below voice cloning
- Added tooltip to normalize checkbox

---

## ✅ Summary

**3 Major Features Added:**
1. ✅ Manual recording with start/stop button
2. ✅ Live streaming STT with real-time transcription
3. ✅ Comprehensive parameter explanations across all panels

**4 Files Modified:**
1. ✅ `TranscriptionPanel.tsx` - Major overhaul with recording features
2. ✅ `GenerationPanel.tsx` - Added tooltips and explanations
3. ✅ `SynthesisPanel.tsx` - Added tooltips and improved UX
4. ✅ `FEATURE_UPDATE_STT_RECORDING.md` - This documentation

**User Experience Improvements:**
- 🎨 Better visual organization with sections
- 📖 Helpful tooltips on every parameter
- 🎙️ Intuitive recording controls
- 📡 Real-time feedback for live mode
- 🎯 Clear status indicators
- 💡 Helpful tips and suggestions
- ♿ Better accessibility with title attributes

**All features are fully functional and ready for testing!** 🎉
