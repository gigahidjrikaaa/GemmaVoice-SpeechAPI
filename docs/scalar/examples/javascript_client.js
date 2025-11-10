/**
 * GemmaVoice API JavaScript Examples
 * 
 * Complete integration examples for the GemmaVoice Speech API.
 * Works in Node.js and modern browsers.
 */

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';
const API_KEY = process.env.API_KEY || 'your-api-key-here';

const getHeaders = () => ({
  'X-API-Key': API_KEY,
  'Content-Type': 'application/json'
});

// =============================================================================
// TEXT GENERATION
// =============================================================================

/**
 * Generate text using Gemma 3 LLM
 * @param {string} prompt - Input prompt for generation
 * @param {number} maxTokens - Maximum tokens to generate
 * @param {number} temperature - Sampling temperature (0.0-2.0)
 * @returns {Promise<string>} Generated text
 */
async function generateText(prompt, maxTokens = 512, temperature = 0.7) {
  const response = await fetch(`${API_BASE_URL}/v1/generate`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      prompt,
      max_tokens: maxTokens,
      temperature
    })
  });
  
  if (!response.ok) {
    throw new Error(`Generation failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.generated_text;
}

// =============================================================================
// SPEECH-TO-TEXT
// =============================================================================

/**
 * Transcribe audio file using Whisper
 * @param {File|Blob} audioFile - Audio file to transcribe
 * @param {string} language - Optional language code (e.g., 'en', 'es')
 * @returns {Promise<Object>} Transcription result with text and segments
 */
async function transcribeAudio(audioFile, language = null) {
  const formData = new FormData();
  formData.append('file', audioFile);
  
  if (language) {
    formData.append('language', language);
  }
  
  const response = await fetch(`${API_BASE_URL}/v1/speech-to-text`, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY
    },
    body: formData
  });
  
  if (!response.ok) {
    throw new Error(`Transcription failed: ${response.statusText}`);
  }
  
  return await response.json();
}

// =============================================================================
// TEXT-TO-SPEECH
// =============================================================================

/**
 * Synthesize speech from text using OpenAudio
 * @param {string} text - Text to synthesize
 * @param {string} format - Audio format (wav, mp3, ogg, flac)
 * @param {number} sampleRate - Sample rate in Hz
 * @returns {Promise<Blob>} Audio blob
 */
async function synthesizeSpeech(text, format = 'wav', sampleRate = 22050) {
  const response = await fetch(`${API_BASE_URL}/v1/text-to-speech`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      text,
      format,
      sample_rate: sampleRate
    })
  });
  
  if (!response.ok) {
    throw new Error(`Synthesis failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // Decode base64 to binary
  const binaryString = atob(data.audio_base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return new Blob([bytes], { type: `audio/${format}` });
}

/**
 * Play audio blob in browser
 * @param {Blob} audioBlob - Audio blob to play
 */
function playAudio(audioBlob) {
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(audioUrl);
  
  audio.onended = () => {
    URL.revokeObjectURL(audioUrl);
  };
  
  audio.play();
}

// =============================================================================
// VOICE CLONING
// =============================================================================

/**
 * Convert File/Blob to base64 string
 * @param {File|Blob} file - File to convert
 * @returns {Promise<string>} Base64 encoded string
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Synthesize speech with voice cloning
 * @param {string} text - Text to synthesize
 * @param {Array<File|Blob>} referenceAudios - Reference audio files (3-10 sec each)
 * @param {string} format - Audio format (wav, mp3, ogg, flac)
 * @returns {Promise<Blob>} Voice-cloned audio blob
 */
async function synthesizeWithVoiceCloning(text, referenceAudios, format = 'wav') {
  // Convert reference audios to base64
  const references = await Promise.all(
    referenceAudios.map(audio => fileToBase64(audio))
  );
  
  const response = await fetch(`${API_BASE_URL}/v1/text-to-speech`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      text,
      format,
      references
    })
  });
  
  if (!response.ok) {
    throw new Error(`Voice cloning failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // Decode base64 to binary
  const binaryString = atob(data.audio_base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return new Blob([bytes], { type: `audio/${format}` });
}

// =============================================================================
// END-TO-END DIALOGUE
// =============================================================================

/**
 * Run complete voice-to-voice dialogue pipeline
 * @param {File|Blob} audioFile - User audio file
 * @param {string} instructions - System instructions for the AI
 * @param {Object} generationConfig - LLM generation parameters
 * @param {Object} synthesisConfig - TTS synthesis parameters
 * @returns {Promise<Object>} Complete dialogue result
 */
async function runDialogue(
  audioFile,
  instructions = 'You are a helpful assistant',
  generationConfig = { temperature: 0.7, max_tokens: 256 },
  synthesisConfig = { format: 'wav' }
) {
  const formData = new FormData();
  formData.append('file', audioFile);
  formData.append('instructions', instructions);
  formData.append('generation_config', JSON.stringify(generationConfig));
  formData.append('synthesis_config', JSON.stringify(synthesisConfig));
  
  const response = await fetch(`${API_BASE_URL}/v1/dialogue`, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY
    },
    body: formData
  });
  
  if (!response.ok) {
    throw new Error(`Dialogue failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // Decode assistant audio
  const binaryString = atob(data.audio_base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const audioBlob = new Blob([bytes], { type: `audio/${synthesisConfig.format || 'wav'}` });
  
  return {
    userTranscript: data.transcript.text,
    assistantText: data.response_text,
    assistantAudio: audioBlob
  };
}

// =============================================================================
// EXAMPLE USAGE
// =============================================================================

async function runExamples() {
  console.log('🚀 GemmaVoice API Examples\n');
  
  try {
    // Example 1: Text Generation
    console.log('1️⃣ Text Generation');
    const text = await generateText('Write a haiku about AI', 50, 0.7);
    console.log(`Generated: ${text}\n`);
    
    // Example 2: Speech-to-Text (browser only with file input)
    console.log('2️⃣ Speech-to-Text');
    // const fileInput = document.getElementById('audioInput');
    // const transcript = await transcribeAudio(fileInput.files[0], 'en');
    // console.log(`Transcript: ${transcript.text}\n`);
    
    // Example 3: Text-to-Speech
    console.log('3️⃣ Text-to-Speech');
    // const audioBlob = await synthesizeSpeech('Hello from GemmaVoice!', 'wav');
    // playAudio(audioBlob);
    
    // Example 4: Voice Cloning (browser only with file inputs)
    console.log('4️⃣ Voice Cloning');
    // const refInput = document.getElementById('referenceInput');
    // const clonedBlob = await synthesizeWithVoiceCloning(
    //   'This will sound like the reference voice',
    //   Array.from(refInput.files),
    //   'wav'
    // );
    // playAudio(clonedBlob);
    
    // Example 5: Complete Dialogue (browser only with file input)
    console.log('5️⃣ End-to-End Dialogue');
    // const userInput = document.getElementById('userAudio');
    // const result = await runDialogue(
    //   userInput.files[0],
    //   'You are a friendly assistant'
    // );
    // console.log(`🎙️ User: ${result.userTranscript}`);
    // console.log(`🤖 AI: ${result.assistantText}`);
    // playAudio(result.assistantAudio);
    
    console.log('✅ All examples completed!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateText,
    transcribeAudio,
    synthesizeSpeech,
    synthesizeWithVoiceCloning,
    runDialogue,
    playAudio,
    fileToBase64
  };
}

// Run examples if executed directly
if (typeof window === 'undefined') {
  runExamples();
}
