# 🎙️ Live 2-Way Conversation Demo

**Real-time voice conversation with AI using STT → LLM → TTS pipeline**

---

## 📋 Overview

The Live Conversation feature creates a natural, continuous dialogue experience by seamlessly connecting three AI services:

1. **Speech-to-Text (Whisper)** - Converts your voice to text
2. **Language Model (Gemma 3)** - Generates intelligent responses
3. **Text-to-Speech (OpenAudio)** - Converts AI responses back to voice

This enables a **hands-free, voice-driven conversation** with the AI assistant.

---

## ✨ Features

### Core Capabilities
- 🎙️ **Voice Recording** - Click to start/stop recording with your microphone
- 💬 **Real-time Conversation** - Continuous back-and-forth dialogue
- 🔊 **Voice Responses** - AI speaks back to you (optional)
- ▶️ **Auto-play** - Responses play automatically (optional)
- 📜 **Conversation History** - Full transcript of your chat
- 🎨 **Visual Interface** - Chat bubble UI with timestamps

### Advanced Features
- 🎤 **Voice Cloning** - Clone a specific voice for AI responses
- ⚙️ **System Prompt** - Customize AI personality and behavior
- 🔇 **Text-only Mode** - Disable voice responses if needed
- 🧹 **Clear Chat** - Start fresh conversations anytime
- 📱 **Responsive Design** - Works on desktop and mobile

---

## 🚀 How to Use

### 1. Access the Live Conversation Tab

Navigate to the frontend at `http://localhost:5174` and click the **"🎙️ Live Conversation"** tab.

### 2. Configure Settings (Optional)

**System Prompt:**
```
You are a helpful AI assistant. Keep your responses concise and conversational.
```
Customize this to change the AI's personality (e.g., "You are a medical expert", "You are a friendly tutor").

**Voice Settings:**
- ✅ **Voice responses** - Enable/disable TTS for AI replies
- ✅ **Auto-play** - Automatically play voice responses
- ✅ **Voice cloning** - Upload reference audio to clone a specific voice

### 3. Start Recording

1. Click the **"🎙️ Start Recording"** button
2. Speak clearly into your microphone
3. Click **"⏹️ Stop Recording"** when finished

### 4. AI Processes Your Message

The system will:
1. **Transcribe** your speech to text (Whisper)
2. **Generate** an intelligent response (Gemma 3)
3. **Synthesize** the response to speech (OpenAudio)
4. **Display** the conversation in chat format

### 5. Continue the Conversation

Repeat steps 3-4 to have a continuous dialogue. The AI remembers the conversation history!

---

## 🎨 User Interface Guide

### Conversation Display

```
┌────────────────────────────────────────┐
│ 💬 Live Conversation     [Clear chat]  │
├────────────────────────────────────────┤
│                                        │
│           ┌──────────────────────┐    │  ← You (right-aligned, green)
│           │ You         3:45 PM  │    │
│           │ What's the weather?  │    │
│           └──────────────────────┘    │
│                                        │
│  ┌──────────────────────────┐         │  ← Assistant (left-aligned, gray)
│  │ Assistant      3:45 PM   │         │
│  │ I don't have real-time   │         │
│  │ weather data, but I can  │         │
│  │ help you find it!        │         │
│  │ [▶️ Play audio]          │         │
│  └──────────────────────────┘         │
│                                        │
└────────────────────────────────────────┘
```

### Control Panel

```
┌────────────────────────────────────────┐
│     [🎙️ Start Recording]              │  ← Click to record
│                                        │
│   Or when recording:                   │
│     [⏹️ Stop Recording] (pulsing)     │
│                                        │
│   Or when processing:                  │
│     ⚙️ Processing your message...     │
│                                        │
│   📊 3 message(s) in conversation     │
└────────────────────────────────────────┘
```

---

## 🔧 Technical Details

### API Endpoints Used

1. **POST `/v1/speech-to-text`**
   ```json
   FormData:
   - file: audio/webm blob
   
   Response:
   {
     "text": "transcribed text",
     "language": "en"
   }
   ```

2. **POST `/v1/generate`**
   ```json
   Request:
   {
     "prompt": "System prompt + conversation history",
     "max_tokens": 200,
     "temperature": 0.7,
     "top_p": 0.9
   }
   
   Response:
   {
     "text": "AI generated response"
   }
   ```

3. **POST `/v1/text-to-speech`**
   ```json
   Request:
   {
     "text": "AI response text",
     "format": "mp3",
     "sample_rate": 24000,
     "normalize": true,
     "references": ["base64_audio..."] // optional voice cloning
   }
   
   Response:
   {
     "audio_base64": "base64 encoded audio",
     "response_format": "mp3",
     "media_type": "audio/mpeg"
   }
   ```

