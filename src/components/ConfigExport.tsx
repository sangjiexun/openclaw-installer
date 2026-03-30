import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Copy, CheckCheck, Download, FileJson } from "lucide-react";
import { Button } from "./ui/button";
import type { ProviderConfig, DiscoveredModel } from "@/types";

interface Props {
  providers: ProviderConfig[];
  models: DiscoveredModel[];
}

function buildConfig(providers: ProviderConfig[], models: DiscoveredModel[]) {
  const providersConfig: Record<string, unknown> = {};

  for (const p of providers) {
    const providerName = p.name || `${p.type}-${p.id}`;
    const selectedModels = models.filter((m) => m.providerId === p.id && m.selected);

    const providerEntry: Record<string, unknown> = {
      baseUrl: p.baseUrl,
      api: p.api,
    };

    if (p.apiKey) {
      providerEntry.apiKey = p.apiKey;
    }

    if (p.injectNumCtx) {
      providerEntry.injectNumCtxForOpenAICompat = true;
    }

    if (Object.keys(p.headers).length > 0) {
      providerEntry.headers = p.headers;
    }

    if (!p.authHeader) {
      providerEntry.authHeader = false;
    }

    providerEntry.models = selectedModels.map((m) => ({
      id: m.id,
      name: m.name,
      reasoning: m.reasoning,
      input: m.inputTypes,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    }));

    providersConfig[providerName] = providerEntry;
  }

  return { models: { providers: providersConfig } };
}

export function ConfigExport({ providers, models }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const config = useMemo(() => buildConfig(providers, models), [providers, models]);
  const json = JSON.stringify(config, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "openclaw-providers.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <FileJson className="h-12 w-12 mb-4 opacity-40" />
        <p className="text-sm">{t("config.empty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">{t("config.description")}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {copied ? (
            <CheckCheck className="h-4 w-4 mr-1 text-green-500" />
          ) : (
            <Copy className="h-4 w-4 mr-1" />
          )}
          {copied ? t("config.copied") : t("config.copy")}
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="h-4 w-4 mr-1" />
          {t("config.download")}
        </Button>
      </div>
      <pre className="p-4 rounded-lg bg-muted/50 border text-xs overflow-auto max-h-[500px] leading-relaxed">
        <code>{json}</code>
      </pre>
    </div>
  );
}
