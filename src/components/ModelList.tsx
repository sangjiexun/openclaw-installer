import { useTranslation } from "react-i18next";
import { Brain, Image, Type, Check } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { DiscoveredModel, ProviderConfig } from "@/types";

interface Props {
  models: DiscoveredModel[];
  providers: ProviderConfig[];
  onToggle: (modelId: string, providerId: string) => void;
  onToggleAll: (providerId: string, selected: boolean) => void;
}

export function ModelList({ models, providers, onToggle, onToggleAll }: Props) {
  const { t } = useTranslation();

  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Brain className="h-12 w-12 mb-4 opacity-40" />
        <p className="text-sm">{t("model.noModels")}</p>
      </div>
    );
  }

  const grouped = providers
    .map((p) => ({
      provider: p,
      models: models.filter((m) => m.providerId === p.id),
    }))
    .filter((g) => g.models.length > 0);

  return (
    <div className="space-y-6">
      {grouped.map(({ provider, models: pModels }) => {
        const allSelected = pModels.every((m) => m.selected);
        return (
          <div key={provider.id} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                {provider.name || provider.type} — {pModels.length} {t("model.title").toLowerCase()}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleAll(provider.id, !allSelected)}
              >
                {allSelected ? t("model.deselectAll") : t("model.selectAll")}
              </Button>
            </div>
            <div className="grid gap-2">
              {pModels.map((model) => (
                <button
                  key={`${model.providerId}-${model.id}`}
                  onClick={() => onToggle(model.id, model.providerId)}
                  className={`flex items-center justify-between p-3 rounded-lg border text-left transition-all ${
                    model.selected
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:border-muted-foreground/30"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        model.selected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-input"
                      }`}
                    >
                      {model.selected && <Check className="h-3 w-3" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{model.id}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          ctx: {(model.contextWindow / 1024).toFixed(0)}k
                        </span>
                        <span className="text-xs text-muted-foreground">
                          max: {(model.maxTokens / 1024).toFixed(0)}k
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {model.inputTypes.includes("text") && (
                      <Badge variant="secondary" className="text-xs gap-1 px-1.5">
                        <Type className="h-3 w-3" />
                        {t("model.text")}
                      </Badge>
                    )}
                    {model.inputTypes.includes("image") && (
                      <Badge variant="secondary" className="text-xs gap-1 px-1.5">
                        <Image className="h-3 w-3" />
                        {t("model.image")}
                      </Badge>
                    )}
                    {model.reasoning && (
                      <Badge variant="default" className="text-xs gap-1 px-1.5">
                        <Brain className="h-3 w-3" />
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
