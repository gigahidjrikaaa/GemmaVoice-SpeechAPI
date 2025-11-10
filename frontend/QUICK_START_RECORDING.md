# Quick Start Guide: New Recording Features

## 🎙️ How to Use Manual Recording

### Step-by-Step:

1. **Navigate to Transcription Tab**
   - Click on the "Transcription" tab in the main navigation

2. **Select Recording Mode**
   ```
   [ ] Live Streaming Mode
   ```
   - Leave **unchecked** for manual recording
   - Check for live streaming (real-time transcription)

3. **Start Recording**
   ```
   [🎙️ Start Recording]
   ```
   - Click the green button
   - Browser will ask for microphone permission (first time)
   - Button changes to red "⏹️ Stop Recording"

4. **Speak Your Message**
   - Speak clearly into your microphone
   - Status shows: "💾 Manual mode: Recording will be transcribed when you stop"

5. **Stop Recording**
   ```
   [⏹️ Stop Recording]
   ```
   - Click the red button
   - Audio is automatically uploaded to STT API
   - Transcription appears in results section

---

## 📡 How to Use Live Streaming

### Step-by-Step:

1. **Navigate to Transcription Tab**

2. **Enable Live Streaming**
   ```
   [✓] Live Streaming Mode ℹ️
   ```
   - **Check** the checkbox
   - Tooltip explains: "Real-time transcription as you speak"

3. **Start Recording**
   ```
   [🎙️ Start Recording]
   ```
   - Click the green button
   - Status shows: "📡 Live mode: Transcription happens in real-time as you speak"

4. **Speak and Watch Real-Time Transcription**
   ```
   ┌─────────────────────────────────────┐
   │ 📝 Live Transcript                 │
   │                                     │
   │ This is what you're saying right    │
   │ now appearing in real time...       │
   └─────────────────────────────────────┘
   ```
   - Text appears as you speak
   - Updates every ~3 seconds
   - Keeps accumulating

5. **Stop When Done**
   ```
   [⏹️ Stop Recording]
   ```
   - Click to finish
   - Final transcript displayed

---

## ℹ️ Understanding Parameter Tooltips

### How to View Explanations:

All panels now have **ℹ️ icons** next to each parameter:

```
Temperature ℹ️
```

**Hover over the icon** to see:
- What the parameter does
- Recommended values
- Impact on output

### Example Tooltips:

**Temperature (Generation):**
> "Controls randomness (0-2). Lower values (0.1-0.5) make output focused and deterministic. Higher values (0.8-1.5) make output more creative and varied."

**Top P (Synthesis):**
> "Voice variability (0-1). Lower (0.7-0.85) = consistent voice, higher = more variation."

**Model (Transcription):**
> "The Whisper model to use for transcription. Larger models are more accurate but slower."

---

## 🎯 Common Use Cases

### Use Case 1: Quick Voice Note Transcription
```
1. Open Transcription tab
2. Manual mode (unchecked)
3. Start Recording
4. Speak your note
5. Stop Recording
6. Get text transcription
```

### Use Case 2: Live Meeting Transcription
```
1. Open Transcription tab
2. Enable Live Streaming mode (checked)
3. Start Recording
4. Watch real-time transcription
5. Stop when meeting ends
6. Full transcript available
```

### Use Case 3: Test Different Settings
```
1. Hover over ℹ️ icons to understand parameters
2. Adjust Temperature (0 for accuracy, 0.5 for variety)
3. Try different Response Formats
4. See how output changes
```

---

## 🔧 Troubleshooting

### No Microphone Access
**Problem:** Browser blocks microphone
**Solution:**
1. Check browser permissions
2. Look for microphone icon in address bar
3. Click and enable microphone
4. Refresh page and try again

### WebSocket Connection Failed
**Problem:** Live streaming not connecting
**Solution:**
1. Check backend is running
2. Verify WebSocket endpoint: `ws://localhost:21250/v1/speech-to-text/ws`
3. Check browser console for errors
4. Try manual mode instead

### Poor Transcription Quality
**Problem:** Text is inaccurate
**Solution:**
1. Use manual mode (better quality)
2. Set Temperature to 0
3. Speak clearly and slowly
4. Use verbose_json format for more detail
5. Specify language if known

