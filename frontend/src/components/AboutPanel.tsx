import { useState } from "react";
import {
  MessageSquare,
  Mic,
  Volume2,
  Radio,
  Brain,
  Cpu,
  Waves,
  Zap,
  Shield,
  Globe,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Github,
  BookOpen,
  Users,
  Sparkles,
  AudioLines,
  Languages,
  Clock,
  Server,
} from "lucide-react";

// Feature card component
function FeatureCard({
  icon: Icon,
  title,
  description,
  details,
  techStack,
  imageSrc,
  imageAlt,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  details: string[];
  techStack: string[];
  imageSrc?: string;
  imageAlt?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden transition-all duration-300 hover:border-emerald-500/30">
      {imageSrc && (
        <div className="relative h-48 overflow-hidden bg-gradient-to-br from-slate-800 to-slate-900">
          <img
            src={imageSrc}
            alt={imageAlt || title}
            className="w-full h-full object-cover opacity-80"
            onError={(e) => {
              // Fallback gradient if image fails to load
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent" />
          <div className="absolute bottom-4 left-4 flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/20 backdrop-blur-sm">
              <Icon className="h-6 w-6 text-emerald-400" />
            </div>
            <h3 className="text-lg font-bold text-white">{title}</h3>
          </div>
        </div>
      )}
      
      <div className="p-5">
        {!imageSrc && (
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Icon className="h-5 w-5 text-emerald-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
          </div>
        )}
        
        <p className="text-slate-400 text-sm leading-relaxed mb-4">{description}</p>
        
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-emerald-400 text-sm font-medium hover:text-emerald-300 transition-colors"
        >
          {isExpanded ? "Show less" : "Learn more"}
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        
        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-slate-800 space-y-4 animate-in slide-in-from-top-2 duration-200">
            <div>
              <h4 className="text-sm font-medium text-slate-300 mb-2">How it works:</h4>
              <ul className="space-y-2">
                {details.map((detail, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-slate-400">
                    <span className="text-emerald-400 mt-1">•</span>
                    {detail}
                  </li>
                ))}
              </ul>
            </div>
            
            <div>
              <h4 className="text-sm font-medium text-slate-300 mb-2">Technology:</h4>
              <div className="flex flex-wrap gap-2">
                {techStack.map((tech, index) => (
                  <span
                    key={index}
                    className="px-2 py-1 text-xs rounded-full bg-slate-800 text-slate-300 border border-slate-700"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Architecture diagram component
function ArchitectureDiagram() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 overflow-hidden">
      <h3 className="text-lg font-semibold text-slate-100 mb-6 flex items-center gap-2">
        <Server className="h-5 w-5 text-emerald-400" />
        System Architecture
      </h3>
      
      <div className="relative">
        {/* Architecture visualization */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Frontend */}
          <div className="p-4 rounded-lg bg-gradient-to-br from-cyan-500/10 to-cyan-500/5 border border-cyan-500/20">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="h-5 w-5 text-cyan-400" />
              <span className="font-medium text-cyan-300">Frontend</span>
            </div>
            <ul className="text-sm text-slate-400 space-y-1">
              <li>• React + TypeScript</li>
              <li>• Tailwind CSS</li>
              <li>• Web Audio API</li>
              <li>• WebSocket Client</li>
            </ul>
          </div>
          
          {/* Backend */}
          <div className="p-4 rounded-lg bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/20">
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="h-5 w-5 text-emerald-400" />
              <span className="font-medium text-emerald-300">Backend API</span>
            </div>
            <ul className="text-sm text-slate-400 space-y-1">
              <li>• FastAPI (Python)</li>
              <li>• Async/Await</li>
              <li>• SSE Streaming</li>
              <li>• WebSocket Support</li>
            </ul>
          </div>
          
          {/* AI Services */}
          <div className="p-4 rounded-lg bg-gradient-to-br from-purple-500/10 to-purple-500/5 border border-purple-500/20">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="h-5 w-5 text-purple-400" />
              <span className="font-medium text-purple-300">AI Models</span>
            </div>
            <ul className="text-sm text-slate-400 space-y-1">
              <li>• Gemma 3 (4B)</li>
              <li>• Faster Whisper</li>
              <li>• OpenAudio S1-Mini</li>
              <li>• GPU Acceleration</li>
            </ul>
          </div>
        </div>
        
        {/* Connection arrows */}
        <div className="hidden md:flex justify-center items-center py-4 text-slate-600">
          <div className="flex items-center gap-2">
            <div className="h-px w-16 bg-gradient-to-r from-cyan-500/50 to-emerald-500/50" />
            <Zap className="h-4 w-4 text-emerald-400" />
            <div className="h-px w-16 bg-gradient-to-r from-emerald-500/50 to-purple-500/50" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Stats component
function StatsSection() {
  const stats = [
    { label: "Response Time", value: "<500ms", icon: Clock },
    { label: "Languages", value: "99+", icon: Languages },
    { label: "Audio Formats", value: "5+", icon: AudioLines },
    { label: "API Endpoints", value: "12+", icon: Server },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat, index) => (
        <div
          key={index}
          className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 text-center"
        >
          <stat.icon className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
          <div className="text-2xl font-bold text-slate-100">{stat.value}</div>
          <div className="text-xs text-slate-400">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}

export function AboutPanel() {
  const features = [
    {
      icon: MessageSquare,
      title: "Text Generation (LLM)",
      description:
        "Generate human-like text responses using the Gemma 3 large language model. Perfect for conversations, content creation, and AI assistance.",
      details: [
        "Uses Google's Gemma 3 4B parameter model optimized for instruction following",
        "Supports streaming responses for real-time token generation",
        "Configurable parameters: temperature, top_p, top_k, repeat penalty",
        "Automatic chat template formatting for optimal results",
        "Context window of 8192 tokens for extended conversations",
        "Quantized to 4-bit for efficient GPU memory usage",
      ],
      techStack: ["Gemma 3 4B", "llama.cpp", "GGUF Format", "CUDA", "4-bit Quantization"],
      imageSrc: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&q=80",
      imageAlt: "AI Language Model Neural Network",
    },
    {
      icon: Mic,
      title: "Speech-to-Text (STT)",
      description:
        "Convert spoken audio into accurate text transcriptions. Supports multiple languages, file uploads, and real-time microphone input.",
      details: [
        "Powered by OpenAI's Whisper model via Faster Whisper implementation",
        "Supports 99+ languages with automatic language detection",
        "Real-time transcription via WebSocket for live audio streams",
        "File upload supports WAV, MP3, WEBM, and other common formats",
        "Returns timestamped segments for precise audio-text alignment",
        "Configurable temperature for transcription accuracy vs. creativity",
      ],
      techStack: ["Faster Whisper", "CTranslate2", "WebSocket", "FFmpeg", "CUDA"],
      imageSrc: "https://images.unsplash.com/photo-1589903308904-1010c2294adc?w=800&q=80",
      imageAlt: "Voice Recording Microphone",
    },
    {
      icon: Volume2,
      title: "Text-to-Speech (TTS)",
      description:
        "Transform text into natural-sounding speech with customizable voices. Supports voice cloning, streaming playback, and multiple audio formats.",
      details: [
        "Uses OpenAudio S1-Mini model for high-quality neural speech synthesis",
        "Real-time streaming: audio plays as it's generated, no waiting",
        "Voice cloning: upload reference audio to synthesize in any voice",
        "Multiple output formats: WAV, MP3, OGG, FLAC, PCM",
        "Adjustable parameters: speed, volume, sample rate (up to 48kHz)",
        "Top-p sampling for natural speech variation",
      ],
      techStack: ["OpenAudio S1-Mini", "Neural TTS", "SSE Streaming", "Web Audio API", "Base64 Encoding"],
      imageSrc: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80",
      imageAlt: "Audio Waveform Visualization",
    },
    {
      icon: Radio,
      title: "Voice Chat (Full Pipeline)",
      description:
        "Have natural voice conversations with AI. Combines STT, LLM, and TTS into a seamless real-time dialogue experience.",
      details: [
        "End-to-end voice pipeline: Speak → Transcribe → Generate → Synthesize → Play",
        "WebSocket-based for low-latency real-time communication",
        "Supports both live microphone input and file-based conversations",
        "Streaming audio response for immediate feedback",
        "Customizable system prompts to shape AI personality",
        "Conversation history maintained across turns",
      ],
      techStack: ["WebSocket", "Full Duplex", "Pipeline Architecture", "Real-time Audio", "State Management"],
      imageSrc: "https://images.unsplash.com/photo-1512314889357-e157c22f938d?w=800&q=80",
      imageAlt: "Voice Assistant Communication",
    },
  ];

  const additionalFeatures = [
    {
      icon: Sparkles,
      title: "Voice Cloning",
      description: "Clone any voice with just 1-5 audio samples. The AI learns the voice characteristics and can synthesize new speech in that voice.",
      details: [
        "Upload 3-10 second audio clips as voice references",
        "Supports multiple reference samples for better quality",
        "Works with any language or accent",
        "Real-time processing, no training required",
      ],
      techStack: ["Zero-shot Cloning", "Speaker Embedding", "Neural Vocoder"],
    },
    {
      icon: Waves,
      title: "Streaming Audio",
      description: "Experience real-time audio playback. Audio chunks are played immediately as they're generated, eliminating wait times.",
      details: [
        "Server-Sent Events (SSE) for efficient streaming",
        "Gapless audio playback using Web Audio API",
        "Chunks are buffered and scheduled for seamless transitions",
        "Works with all supported audio formats",
      ],
      techStack: ["SSE", "AudioContext", "Buffer Scheduling", "PCM Processing"],
    },
    {
      icon: Shield,
      title: "API Security",
      description: "Secure API access with key-based authentication and rate limiting to prevent abuse.",
      details: [
        "API key authentication for all endpoints",
        "Configurable rate limiting per client",
        "Request ID tracking for debugging",
        "WebSocket authentication support",
      ],
      techStack: ["API Keys", "Rate Limiting", "CORS", "Request Tracking"],
    },
    {
      icon: Zap,
      title: "GPU Acceleration",
      description: "Leverage NVIDIA GPUs for blazing-fast inference across all AI models.",
      details: [
        "CUDA-optimized model inference",
        "Efficient memory management with quantization",
        "Parallel processing for concurrent requests",
        "Automatic device selection and fallback",
      ],
      techStack: ["CUDA 12.4", "cuDNN", "TensorRT", "Mixed Precision"],
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500/10 via-slate-900 to-cyan-500/10 border border-slate-800 p-8">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1639322537228-f710d846310a?w=1200&q=80')] opacity-5 bg-cover bg-center" />
        <div className="relative z-10">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500">
              <AudioLines className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                Gemma Voice
              </h1>
              <p className="text-slate-400 text-sm">Speech AI Platform</p>
            </div>
          </div>
          
          <p className="text-lg text-slate-300 max-w-2xl mb-6">
            A production-ready speech AI platform that combines text generation, speech recognition, 
            and speech synthesis into a unified, real-time voice interaction system.
          </p>
          
          <div className="flex flex-wrap gap-3">
            <a
              href="https://github.com/gigahidjrikaaa/GemmaVoice-SpeechAPI"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors"
            >
              <Github className="h-4 w-4" />
              View on GitHub
              <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href="/docs/scalar/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-sm font-medium transition-colors border border-emerald-500/30"
            >
              <BookOpen className="h-4 w-4" />
              API Documentation
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Stats */}
      <StatsSection />

      {/* Core Features */}
      <div>
        <h2 className="text-xl font-semibold text-slate-100 mb-4 flex items-center gap-2">
          <Brain className="h-5 w-5 text-emerald-400" />
          Core Features
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {features.map((feature, index) => (
            <FeatureCard key={index} {...feature} />
          ))}
        </div>
      </div>

      {/* Architecture */}
      <ArchitectureDiagram />

      {/* Additional Features */}
      <div>
        <h2 className="text-xl font-semibold text-slate-100 mb-4 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-emerald-400" />
          Advanced Capabilities
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {additionalFeatures.map((feature, index) => (
            <FeatureCard key={index} {...feature} />
          ))}
        </div>
      </div>

      {/* How It All Works Together */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-xl font-semibold text-slate-100 mb-4 flex items-center gap-2">
          <Cpu className="h-5 w-5 text-emerald-400" />
          How It All Works Together
        </h2>
        
        <div className="space-y-6">
          {/* Pipeline Visualization */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 bg-slate-800/50 rounded-lg">
            <div className="flex flex-col items-center text-center p-3">
              <div className="p-3 rounded-full bg-cyan-500/10 mb-2">
                <Mic className="h-6 w-6 text-cyan-400" />
              </div>
              <span className="text-sm font-medium text-slate-200">Voice Input</span>
              <span className="text-xs text-slate-500">Microphone / File</span>
            </div>
            
            <div className="hidden md:block h-px w-12 bg-gradient-to-r from-cyan-500/50 to-emerald-500/50" />
            <div className="md:hidden w-px h-8 bg-gradient-to-b from-cyan-500/50 to-emerald-500/50" />
            
            <div className="flex flex-col items-center text-center p-3">
              <div className="p-3 rounded-full bg-blue-500/10 mb-2">
                <Waves className="h-6 w-6 text-blue-400" />
              </div>
              <span className="text-sm font-medium text-slate-200">Whisper STT</span>
              <span className="text-xs text-slate-500">Audio → Text</span>
            </div>
            
            <div className="hidden md:block h-px w-12 bg-gradient-to-r from-blue-500/50 to-purple-500/50" />
            <div className="md:hidden w-px h-8 bg-gradient-to-b from-blue-500/50 to-purple-500/50" />
            
            <div className="flex flex-col items-center text-center p-3">
              <div className="p-3 rounded-full bg-purple-500/10 mb-2">
                <Brain className="h-6 w-6 text-purple-400" />
              </div>
              <span className="text-sm font-medium text-slate-200">Gemma 3 LLM</span>
              <span className="text-xs text-slate-500">Text → Response</span>
            </div>
            
            <div className="hidden md:block h-px w-12 bg-gradient-to-r from-purple-500/50 to-emerald-500/50" />
            <div className="md:hidden w-px h-8 bg-gradient-to-b from-purple-500/50 to-emerald-500/50" />
            
            <div className="flex flex-col items-center text-center p-3">
              <div className="p-3 rounded-full bg-emerald-500/10 mb-2">
                <Volume2 className="h-6 w-6 text-emerald-400" />
              </div>
              <span className="text-sm font-medium text-slate-200">OpenAudio TTS</span>
              <span className="text-xs text-slate-500">Text → Speech</span>
            </div>
            
            <div className="hidden md:block h-px w-12 bg-gradient-to-r from-emerald-500/50 to-orange-500/50" />
            <div className="md:hidden w-px h-8 bg-gradient-to-b from-emerald-500/50 to-orange-500/50" />
            
            <div className="flex flex-col items-center text-center p-3">
              <div className="p-3 rounded-full bg-orange-500/10 mb-2">
                <AudioLines className="h-6 w-6 text-orange-400" />
              </div>
              <span className="text-sm font-medium text-slate-200">Audio Output</span>
              <span className="text-xs text-slate-500">Real-time Playback</span>
            </div>
          </div>
          
          {/* Detailed explanation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-400">
            <div className="p-4 bg-slate-800/30 rounded-lg">
              <h4 className="font-medium text-slate-200 mb-2">🎤 Voice Input Processing</h4>
              <p>Audio is captured from your microphone using the Web Audio API or uploaded as a file. 
                 The audio is encoded and sent to the backend via WebSocket (real-time) or HTTP (file upload).</p>
            </div>
            <div className="p-4 bg-slate-800/30 rounded-lg">
              <h4 className="font-medium text-slate-200 mb-2">📝 Speech Recognition</h4>
              <p>Faster Whisper processes the audio using CTranslate2 optimizations, producing accurate 
                 transcriptions with timestamps. Supports 99+ languages with auto-detection.</p>
            </div>
            <div className="p-4 bg-slate-800/30 rounded-lg">
              <h4 className="font-medium text-slate-200 mb-2">🧠 Language Understanding</h4>
              <p>Gemma 3 processes the transcribed text using instruction-tuned capabilities. 
                 Streaming generation provides tokens in real-time for responsive interactions.</p>
            </div>
            <div className="p-4 bg-slate-800/30 rounded-lg">
              <h4 className="font-medium text-slate-200 mb-2">🔊 Speech Synthesis</h4>
              <p>OpenAudio S1-Mini converts the response to natural speech. Audio chunks stream 
                 directly to your browser and play immediately using the Web Audio API.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Credits & Team */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-xl font-semibold text-slate-100 mb-4 flex items-center gap-2">
          <Users className="h-5 w-5 text-emerald-400" />
          Built With
        </h2>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { name: "Google Gemma", desc: "LLM Foundation", url: "https://ai.google.dev/gemma" },
            { name: "OpenAI Whisper", desc: "Speech Recognition", url: "https://openai.com/research/whisper" },
            { name: "Fish Audio", desc: "OpenAudio TTS", url: "https://fish.audio" },
            { name: "FastAPI", desc: "Backend Framework", url: "https://fastapi.tiangolo.com" },
          ].map((item, index) => (
            <a
              key={index}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-emerald-500/30 transition-colors group"
            >
              <div className="font-medium text-slate-200 group-hover:text-emerald-400 transition-colors">
                {item.name}
              </div>
              <div className="text-xs text-slate-500">{item.desc}</div>
            </a>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-sm text-slate-500 py-4">
        <p>Gemma Voice © 2025 • Open Source Speech AI Platform</p>
        <p className="text-xs mt-1">
          Made with ❤️ for the AI community
        </p>
      </div>
    </div>
  );
}
