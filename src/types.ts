export type ProviderType = "openai" | "ollama" | "vllm";

export type ModelApi =
  | "openai-completions"
  | "openai-responses"
  | "ollama";

export interface ProviderConfig {
  id: string;
  type: ProviderType;
  name: string;
  baseUrl: string;
  apiKey: string;
  api: ModelApi;
  headers: Record<string, string>;
  injectNumCtx: boolean;
  authHeader: boolean;
}

export interface DiscoveredModel {
  id: string;
  name: string;
  providerId: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  inputTypes: Array<"text" | "image">;
  selected: boolean;
}

export const PROVIDER_DEFAULTS: Record<ProviderType, Partial<ProviderConfig>> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    api: "openai-completions",
    authHeader: true,
    injectNumCtx: false,
  },
  ollama: {
    baseUrl: "http://localhost:11434",
    api: "ollama",
    authHeader: false,
    injectNumCtx: true,
  },
  vllm: {
    baseUrl: "http://localhost:8000/v1",
    api: "openai-completions",
    authHeader: true,
    injectNumCtx: false,
  },
};
