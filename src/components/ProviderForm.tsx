import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Trash2,
  Wifi,
  WifiOff,
  Download,
  Loader2,
  Plus,
  X,
  Server,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { ProviderConfig, DiscoveredModel } from "@/types";
import { testConnection, fetchModels } from "@/api";

interface Props {
  provider: ProviderConfig;
  onUpdate: (id: string, patch: Partial<ProviderConfig>) => void;
  onRemove: (id: string) => void;
  onModelsFound: (providerId: string, models: DiscoveredModel[]) => void;
}

const API_OPTIONS = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "ollama", label: "Ollama" },
] as const;

export function ProviderForm({ provider, onUpdate, onRemove, onModelsFound }: Props) {
  const { t } = useTranslation();
  const [testing, setTesting] = useState(false);
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);
  const [fetching, setFetching] = useState(false);
  const [modelCount, setModelCount] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [newHeaderKey, setNewHeaderKey] = useState("");
  const [newHeaderVal, setNewHeaderVal] = useState("");

  const typeLabel =
    provider.type === "openai"
      ? t("provider.openai")
      : provider.type === "ollama"
        ? t("provider.ollama")
        : t("provider.vllm");

  const handleTest = async () => {
    setTesting(true);
    setConnectionOk(null);
    const ok = await testConnection(provider);
    setConnectionOk(ok);
    setTesting(false);
  };

  const handleFetch = async () => {
    setFetching(true);
    setFetchError(null);
    setModelCount(null);
    try {
      const models = await fetchModels(provider);
      setModelCount(models.length);
      onModelsFound(provider.id, models);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : t("provider.fetchError"));
    }
    setFetching(false);
  };

  const addHeader = () => {
    if (!newHeaderKey.trim()) return;
    onUpdate(provider.id, {
      headers: { ...provider.headers, [newHeaderKey.trim()]: newHeaderVal },
    });
    setNewHeaderKey("");
    setNewHeaderVal("");
  };

  const removeHeader = (key: string) => {
    const next = { ...provider.headers };
    delete next[key];
    onUpdate(provider.id, { headers: next });
  };

  return (
    <Card className="transition-all">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">
              {provider.name || typeLabel}
            </CardTitle>
            <Badge variant="secondary" className="text-xs">{typeLabel}</Badge>
            {connectionOk === true && (
              <Badge variant="default" className="text-xs bg-green-600">{t("provider.connectionSuccess")}</Badge>
            )}
            {connectionOk === false && (
              <Badge variant="destructive" className="text-xs">{t("provider.connectionFailed")}</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onRemove(provider.id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("provider.providerName")}</Label>
              <Input
                placeholder={t("provider.providerNamePlaceholder")}
                value={provider.name}
                onChange={(e) => onUpdate(provider.id, { name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("provider.apiType")}</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={provider.api}
                onChange={(e) => onUpdate(provider.id, { api: e.target.value as ProviderConfig["api"] })}
              >
                {API_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("provider.baseUrl")}</Label>
            <Input
              placeholder={t("provider.baseUrlPlaceholder")}
              value={provider.baseUrl}
              onChange={(e) => onUpdate(provider.id, { baseUrl: e.target.value })}
            />
          </div>

          {provider.type !== "ollama" && (
            <div className="space-y-2">
              <Label>{t("provider.apiKey")}</Label>
              <Input
                type="password"
                placeholder={t("provider.apiKeyPlaceholder")}
                value={provider.apiKey}
                onChange={(e) => onUpdate(provider.id, { apiKey: e.target.value })}
              />
            </div>
          )}

          <div className="flex items-center gap-6">
            {provider.type === "ollama" && (
              <div className="flex items-center gap-2">
                <Switch
                  checked={provider.injectNumCtx}
                  onCheckedChange={(v) => onUpdate(provider.id, { injectNumCtx: v })}
                />
                <Label className="text-sm">{t("provider.injectNumCtx")}</Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                checked={provider.authHeader}
                onCheckedChange={(v) => onUpdate(provider.id, { authHeader: v })}
              />
              <Label className="text-sm">{t("provider.authHeader")}</Label>
            </div>
          </div>

          {/* Custom Headers */}
          <div className="space-y-2">
            <Label>{t("provider.headers")}</Label>
            <div className="space-y-2">
              {Object.entries(provider.headers).map(([key, val]) => (
                <div key={key} className="flex items-center gap-2">
                  <Input value={key} disabled className="flex-1 opacity-70" />
                  <Input value={val} disabled className="flex-1 opacity-70" />
                  <Button variant="ghost" size="icon" onClick={() => removeHeader(key)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  placeholder={t("provider.headerKey")}
                  value={newHeaderKey}
                  onChange={(e) => setNewHeaderKey(e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder={t("provider.headerValue")}
                  value={newHeaderVal}
                  onChange={(e) => setNewHeaderVal(e.target.value)}
                  className="flex-1"
                />
                <Button variant="outline" size="icon" onClick={addHeader}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2">
            <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : connectionOk ? (
                <Wifi className="h-4 w-4 mr-1" />
              ) : (
                <WifiOff className="h-4 w-4 mr-1" />
              )}
              {testing ? t("provider.testing") : t("provider.testConnection")}
            </Button>
            <Button size="sm" onClick={handleFetch} disabled={fetching}>
              {fetching ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              {fetching ? t("provider.fetchingModels") : t("provider.fetchModels")}
            </Button>
            {modelCount !== null && (
              <span className="text-sm text-muted-foreground">
                {t("provider.modelsFound", { count: modelCount })}
              </span>
            )}
            {fetchError && (
              <span className="text-sm text-destructive">{fetchError}</span>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
