import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";

export interface FAQItem {
  question: string;
  answer: string | React.ReactNode;
  category?: string;
}

interface FAQSectionProps {
  title?: string;
  description?: string;
  items: FAQItem[];
  defaultOpenIndex?: number;
}

export function FAQSection({ 
  title = "Frequently Asked Questions", 
  description,
  items,
  defaultOpenIndex 
}: FAQSectionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(defaultOpenIndex ?? null);

  // Group items by category if categories exist
  const hasCategories = items.some(item => item.category);
  const groupedItems = hasCategories
    ? items.reduce((acc, item, idx) => {
        const category = item.category || "General";
        if (!acc[category]) acc[category] = [];
        acc[category].push({ ...item, originalIndex: idx });
        return acc;
      }, {} as Record<string, (FAQItem & { originalIndex: number })[]>)
    : null;

  const toggleItem = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  const renderItem = (item: FAQItem, index: number) => (
    <div
      key={index}
      className="border border-slate-800 rounded-lg overflow-hidden transition-all hover:border-slate-700"
    >
      <button
        onClick={() => toggleItem(index)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-800/30 transition-colors"
        aria-expanded={openIndex === index}
      >
        <span className="text-sm font-medium text-slate-200 pr-4">{item.question}</span>
        <ChevronDown 
          className={`h-4 w-4 text-slate-400 shrink-0 transition-transform duration-200 ${
            openIndex === index ? "rotate-180" : ""
          }`} 
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-200 ${
          openIndex === index ? "max-h-[500px]" : "max-h-0"
        }`}
      >
        <div className="px-4 pb-4 pt-0 text-sm text-slate-400 leading-relaxed border-t border-slate-800/50">
          {typeof item.answer === "string" ? (
            <p className="mt-3">{item.answer}</p>
          ) : (
            <div className="mt-3">{item.answer}</div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-2 mb-3">
        <HelpCircle className="h-5 w-5 text-amber-400" />
        <h3 className="text-sm font-semibold text-amber-300">{title}</h3>
      </div>
      
      {description && (
        <p className="text-xs text-amber-100/70 mb-4">{description}</p>
      )}

      <div className="space-y-2">
        {groupedItems ? (
          Object.entries(groupedItems).map(([category, categoryItems]) => (
            <div key={category} className="space-y-2">
              <h4 className="text-xs font-semibold text-amber-400/80 uppercase tracking-wider mt-3 first:mt-0">
                {category}
              </h4>
              {categoryItems.map(item => renderItem(item, item.originalIndex))}
            </div>
          ))
        ) : (
          items.map((item, index) => renderItem(item, index))
        )}
      </div>
    </div>
  );
}
