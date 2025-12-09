import { ReactNode, useState } from "react";
import { ChevronDown, ChevronUp, BookOpen, Lightbulb, Wrench, ListChecks } from "lucide-react";

interface InstructionsPanelProps {
  title: string;
  description: string;
  steps: {
    step: number;
    title: string;
    description: string;
    details?: ReactNode;
  }[];
  tips?: string[];
  troubleshooting?: {
    problem: string;
    solution: string;
  }[];
  /** If true, panel starts collapsed */
  defaultCollapsed?: boolean;
}

export function InstructionsPanel({ 
  title, 
  description, 
  steps, 
  tips, 
  troubleshooting,
  defaultCollapsed = false 
}: InstructionsPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [activeSection, setActiveSection] = useState<"steps" | "tips" | "troubleshooting">("steps");

  const hasTips = tips && tips.length > 0;
  const hasTroubleshooting = troubleshooting && troubleshooting.length > 0;

  return (
    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header - Always Visible */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between p-4 hover:bg-blue-500/10 transition-colors"
        aria-expanded={!isCollapsed}
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <BookOpen className="h-5 w-5 text-blue-400" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-blue-300">
              {title}
            </h3>
            <p className="text-xs text-blue-400/70 mt-0.5 max-w-md truncate">
              {description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-blue-400/60 hidden sm:inline">
            {isCollapsed ? "Show guide" : "Hide guide"}
          </span>
          {isCollapsed ? (
            <ChevronDown className="h-5 w-5 text-blue-400" />
          ) : (
            <ChevronUp className="h-5 w-5 text-blue-400" />
          )}
        </div>
      </button>

      {/* Collapsible Content */}
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          isCollapsed ? "max-h-0" : "max-h-[2000px]"
        }`}
      >
        <div className="p-4 pt-0 space-y-4">
          {/* Section Tabs */}
          {(hasTips || hasTroubleshooting) && (
            <div className="flex gap-1 p-1 bg-slate-900/50 rounded-lg border border-slate-800 w-fit">
              <button
                onClick={() => setActiveSection("steps")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeSection === "steps"
                    ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <ListChecks className="h-3.5 w-3.5" />
                Steps
              </button>
              {hasTips && (
                <button
                  onClick={() => setActiveSection("tips")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    activeSection === "tips"
                      ? "bg-amber-500 text-white shadow-lg shadow-amber-500/20"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Lightbulb className="h-3.5 w-3.5" />
                  Tips
                </button>
              )}
              {hasTroubleshooting && (
                <button
                  onClick={() => setActiveSection("troubleshooting")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    activeSection === "troubleshooting"
                      ? "bg-red-500 text-white shadow-lg shadow-red-500/20"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Wrench className="h-3.5 w-3.5" />
                  Troubleshooting
                </button>
              )}
            </div>
          )}

          {/* Steps Section */}
          {activeSection === "steps" && (
            <div className="space-y-3 animate-in fade-in duration-200">
              {steps.map(({ step, title: stepTitle, description: stepDesc, details }) => (
                <div 
                  key={step} 
                  className="flex gap-3 p-3 rounded-lg bg-slate-900/30 border border-slate-800/50 hover:border-blue-500/30 transition-colors"
                >
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center text-sm font-bold shadow-lg shadow-blue-500/20">
                    {step}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-blue-200 text-sm">
                      {stepTitle}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      {stepDesc}
                    </p>
                    {details && (
                      <div className="mt-2 text-xs text-blue-400/80 bg-blue-500/10 p-2 rounded border border-blue-500/20">
                        {details}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tips Section */}
          {activeSection === "tips" && hasTips && (
            <div className="space-y-2 animate-in fade-in duration-200">
              {tips.map((tip, idx) => (
                <div 
                  key={idx} 
                  className="flex gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 hover:bg-amber-500/10 transition-colors"
                >
                  <Lightbulb className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-100/80 leading-relaxed">{tip}</p>
                </div>
              ))}
            </div>
          )}

          {/* Troubleshooting Section */}
          {activeSection === "troubleshooting" && hasTroubleshooting && (
            <div className="space-y-3 animate-in fade-in duration-200">
              {troubleshooting.map(({ problem, solution }, idx) => (
                <div 
                  key={idx} 
                  className="rounded-lg bg-slate-900/30 border border-slate-800/50 overflow-hidden"
                >
                  <div className="flex gap-2 p-3 bg-red-500/5 border-b border-red-500/10">
                    <span className="text-red-400 text-xs">❌</span>
                    <p className="text-xs font-medium text-red-300">{problem}</p>
                  </div>
                  <div className="flex gap-2 p-3 bg-emerald-500/5">
                    <span className="text-emerald-400 text-xs">✅</span>
                    <p className="text-xs text-emerald-300 leading-relaxed">{solution}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
