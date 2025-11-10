import { useEffect, useState } from "react";
import { useClientConfig } from "../context/ConfigContext";
import { apiFetch } from "../lib/apiClient";

export type Model = {
  id: string;
  owned_by?: string;
  context_length?: number;
  parameters?: Record<string, unknown>;
};

type ModelsResponse = {
  models: Model[];
};

/**
 * Custom hook to fetch and manage available LLM models from the API.
 * 
 * @returns Object containing:
 * - models: Array of available models
 * - selectedModel: Currently selected model ID
 * - setSelectedModel: Function to change selected model
 * - isLoading: Whether models are being fetched
 * - error: Error message if fetch failed
 * - refetch: Function to manually refetch models
 */
export function useModels() {
  const { config } = useClientConfig();
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchModels = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const { data } = await apiFetch<ModelsResponse>(
        config,
        "/v1/models",
        {
          method: "GET",
        }
      );

      setModels(data.models || []);
      
      // Auto-select first model if none selected
      if (data.models.length > 0 && !selectedModel) {
        setSelectedModel(data.models[0].id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch models";
      setError(message);
      console.error("Failed to fetch models:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.baseUrl]); // Refetch when base URL changes

  return {
    models,
    selectedModel,
    setSelectedModel,
    isLoading,
    error,
    refetch: fetchModels,
  };
}
