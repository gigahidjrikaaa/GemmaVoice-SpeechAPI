import { ReactNode } from "react";

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
}

export function InstructionsPanel({ title, description, steps, tips, troubleshooting }: InstructionsPanelProps) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 mb-6 dark:border-blue-800 dark:bg-blue-950">
      <div className="flex items-start gap-3">
        <span className="text-2xl">ℹ️</span>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">
            {title}
          </h3>
          <p className="text-sm text-blue-800 dark:text-blue-200 mb-4">
            {description}
          </p>

          {/* Steps */}
          <div className="space-y-3">
            {steps.map(({ step, title: stepTitle, description: stepDesc, details }) => (
              <div key={step} className="flex gap-3">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-semibold">
                  {step}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-blue-900 dark:text-blue-100">
                    {stepTitle}
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                    {stepDesc}
                  </p>
                  {details && (
                    <div className="mt-2 text-sm text-blue-600 dark:text-blue-400">
                      {details}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Tips */}
          {tips && tips.length > 0 && (
            <div className="mt-4 pt-4 border-t border-blue-200 dark:border-blue-800">
              <p className="font-medium text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-2">
                💡 <span>Tips</span>
              </p>
              <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
                {tips.map((tip, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span>•</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Troubleshooting */}
          {troubleshooting && troubleshooting.length > 0 && (
            <div className="mt-4 pt-4 border-t border-blue-200 dark:border-blue-800">
              <p className="font-medium text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-2">
                🔧 <span>Troubleshooting</span>
              </p>
              <div className="space-y-2">
                {troubleshooting.map(({ problem, solution }, idx) => (
                  <div key={idx} className="text-sm">
                    <p className="font-medium text-blue-800 dark:text-blue-200">
                      ❌ {problem}
                    </p>
                    <p className="text-blue-700 dark:text-blue-300 ml-4">
                      ✅ {solution}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
