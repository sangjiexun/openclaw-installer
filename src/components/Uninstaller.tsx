import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Shield,
  Package,
  Container,
  Layers,
  Monitor,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface UninstallStep {
  step: string;
  ok: boolean;
  message: string;
}

interface UninstallResult {
  ok: boolean;
  steps: UninstallStep[];
}

interface EnvCheckInstall {
  openclawInstalled: boolean;
  openclawVersion: string | null;
  openclawPath: string | null;
  dockerRunning: boolean;
  dockerContainer: string | null;
}

type UninstallMethod = "npm" | "pnpm" | "docker" | "vagrant" | "all";

const METHOD_ICONS: Record<UninstallMethod, React.ReactNode> = {
  npm: <Package className="h-5 w-5" />,
  pnpm: <Package className="h-5 w-5" />,
  docker: <Container className="h-5 w-5" />,
  vagrant: <Monitor className="h-5 w-5" />,
  all: <Layers className="h-5 w-5" />,
};

export function Uninstaller() {
  const { t } = useTranslation();
  const [installInfo, setInstallInfo] = useState<EnvCheckInstall | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMethod, setSelectedMethod] = useState<UninstallMethod>("all");
  const [removeData, setRemoveData] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [result, setResult] = useState<UninstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:3456/api/env-check");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInstallInfo(data.install);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    }
    setLoading(false);
  };

  useEffect(() => { fetchInfo(); }, []);

  const handleUninstall = async () => {
    setUninstalling(true);
    setResult(null);
    setConfirming(false);
    try {
      const res = await fetch("http://localhost:3456/api/uninstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: selectedMethod, removeData }),
      });
      setResult(await res.json());
    } catch (err) {
      setResult({ ok: false, steps: [{ step: "error", ok: false, message: err instanceof Error ? err.message : "Failed" }] });
    }
    setUninstalling(false);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-10 w-10 animate-spin mb-4 text-primary" />
        <p className="text-sm">{t("uninstaller.detecting")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <XCircle className="h-12 w-12 mb-4 text-destructive opacity-60" />
        <p className="text-sm mb-2 text-destructive">{error}</p>
        <Button variant="outline" onClick={fetchInfo} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          {t("env.recheck")}
        </Button>
      </div>
    );
  }

  const methods: UninstallMethod[] = ["npm", "pnpm", "docker", "vagrant", "all"];

  return (
    <div className="space-y-6">
      {/* Current install status */}
      <Card className={installInfo?.openclawInstalled ? "border-primary/30" : "border-muted"}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{t("uninstaller.currentInstall")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {installInfo?.openclawInstalled ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm">OpenClaw {installInfo.openclawVersion || ""}</span>
              </div>
              {installInfo.openclawPath && (
                <p className="text-xs text-muted-foreground font-mono pl-6">{installInfo.openclawPath}</p>
              )}
              {installInfo.dockerContainer && (
                <div className="flex items-center gap-2 pl-6">
                  <Container className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Docker: {installInfo.dockerContainer}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-muted-foreground">{t("uninstaller.notInstalled")}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Refresh */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={fetchInfo} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          {t("env.recheck")}
        </Button>
      </div>

      {/* Uninstall scope */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("uninstaller.scope")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("uninstaller.scopeDesc")}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {methods.map((method) => (
            <button
              key={method}
              onClick={() => setSelectedMethod(method)}
              className={`flex items-center gap-4 w-full p-3 rounded-lg border text-left transition-all ${
                selectedMethod === method
                  ? "border-destructive/50 bg-destructive/5"
                  : "border-border hover:border-muted-foreground/30"
              }`}
            >
              <div
                className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                  selectedMethod === method
                    ? "border-destructive bg-destructive"
                    : "border-input"
                }`}
              >
                {selectedMethod === method && (
                  <div className="h-2 w-2 rounded-full bg-white" />
                )}
              </div>
              <div className={`${selectedMethod === method ? "text-foreground" : "text-muted-foreground"}`}>
                {METHOD_ICONS[method]}
              </div>
              <div>
                <p className="text-sm font-medium">{t(`uninstaller.methods.${method}.title` as const)}</p>
                <p className="text-xs text-muted-foreground">{t(`uninstaller.methods.${method}.desc` as const)}</p>
              </div>
            </button>
          ))}

          {/* Remove data toggle */}
          <div className="flex items-start gap-3 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
            <Switch checked={removeData} onCheckedChange={setRemoveData} />
            <div>
              <Label className="text-sm font-medium">{t("uninstaller.removeData")}</Label>
              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-0.5">
                <AlertTriangle className="h-3 w-3 inline mr-1" />
                {t("uninstaller.removeDataWarn")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action */}
      <div className="flex items-center gap-3">
        {!confirming ? (
          <Button
            variant="destructive"
            onClick={() => setConfirming(true)}
            disabled={uninstalling}
            className="gap-1.5"
          >
            <Trash2 className="h-4 w-4" />
            {t("uninstaller.uninstall")}
          </Button>
        ) : (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm">{t("uninstaller.confirm")}</p>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleUninstall}
              disabled={uninstalling}
              className="gap-1.5 shrink-0"
            >
              {uninstalling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {uninstalling ? t("uninstaller.uninstalling") : t("uninstaller.uninstall")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
              className="shrink-0"
            >
              {t("common.cancel")}
            </Button>
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <Card className={result.ok ? "border-green-500/30" : "border-destructive/30"}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              {result.ok ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              )}
              <CardTitle className="text-base">
                {result.ok ? t("uninstaller.success") : t("uninstaller.failed")}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("uninstaller.steps")}
              </h4>
              {result.steps.map((step, i) => (
                <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    {step.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    <span className="text-sm font-mono">{step.step}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{step.message}</span>
                    <Badge
                      variant={step.ok ? "default" : "destructive"}
                      className={`text-xs ${step.ok ? "bg-green-600 hover:bg-green-600" : ""}`}
                    >
                      {step.ok ? t("uninstaller.stepOk") : t("uninstaller.stepFail")}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
