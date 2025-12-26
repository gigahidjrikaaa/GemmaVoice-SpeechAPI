import { useMemo } from "react";
import { SettingsPanel } from "./components/SettingsPanel";
import { ConfigProvider } from "./context/ConfigContext";
import { TabsProvider, useTabs } from "./context/TabsContext";
import { ModelsProvider } from "./context/ModelsContext";
import { CodeProvider, useCode } from "./context/CodeContext";

import { GenerationPanel } from "./components/GenerationPanel";
import { SynthesisPanel } from "./components/SynthesisPanel";
import { TranscriptionPanel } from "./components/TranscriptionPanel";
import { VoiceChatPanel } from "./components/VoiceChatPanel";
import { AboutPanel } from "./components/AboutPanel";
import { ToastProvider } from "./components/Toast";
import { CodeViewer } from "./components/CodeViewer";
import { 
  Code, 
  Layout, 
  MessageSquare, 
  Mic, 
  Volume2, 
  Info, 
  Bot,
  Menu
} from "lucide-react";

const tabs = [
  { id: "generate", label: "Text Generation", icon: MessageSquare, component: GenerationPanel },
  { id: "stt", label: "Speech to Text", icon: Mic, component: TranscriptionPanel },
  { id: "tts", label: "Text to Speech", icon: Volume2, component: SynthesisPanel },
  { id: "voice-chat", label: "Voice Chat", icon: Bot, component: VoiceChatPanel },
  { id: "about", label: "About", icon: Info, component: AboutPanel }
];

function AppShell() {
  const { activeTab, setActiveTab } = useTabs();
  const { snippet, showCode, setShowCode } = useCode();

  const ActiveComponent = useMemo(() => 
    tabs.find(t => t.id === activeTab)?.component || tabs[0].component, 
  [activeTab]);

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30 overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-64 flex-shrink-0 border-r border-slate-800 bg-slate-950 flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              Gemma Voice
            </h1>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
              AI Speech Platform
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group ${
                  isActive 
                    ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20" 
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                }`}
              >
                <Icon className={`h-4 w-4 transition-colors ${isActive ? "text-emerald-400" : "text-slate-500 group-hover:text-slate-300"}`} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-2">
          <button
            onClick={() => setShowCode(!showCode)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              showCode
                ? "bg-slate-800 text-slate-200"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            }`}
          >
            <Code className="h-4 w-4" />
            {showCode ? "Hide Console" : "Show Console"}
          </button>
          <div className="pt-2">
            <SettingsPanel />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-950/50">
        {/* Mobile/Tablet Header (if needed in future, currently hidden for desktop-first) */}
        
        <div className="flex-1 overflow-hidden flex relative">
          <div className="flex-1 overflow-y-auto scroll-smooth">
            <div className="max-w-7xl mx-auto p-8">
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <ActiveComponent />
              </div>
            </div>
          </div>

          {/* Code Viewer Sidebar (Overlay or Push) */}
          <div
            className={`border-l border-slate-800 bg-slate-950 shadow-2xl transition-all duration-300 ease-in-out flex flex-col absolute right-0 top-0 bottom-0 z-20 ${
              showCode ? "w-[450px] translate-x-0" : "w-0 translate-x-full opacity-0"
            }`}
          >
            <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Layout className="h-4 w-4 text-emerald-400" />
                Developer Console
              </h2>
              <button onClick={() => setShowCode(false)} className="text-slate-500 hover:text-slate-300">
                <Menu className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-slate-950">
              {snippet ? (
                <div className="flex flex-col gap-4">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                    <h3 className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Current Action</h3>
                    <p className="text-sm text-slate-200 font-medium">{snippet.title}</p>
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
        </div>
      </main>
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
