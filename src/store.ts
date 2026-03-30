import { useState, useCallback } from "react";
import type { ProviderConfig, DiscoveredModel, ProviderType } from "./types";
import { PROVIDER_DEFAULTS } from "./types";

let idCounter = 0;
function nextId() {
  return `provider-${++idCounter}`;
}

export function useProviderStore() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<DiscoveredModel[]>([]);

  const addProvider = useCallback((type: ProviderType) => {
    const defaults = PROVIDER_DEFAULTS[type];
    const provider: ProviderConfig = {
      id: nextId(),
      type,
      name: "",
      baseUrl: defaults.baseUrl ?? "",
      apiKey: "",
      api: defaults.api ?? "openai-completions",
      headers: {},
      injectNumCtx: defaults.injectNumCtx ?? false,
      authHeader: defaults.authHeader ?? true,
    };
    setProviders((prev) => [...prev, provider]);
    return provider.id;
  }, []);

  const updateProvider = useCallback((id: string, patch: Partial<ProviderConfig>) => {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const removeProvider = useCallback((id: string) => {
    setProviders((prev) => prev.filter((p) => p.id !== id));
    setModels((prev) => prev.filter((m) => m.providerId !== id));
  }, []);

  const addModels = useCallback((providerId: string, newModels: DiscoveredModel[]) => {
    setModels((prev) => {
      const filtered = prev.filter((m) => m.providerId !== providerId);
      return [...filtered, ...newModels];
    });
  }, []);

  const toggleModel = useCallback((modelId: string, providerId: string) => {
    setModels((prev) =>
      prev.map((m) =>
        m.id === modelId && m.providerId === providerId ? { ...m, selected: !m.selected } : m,
      ),
    );
  }, []);

  const toggleAllModels = useCallback((providerId: string, selected: boolean) => {
    setModels((prev) =>
      prev.map((m) => (m.providerId === providerId ? { ...m, selected } : m)),
    );
  }, []);

  return {
    providers,
    models,
    addProvider,
    updateProvider,
    removeProvider,
    addModels,
    toggleModel,
    toggleAllModels,
  };
}
