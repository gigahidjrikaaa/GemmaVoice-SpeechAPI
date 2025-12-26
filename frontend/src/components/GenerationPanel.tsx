import { FormEvent, useState, useEffect } from "react";
import { useClientConfig } from "../context/ConfigContext";
import { useModelsContext } from "../context/ModelsContext";
import { useCode } from "../context/CodeContext";
import { apiFetch, apiFetchStream } from "../lib/api";
import { useToast } from "./Toast";
import { InstructionsPanel } from "./InstructionsPanel";
import { FAQSection, type FAQItem } from "./FAQSection";
import { ExamplePrompts, type ExamplePrompt } from "./ExamplePrompts";
import { errorLogger } from "../lib/error";
import { 
  Sparkles, 
  Zap, 
  Radio, 
  MessageSquare, 
  Settings2, 
  ChevronDown, 
  ChevronUp, 
  BookOpen,
  Bot,
  Terminal
} from "lucide-react";

type GenerationResponse = {
  generated_text: string;
};

type StreamEvent = {
  event: string;
  data: unknown;
};

const defaultRequest = {
  prompt: "Hello!",
  system_prompt: "",
  max_tokens: 256,
  temperature: 0.7,
  top_p: 0.95,
  top_k: 40
};

// Parameter explanations
const PARAM_HELP = {
  prompt: "The input text to send to the language model. Can be a question, instruction, or conversation context.",
  systemPrompt: "Optional instructions that set the behavior, persona, or context for the model (e.g., 'You are a helpful coding assistant').",
  temperature: "Controls randomness (0-2). Lower values (0.1-0.5) make output focused and deterministic. Higher values (0.8-1.5) make output more creative and varied.",
  top_p: "Nucleus sampling (0-1). Considers tokens with cumulative probability up to this value. Lower values (0.7-0.9) make output more focused. 1.0 considers all tokens.",
  top_k: "Limits selection to top K tokens (0-100). Smaller values (10-40) make output more predictable. Higher values allow more diversity.",
  max_tokens: "Maximum number of tokens to generate (1-4096). One token ≈ 4 characters for English text."
};

// Example prompts for quick testing
const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    title: "Creative Writing",
    description: "Generate a short story or creative content",
    prompt: "Write a short story about a robot who discovers emotions for the first time. Keep it under 200 words.",
    systemPrompt: "You are a creative writer with a talent for emotional storytelling.",
    category: "Creative"
  },
  {
    title: "Code Explanation",
    description: "Explain programming concepts",
    prompt: "Explain what async/await does in JavaScript with a simple example.",
    systemPrompt: "You are a senior software engineer who explains concepts clearly.",
    category: "Technical"
  },
  {
    title: "Indonesian Translation",
    description: "Translate text to Indonesian",
    prompt: "Translate to Indonesian: 'The weather is beautiful today. Would you like to go for a walk in the park?'",
    systemPrompt: "You are a professional translator fluent in English and Indonesian.",
    category: "Language"
  },
  {
    title: "Q&A Assistant",
    description: "Answer general knowledge questions",
    prompt: "What are the main differences between machine learning and deep learning?",
    systemPrompt: "You are a knowledgeable AI assistant who gives accurate, concise answers.",
    category: "Technical"
  },
  {
    title: "Summarization",
    description: "Summarize long content",
    prompt: "Summarize the key benefits of renewable energy in 3 bullet points.",
    category: "General"
  }
];

