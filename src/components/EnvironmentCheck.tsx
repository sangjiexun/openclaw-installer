import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Monitor,
  FolderOpen,
  Key,
  Wifi,
  Package,
  BookOpen,
  Lightbulb,
  Copy,
  CheckCheck,
  Terminal,
  HardDrive,
  Cpu,
  MemoryStick,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type CheckStatus = "pass" | "warn" | "fail" | "unknown";

interface EnvVar {
  name: string;
  set: boolean;
  value?: string | null;
  desc: string;
}

interface EnvCheckResult {
  runtime: {
    nodeVersion: string | null;
    nodeOk: boolean;
    nodeRecommended: boolean;
    nodeExecPath: string | null;
    platform: string;
    arch: string;
    cpus: number;
    totalMemory: number;
    pathEnv: string;
  };
  deps: Record<string, string | null>;
  config: Record<string, { path: string; exists: boolean; permissions?: string | null }>;
  network: Record<string, { port: number; listening: boolean }>;
  envVars: Record<string, EnvVar[]>;
  tips: string[];
}

function StatusIcon({ status }: { status: CheckStatus }) {
  switch (status) {
    case "pass":
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case "warn":
      return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
    case "fail":
      return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    default:
      return <div className="h-4 w-4 rounded-full bg-muted shrink-0" />;
  }
}

function StatusBadge({ status, label }: { status: CheckStatus; label: string }) {
  const variant =
    status === "pass" ? "default" : status === "warn" ? "secondary" : "destructive";
  const className =
    status === "pass"
      ? "bg-green-600 hover:bg-green-600"
      : status === "warn"
        ? "bg-yellow-600 text-white hover:bg-yellow-600"
        : "";
  return (
    <Badge variant={variant} className={`text-xs ${className}`}>
      {label}
    </Badge>
  );
}

