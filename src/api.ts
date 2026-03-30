import type { ProviderConfig, DiscoveredModel } from "./types";

interface OllamaModel {
  name: string;
  details?: { parameter_size?: string; family?: string };
}

interface OpenAIModel {
  id: string;
  object?: string;
  owned_by?: string;
}

function buildHeaders(provider: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...provider.headers,
  };
  if (provider.authHeader && provider.apiKey) {
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
  }
  return headers;
}

export async function fetchOllamaModels(provider: ProviderConfig): Promise<DiscoveredModel[]> {
  const base = provider.baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/tags`);
  if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);
  const data = (await res.json()) as { models: OllamaModel[] };
  return (data.models ?? []).map((m) => ({
    id: m.name,
    name: m.name,
    providerId: provider.id,
    reasoning: false,
    contextWindow: 8192,
    maxTokens: 4096,
    inputTypes: ["text"] as Array<"text" | "image">,
    selected: true,
  }));
}

export async function fetchOpenAICompatModels(provider: ProviderConfig): Promise<DiscoveredModel[]> {
  const base = provider.baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/models`, { headers: buildHeaders(provider) });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = (await res.json()) as { data: OpenAIModel[] };
  return (data.data ?? []).map((m) => ({
    id: m.id,
    name: m.id,
    providerId: provider.id,
    reasoning: false,
    contextWindow: 128000,
    maxTokens: 4096,
    inputTypes: ["text"] as Array<"text" | "image">,
    selected: true,
  }));
}

export async function testConnection(provider: ProviderConfig): Promise<boolean> {
  try {
    if (provider.type === "ollama") {
      const base = provider.baseUrl.replace(/\/+$/, "");
      const res = await fetch(`${base}/api/tags`);
      return res.ok;
    }
    const base = provider.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/models`, { headers: buildHeaders(provider) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchModels(provider: ProviderConfig): Promise<DiscoveredModel[]> {
  if (provider.type === "ollama") {
    return fetchOllamaModels(provider);
  }
  return fetchOpenAICompatModels(provider);
}