// FAQ items for text generation
const FAQ_ITEMS: FAQItem[] = [
  {
    question: "What is the difference between Generate and Stream?",
    answer: "Generate waits for the complete response before displaying it. Stream shows tokens as they're generated in real-time, providing faster perceived response time and allowing you to see the model 'thinking'. Use Stream for longer responses or when you want immediate feedback.",
    category: "Basics"
  },
  {
    question: "How do I make responses more creative or more focused?",
    answer: (
      <div className="space-y-2">
        <p><strong>For creative/varied output:</strong> Increase temperature (0.8-1.2), top_p (0.95), and top_k (50+)</p>
        <p><strong>For focused/consistent output:</strong> Decrease temperature (0.1-0.4), top_p (0.7-0.85), and top_k (10-30)</p>
        <p>Tip: Start with temperature adjustments first as it has the most noticeable effect.</p>
      </div>
    ),
    category: "Parameters"
  },
  {
    question: "What's the best system prompt to use?",
    answer: "A good system prompt clearly defines the AI's role, tone, and constraints. Example: 'You are a helpful coding assistant. Provide concise answers with code examples when relevant. If you don't know something, say so.' Keep it specific to your use case.",
    category: "Basics"
  },
  {
    question: "Why is my response cut off or too short?",
    answer: "Increase the max_tokens parameter. The model stops generating when it reaches this limit. For longer responses, try 512-1024 tokens. Note: longer responses take more time and compute resources.",
    category: "Troubleshooting"
  },
  {
    question: "Can I use this for Indonesian language?",
    answer: "Yes! Gemma 3 supports Indonesian. You can write prompts in Indonesian or ask it to respond in Indonesian. For best results, include 'Respond in Indonesian' or 'Jawab dalam Bahasa Indonesia' in your prompt or system prompt.",
    category: "Language"
  },
  {
    question: "What does each parameter actually do?",
    answer: (
      <ul className="space-y-2 mt-2">
        <li><strong>Temperature:</strong> Randomness. Low = predictable, High = creative.</li>
        <li><strong>Top-P:</strong> Cumulative probability threshold for token selection.</li>
        <li><strong>Top-K:</strong> Number of top tokens to consider at each step.</li>
        <li><strong>Max Tokens:</strong> Maximum length of the generated response.</li>
      </ul>
    ),
    category: "Parameters"
  },
  {
    question: "Why am I getting 503 errors?",
    answer: "503 errors typically mean the LLM service is still loading or unavailable. On first startup, the model takes 1-3 minutes to load. Check Docker logs with 'docker logs gemma_service' to see loading progress. The API will return 503 until the model is ready.",
    category: "Troubleshooting"
  }
];