function CheckRow({
  label,
  value,
  status,
  description,
}: {
  label: string;
  value: string;
  status: CheckStatus;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-3 min-w-0">
        <StatusIcon status={status} />
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <span className="text-sm text-muted-foreground font-mono shrink-0 ml-4">{value}</span>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <pre className="p-3 rounded-lg bg-muted/50 border text-xs overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1 rounded bg-muted border opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? (
          <CheckCheck className="h-3 w-3 text-green-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}

export function EnvironmentCheck() {
  const { t } = useTranslation();
  const [result, setResult] = useState<EnvCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:3456/api/env-check");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult(await res.json());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect to environment check server",
      );
    }
    setLoading(false);
  };

  // Not yet checked
  if (!result && !loading && !error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Monitor className="h-16 w-16 mb-4 opacity-30" />
        <p className="text-sm mb-2">{t("env.subtitle")}</p>
        <p className="text-xs mb-6 text-muted-foreground/70">
          {t("env.install.title")} → node server.mjs
        </p>
        <Button onClick={runCheck} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          {t("env.runCheck")}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-10 w-10 animate-spin mb-4 text-primary" />
        <p className="text-sm">{t("env.checking")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <XCircle className="h-12 w-12 mb-4 text-destructive opacity-60" />
        <p className="text-sm mb-2 text-destructive">{error}</p>
        <p className="text-xs mb-4">Start the check server: <code className="bg-muted px-1.5 py-0.5 rounded">node server.mjs</code></p>
        <Button variant="outline" onClick={runCheck} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          {t("env.recheck")}
        </Button>
      </div>
    );
  }

  if (!result) return null;

  const r = result;

  return (
    <div className="space-y-6">
      {/* Re-check button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={runCheck} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("env.recheck")}
        </Button>
      </div>

      {/* Runtime Environment */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{t("env.sections.runtime")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          <CheckRow
            label={t("env.checks.nodeVersion")}
            value={r.runtime.nodeVersion ? `v${r.runtime.nodeVersion}` : "Not found"}
            status={r.runtime.nodeOk ? (r.runtime.nodeRecommended ? "pass" : "warn") : "fail"}
            description={t("env.checks.nodeVersionDesc")}
          />
          <CheckRow
            label={t("env.checks.nodeExecPath")}
            value={r.runtime.nodeExecPath || "N/A"}
            status={r.runtime.nodeExecPath ? "pass" : "fail"}
          />
          <CheckRow
            label={t("env.checks.platform")}
            value={`${r.runtime.platform} (${r.runtime.arch})`}
            status="pass"
          />
          <div className="flex items-start justify-between py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="flex items-start gap-3">
              <Cpu className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm">CPU</p>
            </div>
            <span className="text-sm text-muted-foreground font-mono">{r.runtime.cpus} cores</span>
          </div>
          <div className="flex items-start justify-between py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="flex items-start gap-3">
              <MemoryStick className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm">Memory</p>
            </div>
            <span className="text-sm text-muted-foreground font-mono">{r.runtime.totalMemory} GB</span>
          </div>
        </CardContent>
      </Card>

      {/* Dependencies */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{t("env.sections.deps")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {Object.entries(r.deps).map(([key, val]) => (
            <CheckRow
              key={key}
              label={t(`env.checks.${key}` as const) || key}
              value={val || "Not installed"}
              status={val ? "pass" : key === "pnpm" || key === "bun" ? "warn" : key === "npm" || key === "git" ? "fail" : "warn"}
            />
          ))}
        </CardContent>
      </Card>

      {/* Config Paths */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{t("env.sections.config")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {Object.entries(r.config).map(([key, val]) => {
            const descKey = `env.checks.${key === "stateDir" ? "configDir" : key === "configFile" ? "configFile" : key === "credentials" ? "credentialsDir" : "workspaceDir"}Desc` as const;
            let extraInfo = val.path;
            if (val.permissions) extraInfo += ` (${val.permissions})`;
            return (
              <CheckRow
                key={key}
                label={t(`env.checks.${key === "stateDir" ? "configDir" : key === "configFile" ? "configFile" : key === "credentials" ? "credentialsDir" : "workspaceDir"}` as const)}
                value={val.exists ? "✓ exists" : "✗ missing"}
                status={val.exists ? (key === "configFile" && val.permissions && val.permissions !== "600" ? "warn" : "pass") : key === "stateDir" ? "fail" : "warn"}
                description={t(descKey)}
              />
            );
          })}
        </CardContent>
      </Card>

      {/* Network */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{t("env.sections.network")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          <CheckRow
            label={t("env.checks.gatewayPort")}
            value={r.network.gatewayPort.listening ? `:${r.network.gatewayPort.port} active` : `:${r.network.gatewayPort.port} inactive`}
            status={r.network.gatewayPort.listening ? "pass" : "warn"}
            description={t("env.checks.gatewayPortDesc")}
          />
          <CheckRow
            label={t("env.checks.ollamaService")}
            value={r.network.ollamaService.listening ? `:${r.network.ollamaService.port} active` : `:${r.network.ollamaService.port} inactive`}
            status={r.network.ollamaService.listening ? "pass" : "warn"}
            description={t("env.checks.ollamaServiceDesc")}
          />
        </CardContent>
      </Card>

      {/* Environment Variables */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{t("env.sections.envVars")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {Object.entries(r.envVars).map(([group, vars]) => (
            <div key={group} className="mb-4 last:mb-0">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
                {t(`env.envVarGroups.${group}` as const)}
              </h4>
              <div className="space-y-0.5">
                {vars.map((v) => (
                  <div
                    key={v.name}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <StatusIcon status={v.set ? "pass" : "unknown"} />
                      <div>
                        <code className="text-xs font-mono">{v.name}</code>
                        <p className="text-xs text-muted-foreground">{v.desc}</p>
                      </div>
                    </div>
                    <StatusBadge
                      status={v.set ? "pass" : "unknown"}
                      label={v.set ? t("env.envVarTable.set") : t("env.envVarTable.notSet")}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Optimization Tips */}
      {r.tips.length > 0 && (
        <Card className="border-yellow-500/30">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-yellow-500" />
              <CardTitle className="text-base">{t("env.tips.title")}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {r.tips.map((tip) => (
                <li key={tip} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                  <span>{t(`env.tips.${tip}` as const)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Install Guide */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">{t("env.install.title")}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Installer script */}
          <div>
            <h4 className="text-sm font-medium mb-1 flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              {t("env.install.scriptTitle")}
            </h4>
            <p className="text-xs text-muted-foreground mb-2">{t("env.install.scriptDesc")}</p>
            <CodeBlock
              code={`# macOS / Linux / WSL2\ncurl -fsSL https://openclaw.ai/install.sh | bash\n\n# Windows (PowerShell)\niwr -useb https://openclaw.ai/install.ps1 | iex`}
            />
          </div>

          {/* npm */}
          <div>
            <h4 className="text-sm font-medium mb-1 flex items-center gap-2">
              <Package className="h-4 w-4" />
              {t("env.install.npmTitle")}
            </h4>
            <p className="text-xs text-muted-foreground mb-2">{t("env.install.npmDesc")}</p>
            <CodeBlock code={`npm install -g openclaw@latest\nopenclaw onboard --install-daemon`} />
          </div>

          {/* From source */}
          <div>
            <h4 className="text-sm font-medium mb-1 flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              {t("env.install.sourceTitle")}
            </h4>
            <p className="text-xs text-muted-foreground mb-2">{t("env.install.sourceDesc")}</p>
            <CodeBlock
              code={`git clone https://github.com/openclaw/openclaw.git\ncd openclaw\npnpm install && pnpm ui:build && pnpm build\npnpm link --global\nopenclaw onboard --install-daemon`}
            />
          </div>

          {/* Offline */}
          <div>
            <h4 className="text-sm font-medium mb-1 flex items-center gap-2">
              <Wifi className="h-4 w-4" />
              {t("env.install.offlineTitle")}
            </h4>
            <p className="text-xs text-muted-foreground mb-2">{t("env.install.offlineDesc")}</p>
            <div className="space-y-1.5 text-sm pl-2">
              <p>1. {t("env.install.offlineSteps.step1")}</p>
              <p>2. {t("env.install.offlineSteps.step2")}</p>
              <p>3. {t("env.install.offlineSteps.step3")}</p>
              <p>4. {t("env.install.offlineSteps.step4")}</p>
            </div>
            <div className="mt-2">
              <CodeBlock
                code={`# On a machine with internet access:\nnpm pack openclaw@latest\n\n# Transfer openclaw-<version>.tgz to target machine, then:\nnpm install -g openclaw-<version>.tgz\nopenclaw onboard --install-daemon`}
              />
            </div>
          </div>

          {/* Docker */}
          <div>
            <h4 className="text-sm font-medium mb-1 flex items-center gap-2">
              <Package className="h-4 w-4" />
              {t("env.install.dockerTitle")}
            </h4>
            <p className="text-xs text-muted-foreground mb-2">{t("env.install.dockerDesc")}</p>
            <CodeBlock
              code={`docker pull openclaw/openclaw:latest\ndocker run -d --name openclaw \\\n  -v ~/.openclaw:/root/.openclaw \\\n  -p 18789:18789 \\\n  openclaw/openclaw:latest`}
            />
          </div>

          {/* Env setup */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium mb-1">{t("env.install.envSetup")}</h4>
            <p className="text-xs text-muted-foreground mb-2">{t("env.install.envSetupDesc")}</p>
            <div className="space-y-1.5 text-sm pl-2 mb-2">
              <p>1. {t("env.install.envSetupSteps.step1")}</p>
              <p>2. {t("env.install.envSetupSteps.step2")}</p>
              <p>3. {t("env.install.envSetupSteps.step3")}</p>
            </div>
            <CodeBlock
              code={`cp .env.example ~/.openclaw/.env\n# Edit ~/.openclaw/.env and fill in your keys\nchmod 600 ~/.openclaw/.env\nopenclaw onboard`}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
