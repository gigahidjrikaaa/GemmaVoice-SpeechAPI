import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '../lib/utils';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface CodeViewerProps {
    code: string;
    language: string;
    title?: string;
    className?: string;
}

export function CodeViewer({ code, language, title, className }: CodeViewerProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className={cn("overflow-hidden rounded-md border border-slate-800 bg-[#1e1e1e]", className)}>
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/50 px-4 py-2">
                <span className="text-xs font-medium text-slate-400">{title || language}</span>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 transition-colors"
                >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                </button>
            </div>
            <SyntaxHighlighter
                language={language}
                style={vscDarkPlus}
                customStyle={{ margin: 0, padding: '1rem', background: 'transparent', fontSize: '0.875rem' }}
                wrapLines={true}
                wrapLongLines={true}
            >
                {code}
            </SyntaxHighlighter>
        </div>
    );
}
