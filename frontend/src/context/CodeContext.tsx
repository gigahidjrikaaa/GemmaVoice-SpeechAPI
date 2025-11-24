import { createContext, useContext, useState, ReactNode } from "react";

type CodeSnippet = {
    language: string;
    code: string;
    title?: string;
};

type CodeContextType = {
    snippet: CodeSnippet | null;
    setSnippet: (snippet: CodeSnippet | null) => void;
    showCode: boolean;
    setShowCode: (show: boolean) => void;
};

const CodeContext = createContext<CodeContextType | undefined>(undefined);

export function CodeProvider({ children }: { children: ReactNode }) {
    const [snippet, setSnippet] = useState<CodeSnippet | null>(null);
    const [showCode, setShowCode] = useState(true);

    return (
        <CodeContext.Provider value={{ snippet, setSnippet, showCode, setShowCode }}>
            {children}
        </CodeContext.Provider>
    );
}

export function useCode() {
    const context = useContext(CodeContext);
    if (context === undefined) {
        throw new Error("useCode must be used within a CodeProvider");
    }
    return context;
}
