import { useMemo } from "react";
import { SettingsPanel } from "./components/SettingsPanel";
import { TabView } from "./components/TabView";
import { ConfigProvider } from "./context/ConfigContext";
import { TabsProvider, useTabs } from "./context/TabsContext";
import { ModelsProvider } from "./context/ModelsContext";
import { CodeProvider, useCode } from "./context/CodeContext";

import { GenerationPanel } from "./components/GenerationPanel";
import { SynthesisPanel } from "./components/SynthesisPanel";
import { TranscriptionPanel } from "./components/TranscriptionPanel";
import { VoiceChatPanel } from "./components/VoiceChatPanel";
import { ToastProvider } from "./components/Toast";
import { CodeViewer } from "./components/CodeViewer";
import { Code, Layout } from "lucide-react";

const tabs = [
  { id: "generate", label: "Text Generation", component: GenerationPanel },
  { id: "stt", label: "Speech to Text", component: TranscriptionPanel },
  { id: "tts", label: "Text to Speech", component: SynthesisPanel },
  { id: "voice-chat", label: "🎙️ Voice Chat", component: VoiceChatPanel }
];

function AppShell() {
  const tabConfig = useMemo(() => tabs, []);
  const { activeTab, setActiveTab } = useTabs();
  const { snippet, showCode, setShowCode } = useCode();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30">
      <div className="mx-auto flex max-w-[1600px] flex-col h-screen">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-4 backdrop-blur-md sticky top-0 z-50">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              AICare Speech Playground
            </h1>
            <p className="text-xs text-slate-400">
              Gemma 3 LLM • Whisper STT • OpenAudio TTS
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCode(!showCode)}
              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${showCode
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                : "border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200"
                }`}
            >
              <Code className="h-4 w-4" />
              {showCode ? "Hide Code" : "Show Code"}
            </button>
            <div className="h-6 w-px bg-slate-800" />
            <SettingsPanel />
          </div>
        </header>

        <main className="flex-1 overflow-hidden flex">
          {/* Main Content Area */}
          <div className={`flex-1 overflow-y-auto p-6 transition-all duration-300 ${showCode ? 'mr-0' : 'mx-auto max-w-5xl'}`}>
            <TabView tabs={tabConfig} activeTab={activeTab} onTabChange={setActiveTab} />
          </div>

          {/* Code Viewer Sidebar */}
          <div
            className={`border-l border-slate-800 bg-slate-950/50 transition-all duration-300 flex flex-col ${showCode ? "w-[450px] translate-x-0" : "w-0 translate-x-full opacity-0 overflow-hidden"
              }`}
          >
            <div className="p-4 border-b border-slate-800 bg-slate-900/50">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Layout className="h-4 w-4 text-emerald-400" />
                Developer Console
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {snippet ? (
                <div className="flex flex-col gap-4">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                    <h3 className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Action</h3>
                    <p className="text-sm text-slate-200">{snippet.title}</p>
                  </div>
                  <CodeViewer
                    code={snippet.code}
                    language={snippet.language}
                    title="API Request"
                    className="shadow-xl"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
                  <Code className="h-12 w-12 opacity-20" />
                  <p className="text-sm text-center max-w-[200px]">
                    Interact with the playground to see API requests and code snippets here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ConfigProvider>
        <ModelsProvider>
          <CodeProvider>
            <TabsProvider defaultTab="generate">
              <AppShell />
            </TabsProvider>
          </CodeProvider>
        </ModelsProvider>
      </ConfigProvider>
    </ToastProvider>
  );
}