### Recording Not Starting
**Problem:** Button doesn't respond
**Solution:**
1. Check browser compatibility
2. Try different browser (Chrome recommended)
3. Check microphone is connected
4. Look for JavaScript errors in console

---

## 💡 Pro Tips

### For Best Recording Quality:
- ✅ Use a good quality microphone
- ✅ Record in a quiet environment
- ✅ Speak at normal pace (not too fast)
- ✅ Keep microphone ~6 inches from mouth
- ✅ Use manual mode for important transcriptions

### For Best Live Streaming:
- ✅ Use stable internet connection
- ✅ Speak in clear sentences
- ✅ Pause briefly between thoughts
- ✅ Watch the live transcript to verify accuracy
- ✅ Use for continuous speech (lectures, meetings)

### Understanding Parameters:
- 📖 Always read tooltip before changing values
- 🎯 Start with defaults, then adjust
- 🧪 Test different settings to see impact
- 📝 Note what works best for your use case

---

## 🎨 Visual Guide

### Before (Old UI):
```
┌─────────────────────────────┐
│ Audio file                  │
│ [Choose File]               │
│                              │
│ Model                        │
│ [whisper-large-v3]          │
│                              │
│ [Transcribe]                │
└─────────────────────────────┘
```

### After (New UI):
```
┌─────────────────────────────────────┐
│ 🎤 Record Audio                    │
│                                     │
│ [ ] Live Streaming Mode ℹ️         │
│                                     │
│ [🎙️ Start Recording]               │
│                                     │
│ 💾 Manual mode: Recording will be  │
│    transcribed when you stop       │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 📝 Live Transcript                 │
│ (appears when using live mode)     │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 📁 Upload Audio File               │
│                                     │
│ Audio file                          │
│ [Choose File]                       │
│                                     │
│ Model ℹ️                            │
│ [whisper-large-v3]                 │
│                                     │
│ Response format ℹ️                  │
│ [verbose_json ▼]                   │
│                                     │
│ [📤 Transcribe File]               │
└─────────────────────────────────────┘
```

---

## 📊 Feature Comparison

| Feature | Manual Recording | Live Streaming | File Upload |
|---------|-----------------|----------------|-------------|
| **Real-time** | ❌ No | ✅ Yes | ❌ No |
| **Accuracy** | ✅ High | ⚠️ Good | ✅ High |
| **Speed** | ⚠️ After stop | ✅ Instant | ⚠️ After upload |
| **Use Case** | Voice notes | Meetings | Pre-recorded |
| **File Size** | Medium | Small chunks | Any size |
| **Internet** | After recording | During recording | After upload |

---

## ✅ Quick Checklist

Before using recording features:

- [ ] Backend is running (`http://localhost:21250`)
- [ ] Microphone is connected and working
- [ ] Browser has microphone permission
- [ ] WebSocket endpoint available (for live mode)
- [ ] Sufficient storage for recording
- [ ] Quiet environment for best results

---

## 🎓 Learning Path

### Beginner:
1. ✅ Start with manual recording
2. ✅ Upload a test file
3. ✅ Hover over tooltips to learn parameters
4. ✅ Try different response formats

### Intermediate:
1. ✅ Use live streaming mode
2. ✅ Adjust temperature settings
3. ✅ Specify language for better accuracy
4. ✅ Compare manual vs live quality

### Advanced:
1. ✅ Integrate with other features
2. ✅ Use prompt field for context
3. ✅ Handle errors gracefully
4. ✅ Optimize for your specific use case

---

## 📞 Need Help?

**Check These First:**
1. Backend logs for errors
2. Browser console for JavaScript errors
3. Network tab for failed requests
4. This guide for troubleshooting steps

**Common Questions:**

**Q: Can I use Bluetooth microphone?**
A: Yes, any microphone recognized by your browser works.

**Q: Is there a recording time limit?**
A: No hard limit, but longer recordings take more time to process.

**Q: Can I pause and resume?**
A: Not yet - this is a future enhancement.

**Q: Does it work on mobile?**
A: Should work on modern mobile browsers, but test first.

**Q: Can I save the recording?**
A: Currently only transcription is saved, not audio file.

---

Enjoy the new recording features! 🎉
