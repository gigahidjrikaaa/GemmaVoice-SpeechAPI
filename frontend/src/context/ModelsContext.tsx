import { createContext, useContext, ReactNode } from "react";
import { useModels, Model } from "../hooks/useModels";

type ModelsContextValue = {
  models: Model[];
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

const ModelsContext = createContext<ModelsContextValue | null>(null);

type ModelsProviderProps = {
  children: ReactNode;
};

/**
 * Provider component that manages model selection state across the app.
 * Wraps the useModels hook and makes it available via context.
 */
export function ModelsProvider({ children }: ModelsProviderProps) {
  const modelsState = useModels();

  return (
    <ModelsContext.Provider value={modelsState}>
      {children}
    </ModelsContext.Provider>
  );
}

/**
 * Hook to access models context. Must be used within ModelsProvider.
 * 
 * @returns ModelsContextValue containing models, selectedModel, and related functions
 * @throws Error if used outside ModelsProvider
 */
export function useModelsContext() {
  const context = useContext(ModelsContext);
  if (!context) {
    throw new Error("useModelsContext must be used within ModelsProvider");
  }
  return context;
}