### Audio Recording

Uses the **Web Audio API** (`navigator.mediaDevices.getUserMedia`):
- Records in WebM format (browser default)
- Captures microphone input
- Stops all tracks after recording

### State Management

```typescript
- messages: Message[]           // Conversation history
- isRecording: boolean          // Recording state
- isProcessing: boolean         // Processing state
- systemPrompt: string          // AI personality
- useVoiceResponse: boolean     // Enable TTS
- autoPlayResponse: boolean     // Auto-play audio
- referenceFiles: File[]        // Voice cloning files
```

### Message Flow

```
User clicks "Start Recording"
  ↓
Browser requests microphone access
  ↓
User speaks → Audio chunks captured
  ↓
User clicks "Stop Recording"
  ↓
Audio blob created (WebM)
  ↓
POST to /v1/speech-to-text (Whisper)
  ↓
Text transcribed
  ↓
Add user message to chat
  ↓
Build conversation context
  ↓
POST to /v1/generate (Gemma LLM)
  ↓
AI response generated
  ↓
[Optional] POST to /v1/text-to-speech (OpenAudio)
  ↓
Audio synthesized
  ↓
Add assistant message to chat
  ↓
[Optional] Auto-play audio
  ↓
Ready for next message
```

---

## 💡 Use Cases

### 1. Voice Assistant
```
System Prompt: "You are a helpful personal assistant."
Use Case: Daily task management, reminders, information lookup
```

### 2. Language Tutor
```
System Prompt: "You are a patient language tutor. Correct mistakes gently."
Use Case: Practice speaking a new language
Voice Cloning: Use native speaker voice
```

### 3. Medical Consultation (Demo)
```
System Prompt: "You are a medical AI assistant. Ask relevant health questions."
Use Case: Symptom checker, health advice (demo purposes only)
```

### 4. Customer Service Bot
```
System Prompt: "You are a friendly customer service representative."
Use Case: Answer product questions, handle complaints
Voice Cloning: Use company brand voice
```

### 5. Companion Chat
```
System Prompt: "You are a supportive friend. Be empathetic and encouraging."
Use Case: Mental health support, companionship
```

---

## 🎤 Voice Cloning Setup

### Step 1: Enable Voice Cloning
1. Check **"Voice responses"**
2. Check **"Voice cloning"**
3. Upload section appears

### Step 2: Upload Reference Audio
1. Click **"Choose reference audio"**
2. Select audio file(s):
   - **Duration**: 3-10 seconds
   - **Format**: WAV, MP3, FLAC, OGG
   - **Quality**: Clean speech, no background noise
3. File(s) appear in the list

### Step 3: Start Conversation
All AI responses will use the cloned voice!

**Example:**
```typescript
// Your reference audio: someone speaking Bahasa Indonesia
// AI will respond in that person's voice speaking Bahasa Indonesia
```

---

## ⚙️ Configuration Options

### System Prompt Examples

**Professional:**
```
You are a professional AI assistant. Be formal, concise, and accurate.
```

**Friendly:**
```
You are a friendly chatbot. Use casual language and emojis!
```

**Technical:**
```
You are a technical expert. Provide detailed, accurate technical information.
```

**Creative:**
```
You are a creative writing assistant. Be imaginative and descriptive.
```

### Conversation Parameters

| Setting | Default | Description |
|---------|---------|-------------|
| Max tokens | 200 | Length of AI responses |
| Temperature | 0.7 | Creativity (0.0-1.0) |
| Top P | 0.9 | Nucleus sampling |
| Sample rate | 24000 Hz | Audio quality |
| Format | MP3 | Audio format |

---

## 🔍 Troubleshooting

### Issue: Microphone not working
**Solution:**
- Allow microphone permissions in browser
- Check browser console for errors
- Ensure HTTPS or localhost (required for getUserMedia)

### Issue: No voice responses
**Solution:**
- Check "Voice responses" is enabled
- Verify OpenAudio service is running on port 21251
- Check browser console for TTS errors

### Issue: Poor transcription quality
**Solution:**
- Speak clearly and slowly
- Reduce background noise
- Use a better microphone
- Ensure Whisper service is running

### Issue: Slow responses
**Solution:**
- Backend may be loading models (first request)
- Check Docker container logs
- Verify GPU is being used (if available)
- Reduce max_tokens for faster responses

### Issue: AI forgets context
**Solution:**
- Conversation history is maintained in state
- Check messages array in React DevTools
- Clear chat and start over if needed

### Issue: Voice cloning not working
**Solution:**
- Verify reference audio is 3-10 seconds
- Ensure audio is clear (no noise/echo)
- Check file format is supported
- Try multiple reference samples

