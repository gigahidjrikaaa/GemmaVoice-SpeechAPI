import { Sparkles, Play } from "lucide-react";

export interface ExamplePrompt {
  title: string;
  description: string;
  prompt: string;
  systemPrompt?: string;
  category?: string;
}

interface ExamplePromptsProps {
  title?: string;
  description?: string;
  examples: ExamplePrompt[];
  onSelect: (example: ExamplePrompt) => void;
  buttonLabel?: string;
}

export function ExamplePrompts({
  title = "Try These Examples",
  description = "Click any example to quickly test the feature with pre-filled content.",
  examples,
  onSelect,
  buttonLabel = "Try it",
}: ExamplePromptsProps) {
  // Group by category if categories exist
  const hasCategories = examples.some(ex => ex.category);
  const groupedExamples = hasCategories
    ? examples.reduce((acc, example) => {
        const category = example.category || "General";
        if (!acc[category]) acc[category] = [];
        acc[category].push(example);
        return acc;
      }, {} as Record<string, ExamplePrompt[]>)
    : null;

  const renderExample = (example: ExamplePrompt, index: number) => (
    <div
      key={index}
      className="group rounded-lg border border-slate-800 bg-slate-900/30 p-4 hover:border-violet-500/50 hover:bg-slate-800/50 transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-slate-200 group-hover:text-violet-300 transition-colors">
            {example.title}
          </h4>
          <p className="text-xs text-slate-500 mt-1 line-clamp-2">
            {example.description}
          </p>
          <div className="mt-2 p-2 rounded bg-slate-950/50 border border-slate-800/50">
            <p className="text-xs text-slate-400 font-mono line-clamp-2 italic">
              "{example.prompt.substring(0, 100)}{example.prompt.length > 100 ? "..." : ""}"
            </p>
          </div>
        </div>
        <button
          onClick={() => onSelect(example)}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-500/10 text-violet-400 text-xs font-medium hover:bg-violet-500 hover:text-white transition-all border border-violet-500/20 hover:border-violet-500"
          aria-label={`Try example: ${example.title}`}
        >
          <Play className="h-3 w-3" />
          {buttonLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-5 w-5 text-violet-400" />
        <h3 className="text-sm font-semibold text-violet-300">{title}</h3>
      </div>
      
      <p className="text-xs text-violet-100/70 mb-4">{description}</p>

      <div className="space-y-3">
        {groupedExamples ? (
          Object.entries(groupedExamples).map(([category, categoryExamples]) => (
            <div key={category}>
              <h4 className="text-xs font-semibold text-violet-400/80 uppercase tracking-wider mb-2">
                {category}
              </h4>
              <div className="space-y-2">
                {categoryExamples.map((example, index) => renderExample(example, index))}
              </div>
            </div>
          ))
        ) : (
          <div className="space-y-2">
            {examples.map((example, index) => renderExample(example, index))}
          </div>
        )}
      </div>
    </div>
  );
}
