import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Server, Brain, FileJson, Monitor, Download, Trash2, Package, Tag, Settings, Activity } from "lucide-react";
import { Header } from "./components/Header";
import { ProviderForm } from "./components/ProviderForm";
import { ModelList } from "./components/ModelList";
import { ConfigExport } from "./components/ConfigExport";
import { EnvironmentCheck } from "./components/EnvironmentCheck";
import { Installer } from "./components/Installer";
import { Uninstaller } from "./components/Uninstaller";
import { Packager } from "./components/Packager";
import { VersionManager } from "./components/VersionManager";
import { ConfigManager } from "./components/ConfigManager";
import { GatewayManager } from "./components/GatewayManager";
import { Button } from "./components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { useProviderStore } from "./store";
import type { ProviderType } from "./types";

const PROVIDER_TYPES: { value: ProviderType; icon: string }[] = [
  { value: "openai", icon: "🤖" },
  { value: "ollama", icon: "🦙" },
  { value: "vllm", icon: "⚡" },
];

export default function App() {
  const { t } = useTranslation();
  const store = useProviderStore();
  const [showAddMenu, setShowAddMenu] = useState(false);

  const handleAdd = (type: ProviderType) => {
    store.addProvider(type);
    setShowAddMenu(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <Tabs defaultValue="env" className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="env" className="gap-1.5">
                <Monitor className="h-4 w-4" />
                {t("nav.env")}
              </TabsTrigger>
              <TabsTrigger value="install" className="gap-1.5">
                <Download className="h-4 w-4" />
                {t("nav.install")}
              </TabsTrigger>
              <TabsTrigger value="versions" className="gap-1.5">
                <Tag className="h-4 w-4" />
                {t("nav.versions")}
              </TabsTrigger>
              <TabsTrigger value="gateway" className="gap-1.5">
                <Activity className="h-4 w-4" />
                {t("nav.gateway")}
              </TabsTrigger>
              <TabsTrigger value="configmgr" className="gap-1.5">
                <Settings className="h-4 w-4" />
                {t("nav.configMgr")}
              </TabsTrigger>
              <TabsTrigger value="uninstall" className="gap-1.5">
                <Trash2 className="h-4 w-4" />
                {t("nav.uninstall")}
              </TabsTrigger>
              <TabsTrigger value="packager" className="gap-1.5">
                <Package className="h-4 w-4" />
                {t("nav.packager")}
              </TabsTrigger>
              <TabsTrigger value="providers" className="gap-1.5">
                <Server className="h-4 w-4" />
                {t("nav.providers")}
              </TabsTrigger>
              <TabsTrigger value="models" className="gap-1.5">
                <Brain className="h-4 w-4" />
                {t("nav.models")}
              </TabsTrigger>
              <TabsTrigger value="config" className="gap-1.5">
                <FileJson className="h-4 w-4" />
                {t("nav.config")}
              </TabsTrigger>
            </TabsList>

            <div className="relative">
              <Button size="sm" onClick={() => setShowAddMenu(!showAddMenu)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                {t("provider.addProvider")}
              </Button>
              {showAddMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
                  <div className="absolute right-0 top-full mt-2 z-50 w-52 rounded-lg border bg-card shadow-lg p-1">
                    {PROVIDER_TYPES.map(({ value, icon }) => (
                      <button
                        key={value}
                        onClick={() => handleAdd(value)}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left"
                      >
                        <span>{icon}</span>
                        <span>{t(`provider.${value}`)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <TabsContent value="env">
            <EnvironmentCheck />
          </TabsContent>

          <TabsContent value="install">
            <Installer />
          </TabsContent>

          <TabsContent value="versions">
            <VersionManager />
          </TabsContent>

          <TabsContent value="gateway">
            <GatewayManager />
          </TabsContent>

          <TabsContent value="configmgr">
            <ConfigManager />
          </TabsContent>

          <TabsContent value="uninstall">
            <Uninstaller />
          </TabsContent>

          <TabsContent value="packager">
            <Packager />
          </TabsContent>

          <TabsContent value="providers">
            {store.providers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Server className="h-16 w-16 mb-4 opacity-30" />
                <p className="text-sm mb-4">{t("provider.noProviders")}</p>
                <div className="flex gap-2">
                  {PROVIDER_TYPES.map(({ value, icon }) => (
                    <Button key={value} variant="outline" size="sm" onClick={() => handleAdd(value)}>
                      <span className="mr-1">{icon}</span>
                      {t(`provider.${value}`)}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {store.providers.map((p) => (
                  <ProviderForm
                    key={p.id}
                    provider={p}
                    onUpdate={store.updateProvider}
                    onRemove={store.removeProvider}
                    onModelsFound={store.addModels}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="models">
            <ModelList
              models={store.models}
              providers={store.providers}
              onToggle={store.toggleModel}
              onToggleAll={store.toggleAllModels}
            />
          </TabsContent>

          <TabsContent value="config">
            <ConfigExport providers={store.providers} models={store.models} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