---

## 📊 Performance Tips

### Optimize Response Time
1. **Use GPU** - Enable CUDA for faster processing
2. **Reduce max_tokens** - Shorter responses = faster generation
3. **Disable voice** - Text-only mode is much faster
4. **Warm-up models** - First request is slower (model loading)

### Improve Voice Quality
1. **Better microphone** - USB or headset mic recommended
2. **Quiet environment** - Reduce background noise
3. **Clear speech** - Speak directly into microphone
4. **Good reference audio** - For voice cloning, use high-quality samples

### Manage Memory
1. **Clear chat periodically** - Long conversations use more memory
2. **Limit message history** - Modify code to keep last N messages
3. **Close unused tabs** - Browser memory management

---

## 🎯 Best Practices

### For Users
- 🎙️ **Speak clearly** - Better transcription accuracy
- ⏸️ **Pause between sentences** - Helps Whisper segment speech
- 📝 **Review transcripts** - Verify what the AI heard
- 🔊 **Use headphones** - Prevent audio feedback loops
- 🧹 **Clear chat regularly** - Keeps context focused

### For Developers
- ⚡ **Handle errors gracefully** - Show user-friendly messages
- 🔒 **Validate audio input** - Check file size and format
- 📊 **Monitor latency** - Track each pipeline stage
- 🎨 **Provide feedback** - Show loading states clearly
- 🔧 **Make it configurable** - Let users adjust settings

---

## 🚀 Next Steps

### Enhancements You Can Add

1. **Streaming LLM responses** - Use `/v1/generate_stream` for token-by-token display
2. **Interrupt feature** - Allow users to stop AI mid-response
3. **Multiple languages** - Auto-detect and switch languages
4. **Conversation export** - Save chat history to file
5. **Voice commands** - "Stop", "Repeat", "Clear chat" via voice
6. **Emotion detection** - Analyze tone and adjust responses
7. **Background noise reduction** - Pre-process audio before STT
8. **WebSocket mode** - Real-time bidirectional communication
9. **Multi-speaker support** - Identify and track multiple voices
10. **Analytics dashboard** - Track usage, latency, accuracy

---

## 📚 Code Examples

### Customize System Prompt Dynamically

```typescript
const [systemPrompt, setSystemPrompt] = useState(
  "You are a helpful assistant."
);

// Change based on user selection
const setMedicalMode = () => {
  setSystemPrompt("You are a medical AI assistant.");
};

const setTutorMode = () => {
  setSystemPrompt("You are a patient language tutor.");
};
```

### Add Conversation Memory Limit

```typescript
const MAX_HISTORY = 10; // Keep last 10 messages

const conversationHistory = messages
  .slice(-MAX_HISTORY) // Last 10 messages only
  .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
  .join("\n");
```

### Custom Audio Format

```typescript
// Record in specific format (if supported)
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: 'audio/webm;codecs=opus'
});
```

### Export Conversation

```typescript
const exportChat = () => {
  const text = messages
    .map(m => `[${m.timestamp.toLocaleString()}] ${m.role}: ${m.text}`)
    .join('\n\n');
  
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'conversation.txt';
  a.click();
};
```

---

## 🎬 Demo Scenarios

### Scenario 1: Quick Test
1. Open Live Conversation tab
2. Click "Start Recording"
3. Say: "Hello, can you hear me?"
4. Click "Stop Recording"
5. Wait for AI response
6. Verify transcript and audio playback

### Scenario 2: Medical Consultation (Demo)
```
System Prompt: "You are a medical AI assistant."

User: "I have a headache and feel dizzy."
AI: "I understand. How long have you been experiencing these symptoms?"
User: "About two days now."
AI: "Have you noticed any triggers, like stress or lack of sleep?"
```

### Scenario 3: Language Practice
```
System Prompt: "You are a Spanish tutor. Respond in Spanish."
Voice Cloning: Upload native Spanish speaker audio

User: "Hola, ¿cómo estás?"
AI: "¡Hola! Estoy bien, gracias. ¿Y tú?"
```

---

## 📝 Additional Resources

- **Backend API Docs**: See `backend/README.md` for API details
- **Voice Cloning Guide**: See `backend/TTS_VOICE_CLONING_README.md`
- **Frontend API Integration**: See `frontend/API_INTEGRATION.md`
- **Component Source**: `frontend/src/components/ConversationPanel.tsx`

---

## 🎉 Ready to Chat!

Open the frontend at `http://localhost:5174`, click **"🎙️ Live Conversation"**, and start talking to your AI assistant!

**Enjoy your conversational AI experience!** 🚀