export function GenerationPanel() {
  const { config } = useClientConfig();
  const { selectedModel } = useModelsContext();
  const { setSnippet } = useCode();
  const { push } = useToast();
  const [request, setRequest] = useState(defaultRequest);
  const [result, setResult] = useState<GenerationResponse | null>(null);
  const [streamLog, setStreamLog] = useState<StreamEvent[]>([]);
  const [showGuide, setShowGuide] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Handle example prompt selection
  const handleExampleSelect = (example: ExamplePrompt) => {
    setRequest(prev => ({
      ...prev,
      prompt: example.prompt,
      system_prompt: example.systemPrompt || ""
    }));
    push({ title: `Example loaded: ${example.title}` });
  };

  // Update code snippet when request changes
  useEffect(() => {
    const curlCommand = `curl -X POST ${config.baseUrl}/v1/generate \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(request, null, 2)}'`;

    setSnippet({
      language: "bash",
      code: curlCommand,
      title: "Text Generation Request"
    });
  }, [request, config.baseUrl, setSnippet]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStreamLog([]);
    setIsGenerating(true);
    
    try {
      // Debug logging
      console.log('🔍 Sync Generation - Payload:', request);
      errorLogger.logInfo('Starting text generation', { payload: request });
      
      const { data } = await apiFetch<GenerationResponse>(config, "/v1/generate", {
        method: "POST",
        body: JSON.stringify(request)
      });
      
      errorLogger.logInfo('Generation successful', { outputLength: data.generated_text?.length });
      setResult(data);
      push({ title: "Generation complete" });
    } catch (error) {
      errorLogger.logError(error, '/v1/generate');
      const userMessage = errorLogger.getUserFriendlyMessage(error);
      push({
        title: "Generation failed",
        description: userMessage,
        variant: "error"
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStream = async () => {
    setStreamLog([]);
    setResult(null);
    setIsGenerating(true);

    const curlCommand = `curl -N -X POST ${config.baseUrl}/v1/generate_stream \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(request, null, 2)}'`;

    setSnippet({
      language: "bash",
      code: curlCommand,
      title: "Streaming Generation Request"
    });

    errorLogger.logInfo('Starting streaming generation', { request });
    try {
      await apiFetchStream(config, "/v1/generate_stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      }, (event) => {
        errorLogger.logDebug('Stream event received', { event: event.event, dataType: typeof event.data });
        setStreamLog((prev) => [...prev, { event: String(event.event ?? "data"), data: event.data }]);

        // Handle text events - parse and display generated text
        if (event.event === 'text' && event.data && typeof event.data === 'object') {
          const textData = event.data as { text?: string };
          if (textData.text) {
            // Accumulate text tokens
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
      errorLogger.logInfo('Streaming completed successfully', { eventsReceived: streamLog.length });
      push({ title: "Streaming run finished" });
    } catch (error) {
      errorLogger.logError(error, '/v1/generate_stream', { request });
      const userMessage = errorLogger.getUserFriendlyMessage(error);
      push({ title: "Streaming failed", description: userMessage, variant: "error" });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Text Generation</h2>
          <p className="text-slate-400 text-sm">Generate text using the Gemma 3 language model</p>
        </div>
        <button
          onClick={() => setShowGuide(!showGuide)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            showGuide 
              ? "bg-emerald-500/10 text-emerald-400" 
              : "bg-slate-900 text-slate-400 hover:text-slate-200"
          }`}
        >
          <BookOpen className="h-4 w-4" />
          {showGuide ? "Hide Guide" : "Show Guide"}
        </button>
      </div>

      {/* Instructions Panel (Collapsible) */}
      {showGuide && (
        <div className="animate-in fade-in slide-in-from-top-4 duration-300">
          <InstructionsPanel
            title="🤖 Text Generation Guide"
            description="Generate text using the Gemma 3 language model. Choose between synchronous (wait for complete response) or streaming (see tokens as they're generated) modes."
            steps={[
              {
                step: 1,
                title: "Write Your Prompt",
                description: "Enter the text you want the model to process in the prompt field.",
                details: (
                  <code className="text-xs">
                    Example: "Write a haiku about artificial intelligence"
                  </code>
                ),
              },
              {
                step: 2,
                title: "Adjust Parameters (Optional)",
                description: "Customize generation behavior using temperature, top-p, top-k, and max tokens.",
                details: (
                  <ul className="text-xs space-y-1 mt-1">
                    <li>• <strong>Temperature 0.1-0.5:</strong> Focused, predictable output</li>
                    <li>• <strong>Temperature 0.8-1.5:</strong> Creative, varied output</li>
                    <li>• <strong>Max tokens:</strong> Controls response length (1 token ≈ 4 characters)</li>
                  </ul>
                ),
              },
              {
                step: 3,
                title: "Choose Generation Mode",
                description: "Click 'Run Sync' for complete response at once, or 'Run Streaming' to watch generation in real-time.",
              },
              {
                step: 4,
                title: "View Results",
                description: "The generated text will appear below. Stream events show token-by-token generation progress.",
              },
            ]}
            tips={[
              "Start with default parameters (temp: 0.7, top-p: 0.95) for balanced results",
              "Use lower temperature (0.2-0.4) for factual, consistent outputs",
              "Use higher temperature (1.0-1.5) for creative writing or brainstorming",
              "Streaming mode is great for seeing how the model thinks step-by-step",
              "Max tokens limits length - increase if responses are cut off",
            ]}
            troubleshooting={[
              {
                problem: "Empty or very short responses",
                solution: "Increase 'Max tokens' parameter (try 512 or 1024)",
              },
              {
                problem: "Repetitive or nonsensical output",
                solution: "Adjust temperature (try 0.7-0.9) or increase top-k (try 50-100)",
              },
              {
                problem: "Generation taking too long",
                solution: "Reduce max tokens or check backend server status",
              },
            ]}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full min-h-0">
        {/* Left Column: Inputs */}
        <div className="lg:col-span-5 flex flex-col gap-6 overflow-y-auto pr-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden">
            <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-emerald-500" />
                <h3 className="font-medium text-slate-200">Input</h3>
              </div>
            </div>
            
            <div className="p-4 space-y-4">
              {/* System Prompt */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  System Prompt (Optional)
                </label>
                <textarea
                  className="w-full h-24 rounded-lg bg-slate-950 border border-slate-800 px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all resize-none placeholder:text-slate-600"
                  value={request.system_prompt}
                  onChange={(event) => setRequest((prev) => ({ ...prev, system_prompt: event.target.value }))}
                  placeholder="You are a helpful assistant..."
                  title={PARAM_HELP.systemPrompt}
                />
              </div>

              {/* User Prompt */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                  User Prompt
                </label>
                <textarea
                  className="w-full h-48 rounded-lg bg-slate-950 border border-slate-800 px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all resize-none placeholder:text-slate-600"
                  value={request.prompt}
                  onChange={(event) => setRequest((prev) => ({ ...prev, prompt: event.target.value }))}
                  placeholder="Enter your prompt here..."
                  title={PARAM_HELP.prompt}
                />
              </div>
            </div>
          </div>

          {/* Advanced Settings */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden">
            <button 
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full p-4 bg-slate-900/50 flex items-center justify-between hover:bg-slate-900 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-emerald-500" />
                <h3 className="font-medium text-slate-200">Advanced Settings</h3>
              </div>
              {showAdvanced ? (
                <ChevronUp className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              )}
            </button>
            
            {showAdvanced && (
              <div className="p-4 border-t border-slate-800 grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-200">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 flex items-center justify-between">
                    Temperature
                    <span className="text-emerald-500">{request.temperature}</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={request.temperature}
                    onChange={(e) => setRequest(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    title={PARAM_HELP.temperature}
                  />
                  <div className="flex justify-between text-[10px] text-slate-600">
                    <span>Precise</span>
                    <span>Creative</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 flex items-center justify-between">
                    Top P
                    <span className="text-emerald-500">{request.top_p}</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={request.top_p}
                    onChange={(e) => setRequest(prev => ({ ...prev, top_p: parseFloat(e.target.value) }))}
                    className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    title={PARAM_HELP.top_p}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 flex items-center justify-between">
                    Top K
                    <span className="text-emerald-500">{request.top_k}</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={request.top_k}
                    onChange={(e) => setRequest(prev => ({ ...prev, top_k: parseInt(e.target.value) }))}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                    title={PARAM_HELP.top_k}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-400 flex items-center justify-between">
                    Max Tokens
                    <span className="text-emerald-500">{request.max_tokens}</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="4096"
                    value={request.max_tokens}
                    onChange={(e) => setRequest(prev => ({ ...prev, max_tokens: parseInt(e.target.value) }))}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-sm text-slate-200 focus:border-emerald-500/50 focus:outline-none"
                    title={PARAM_HELP.max_tokens}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={isGenerating}
              className="flex-1 rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
            >
              {isGenerating ? (
                <div className="h-4 w-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Run Sync
            </button>
            <button
              onClick={handleStream}
              disabled={isGenerating}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm font-semibold text-emerald-400 hover:bg-slate-800 hover:border-emerald-500/50 transition-all flex items-center justify-center gap-2"
            >
              <Radio className="h-4 w-4" />
              Run Streaming
            </button>
          </div>
        </div>

        {/* Right Column: Output */}
        <div className="lg:col-span-7 flex flex-col gap-6 h-full">
          <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/20 p-6 flex flex-col relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-slate-900/0 to-slate-900/50 pointer-events-none" />
            
            <div className="flex items-center justify-between mb-6 relative z-10">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-500" />
                <h3 className="font-medium text-slate-200">Generated Output</h3>
              </div>
              {result && (
                <span className="text-xs text-slate-500">
                  {result.generated_text.length} chars
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto relative z-10">
              {result ? (
                <div className="prose prose-invert prose-emerald max-w-none">
                  <p className="text-slate-300 leading-relaxed whitespace-pre-wrap font-sans">
                    {result.generated_text}
                  </p>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 opacity-50 min-h-[300px]">
                  <div className="h-12 w-12 rounded-full bg-slate-900 flex items-center justify-center border border-slate-800">
                    <Bot className="h-6 w-6 text-slate-600" />
                  </div>
                  <p className="text-sm text-slate-500">
                    Generated content will appear here
                  </p>
                </div>
              )}
            </div>

            {/* Stream Logs (Collapsible or Fixed at bottom) */}
            {streamLog.length > 0 && (
              <div className="border-t border-slate-800 bg-slate-900/30 mt-4">
                <div className="p-2 bg-slate-900/80 border-b border-slate-800 flex items-center gap-2">
                  <Terminal className="h-3 w-3 text-slate-500" />
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Stream Events</span>
                </div>
                <div className="p-2 max-h-[150px] overflow-y-auto font-mono text-[10px] space-y-1">
                  {streamLog.map((entry, index) => (
                    <div key={index} className="flex gap-2 text-slate-400">
                      <span className="text-emerald-500/70 shrink-0 w-[60px]">{entry.event}</span>
                      <span className="truncate opacity-70">{JSON.stringify(entry.data)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Example Prompts Section */}
      <ExamplePrompts
        title="✨ Try These Examples"
        description="Click any example to load it into the prompt field. Great for testing different use cases!"
        examples={EXAMPLE_PROMPTS}
        onSelect={handleExampleSelect}
        buttonLabel="Use this"
      />

      {/* FAQ Section */}
      <FAQSection
        title="❓ Frequently Asked Questions"
        description="Common questions about text generation with Gemma 3"
        items={FAQ_ITEMS}
      />
    </div>
  );
}
