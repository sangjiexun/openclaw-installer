import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Terminal,
  Package,
  Container,
  Code2,
  Zap,
  RefreshCw,
  Settings2,
  ChevronUp,
  Monitor,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface PreflightMethod {
  id: string;
  available: boolean;
  reason: string | null;
  extra?: {
    vagrant?: string | null;
    virtualbox?: string | null;
    canAutoInstall?: boolean;
    packageManagers?: string[];
    missingVagrant?: boolean;
    missingVbox?: boolean;
    // Docker extras
    dockerInstalled?: boolean;
    dockerRunning?: boolean;
    hasCurl?: boolean;
  };
}

interface PreflightResult {
  platform: string;
  arch: string;
  nodeOk: boolean;
  openclawInstalled: boolean;
  methods: PreflightMethod[];
}

interface InstallResult {
  ok: boolean;
  message: string;
  onboard?: string;
  approve?: string;
}

interface DockerMirror {
  id: string;
  label: string;
  prefix: string;
}

const METHOD_ICONS: Record<string, React.ReactNode> = {
  script: <Terminal className="h-5 w-5" />,
  npm: <Package className="h-5 w-5" />,
  pnpm: <Package className="h-5 w-5" />,
  docker: <Container className="h-5 w-5" />,
  vagrant: <Monitor className="h-5 w-5" />,
  source: <Code2 className="h-5 w-5" />,
};

const METHOD_RECOMMENDED: Record<string, boolean> = {
  script: true,
  npm: false,
  pnpm: false,
  docker: false,
  vagrant: false,
  source: false,
};

export function Installer() {
  const { t } = useTranslation();
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Docker options
  const [dockerMirrors, setDockerMirrors] = useState<DockerMirror[]>([]);
  const [selectedMirror, setSelectedMirror] = useState("daocloud");
  const [customRegistry, setCustomRegistry] = useState("");
  const [dockerImage, setDockerImage] = useState("openclaw/openclaw:latest");
  const [dockerPort, setDockerPort] = useState("18789");
  const [containerName, setContainerName] = useState("openclaw");
  const [dockerMode, setDockerMode] = useState<"build" | "pull">("build");
  const [buildTag, setBuildTag] = useState("openclaw:local");

  // npm options
  const [npmRegistry, setNpmRegistry] = useState("");

  // Vagrant options
  const [vagrantOs, setVagrantOs] = useState<"kali" | "windows">("kali");
  const [vmMemory, setVmMemory] = useState("4096");
  const [vmCpus, setVmCpus] = useState("2");
  const [vmPort, setVmPort] = useState("18789");
  const [vmGui, setVmGui] = useState(false);
  const [chinaMirror, setChinaMirror] = useState(true);

  // Vagrant streaming progress
  const [vagrantProgress, setVagrantProgress] = useState(0);
  const [vagrantLogs, setVagrantLogs] = useState<string[]>([]);
  const [vagrantStep, setVagrantStep] = useState("");

  // Source-zip options
  const [useZipSource, setUseZipSource] = useState(true);
  const [zipVersion, setZipVersion] = useState("latest");

  // Auto-install deps
  const [installingDeps, setInstallingDeps] = useState(false);
  const [depsResult, setDepsResult] = useState<{ ok: boolean; steps: Array<{ target: string; ok: boolean; message: string }> } | null>(null);

  // Expanded options per method
  const [expandedOptions, setExpandedOptions] = useState<string | null>(null);

  const fetchPreflight = async () => {
    setLoading(true);
    setError(null);
    try {
      const [preRes, mirrorRes] = await Promise.all([
        fetch("http://localhost:3456/api/install/preflight"),
        fetch("http://localhost:3456/api/docker/mirrors"),
      ]);
      if (!preRes.ok) throw new Error(`HTTP ${preRes.status}`);
      setPreflight(await preRes.json());
      if (mirrorRes.ok) {
        const data = await mirrorRes.json();
        setDockerMirrors(data.mirrors || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPreflight();
  }, []);

  const handleInstall = async (method: string) => {
    setInstalling(method);
    setResult(null);
    setVagrantProgress(0);
    setVagrantLogs([]);
    setVagrantStep("");

    try {
      const options: Record<string, string> = {};
      if (method === "docker") {
        options.dockerMode = dockerMode;
        options.dockerMirror = selectedMirror;
        options.customRegistry = customRegistry;
        options.dockerImage = dockerImage;
        options.port = dockerPort;
        options.containerName = containerName;
        options.buildTag = buildTag;
      }
      if (method === "npm" || method === "pnpm") {
        options.npmRegistry = npmRegistry;
      }
      if (method === "vagrant") {
        options.vagrantOs = vagrantOs;
        options.vmMemory = vmMemory;
        options.vmCpus = vmCpus;
        options.vmPort = vmPort;
        options.vmGui = vmGui ? "true" : "false";
        options.chinaMirror = chinaMirror ? "true" : "false";
      }
      if (method === "source") {
        options.chinaMirror = chinaMirror ? "true" : "false";
      }

      // Route source+zip through the dedicated endpoint
      if (method === "source" && useZipSource) {
        const res = await fetch("http://localhost:3456/api/install/source-zip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: zipVersion || "latest" }),
        });
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            let eventType = "";
            for (const line of lines) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7);
              } else if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (eventType === "log") setVagrantLogs((p) => [...p.slice(-100), data.text]);
                  else if (eventType === "step") setVagrantStep(data.message);
                  else if (eventType === "done") setResult({ ok: data.ok, message: data.message || "" });
                } catch { /* ignore */ }
              }
            }
          }
        }
        setInstalling(null);
        return;
      }

      const actualMethod =
        method === "script"
          ? `script-${preflight?.platform === "win32" ? "win" : "mac"}`
          : method;

      const res = await fetch("http://localhost:3456/api/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: actualMethod, options }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let eventType = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7);
            } else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (eventType === "progress") {
                  setVagrantProgress(data.percent);
                } else if (eventType === "log") {
                  setVagrantLogs((prev) => [...prev.slice(-100), data.text]);
                } else if (eventType === "step") {
                  setVagrantStep(data.message);
                  if (data.status === "error") {
                    setResult({ ok: false, message: data.message });
                  }
                } else if (eventType === "done") {
                  setResult({ ok: data.ok, message: data.message || "" });
                }
              } catch { /* ignore parse errors */ }
            }
          }
        }
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Install failed" });
    }
    setInstalling(null);
  };

  const toggleOptions = (id: string) => {
    setExpandedOptions(expandedOptions === id ? null : id);
  };

  const handleAutoInstallDeps = async (pm: string, targets: string[]) => {
    setInstallingDeps(true);
    setDepsResult(null);
    try {
      const res = await fetch("http://localhost:3456/api/install/deps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageManager: pm, targets }),
      });
      const data = await res.json();
      setDepsResult(data);
      if (data.ok) {
        // Refresh preflight to pick up newly installed deps
        setTimeout(() => fetchPreflight(), 1000);
      }
    } catch (err) {
      setDepsResult({ ok: false, steps: [{ target: "error", ok: false, message: err instanceof Error ? err.message : "Failed" }] });
    }
    setInstallingDeps(false);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-10 w-10 animate-spin mb-4 text-primary" />
        <p className="text-sm">{t("installer.detecting")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <XCircle className="h-12 w-12 mb-4 text-destructive opacity-60" />
        <p className="text-sm mb-2 text-destructive">{error}</p>
        <p className="text-xs mb-4">
          {t("installer.startServer")}{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded">node server.mjs</code>
        </p>
        <Button variant="outline" onClick={fetchPreflight} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          {t("env.recheck")}
        </Button>
      </div>
    );
  }

  if (!preflight) return null;

  const renderMethodOptions = (methodId: string) => {
    if (expandedOptions !== methodId) return null;

    if (methodId === "docker") {
      return (
        <div className="mt-3 pt-3 border-t space-y-3">
          {/* Build / Pull mode toggle */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("installer.docker.mode")}</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDockerMode("build")}
                className={`px-3 py-2.5 rounded-md border text-left transition-all ${
                  dockerMode === "build"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-input hover:border-muted-foreground/40 text-muted-foreground"
                }`}
              >
                <p className="text-xs font-medium">{t("installer.docker.modeBuild")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("installer.docker.modeBuildDesc")}</p>
              </button>
              <button
                onClick={() => setDockerMode("pull")}
                className={`px-3 py-2.5 rounded-md border text-left transition-all ${
                  dockerMode === "pull"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-input hover:border-muted-foreground/40 text-muted-foreground"
                }`}
              >
                <p className="text-xs font-medium">{t("installer.docker.modePull")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("installer.docker.modePullDesc")}</p>
              </button>
            </div>
          </div>

          {dockerMode === "build" ? (
            <>
              {/* Build tag */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("installer.docker.buildTag")}</Label>
                <Input
                  value={buildTag}
                  onChange={(e) => setBuildTag(e.target.value)}
                  className="text-xs font-mono"
                />
                <p className="text-xs text-muted-foreground">{t("installer.docker.buildTagHint")}</p>
              </div>
            </>
          ) : (
            <>
              {/* Mirror selector */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("installer.docker.mirror")}</Label>
                <div className="grid grid-cols-3 gap-2">
                  {dockerMirrors.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedMirror(m.id)}
                      className={`px-3 py-2 rounded-md border text-xs text-left transition-all ${
                        selectedMirror === m.id
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-input hover:border-muted-foreground/40 text-muted-foreground"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom registry input */}
              {selectedMirror === "custom" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("installer.docker.customRegistry")}</Label>
                  <Input
                    placeholder="registry.example.com"
                    value={customRegistry}
                    onChange={(e) => setCustomRegistry(e.target.value)}
                    className="text-xs"
                  />
                </div>
              )}

              {/* Image name */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("installer.docker.image")}</Label>
                <Input
                  value={dockerImage}
                  onChange={(e) => setDockerImage(e.target.value)}
                  className="text-xs font-mono"
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* Container name */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("installer.docker.containerName")}</Label>
              <Input
                value={containerName}
                onChange={(e) => setContainerName(e.target.value)}
                className="text-xs"
              />
            </div>
            {/* Port */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("installer.docker.port")}</Label>
              <Input
                value={dockerPort}
                onChange={(e) => setDockerPort(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          {/* Daemon mirror hint (only for pull mode) */}
          {dockerMode === "pull" && (
            <div className="p-2.5 rounded-md bg-muted/50 border">
              <p className="text-xs text-muted-foreground">
                <AlertTriangle className="h-3 w-3 inline mr-1 text-yellow-500" />
                {t("installer.docker.daemonHint")}
              </p>
              <pre className="mt-1.5 text-xs font-mono text-muted-foreground leading-relaxed">
{`// ~/.docker/daemon.json
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://docker.mirrors.ustc.edu.cn"
  ]
}`}
              </pre>
            </div>
          )}
        </div>
      );
    }

    if (methodId === "npm" || methodId === "pnpm") {
      return (
        <div className="mt-3 pt-3 border-t space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("installer.npm.registry")}</Label>
            <Input
              placeholder="https://registry.npmmirror.com"
              value={npmRegistry}
              onChange={(e) => setNpmRegistry(e.target.value)}
              className="text-xs font-mono"
            />
            <p className="text-xs text-muted-foreground">{t("installer.npm.registryHint")}</p>
          </div>
        </div>
      );
    }

    if (methodId === "vagrant") {
      const isVagrantRunning = installing === "vagrant";
      return (
        <div className="mt-3 pt-3 border-t space-y-3">
          {/* OS selector */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("installer.vagrant.os")}</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setVagrantOs("kali")}
                className={`px-3 py-3 rounded-md border text-left transition-all ${
                  vagrantOs === "kali"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-input hover:border-muted-foreground/40 text-muted-foreground"
                }`}
              >
                <p className="text-sm font-medium">🐉 Kali Linux</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("installer.vagrant.kaliDesc")}</p>
              </button>
              <button
                onClick={() => setVagrantOs("windows")}
                className={`px-3 py-3 rounded-md border text-left transition-all ${
                  vagrantOs === "windows"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-input hover:border-muted-foreground/40 text-muted-foreground"
                }`}
              >
                <p className="text-sm font-medium">🪟 Windows 10</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t("installer.vagrant.windowsDesc")}</p>
              </button>
            </div>
          </div>

          {/* China mirror toggle */}
          <div className="flex items-center gap-3 p-2.5 rounded-md bg-muted/50 border">
            <input
              type="checkbox"
              id="china-mirror"
              checked={chinaMirror}
              onChange={(e) => setChinaMirror(e.target.checked)}
              className="rounded border-input"
            />
            <div>
              <Label htmlFor="china-mirror" className="text-xs font-medium">{t("installer.vagrant.chinaMirror")}</Label>
              <p className="text-xs text-muted-foreground">{t("installer.vagrant.chinaMirrorDesc")}</p>
            </div>
          </div>

          {/* VM resources */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("installer.vagrant.memory")}</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={vmMemory}
                onChange={(e) => setVmMemory(e.target.value)}
              >
                <option value="2048">2 GB</option>
                <option value="4096">4 GB</option>
                <option value="8192">8 GB</option>
                <option value="16384">16 GB</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("installer.vagrant.cpus")}</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={vmCpus}
                onChange={(e) => setVmCpus(e.target.value)}
              >
                <option value="1">1 Core</option>
                <option value="2">2 Cores</option>
                <option value="4">4 Cores</option>
                <option value="8">8 Cores</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("installer.vagrant.port")}</Label>
              <Input
                value={vmPort}
                onChange={(e) => setVmPort(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          {/* GUI toggle for Windows */}
          {vagrantOs === "windows" && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="vm-gui"
                checked={vmGui}
                onChange={(e) => setVmGui(e.target.checked)}
                className="rounded border-input"
              />
              <Label htmlFor="vm-gui" className="text-xs">{t("installer.vagrant.gui")}</Label>
            </div>
          )}

          {/* Info box */}
          {!isVagrantRunning && (
            <div className="p-2.5 rounded-md bg-muted/50 border">
              <p className="text-xs text-muted-foreground">
                <AlertTriangle className="h-3 w-3 inline mr-1 text-yellow-500" />
                {vagrantOs === "kali" ? t("installer.vagrant.kaliNote") : t("installer.vagrant.windowsNote")}
              </p>
            </div>
          )}
        </div>
      );
    }

    if (methodId === "source") {
      return (
        <div className="mt-3 pt-3 border-t space-y-3">
          {/* Zip source toggle */}
          <div className="flex items-center gap-3 p-2.5 rounded-md bg-primary/5 border border-primary/20">
            <input
              type="checkbox"
              id="source-use-zip"
              checked={useZipSource}
              onChange={(e) => setUseZipSource(e.target.checked)}
              className="rounded border-input"
            />
            <div className="flex-1">
              <Label htmlFor="source-use-zip" className="text-xs font-medium">
                {t("installer.source.zipSource")} <span className="text-primary font-normal">(hunyuandata.cn)</span>
              </Label>
              <p className="text-xs text-muted-foreground">{t("installer.source.zipSourceDesc")}</p>
            </div>
          </div>

          {useZipSource && (
            <div className="space-y-1.5">
              <Label htmlFor="zip-version" className="text-xs font-medium">{t("installer.source.zipVersion")}</Label>
              <Input
                id="zip-version"
                value={zipVersion}
                onChange={(e) => setZipVersion(e.target.value)}
                placeholder="latest"
                className="h-7 text-xs font-mono"
              />
              <p className="text-xs text-muted-foreground">{t("installer.source.zipVersionHint")}</p>
            </div>
          )}

          {!useZipSource && (
            <div className="flex items-center gap-3 p-2.5 rounded-md bg-muted/50 border">
              <input
                type="checkbox"
                id="source-china-mirror"
                checked={chinaMirror}
                onChange={(e) => setChinaMirror(e.target.checked)}
                className="rounded border-input"
              />
              <div>
                <Label htmlFor="source-china-mirror" className="text-xs font-medium">{t("installer.source.chinaMirror")}</Label>
                <p className="text-xs text-muted-foreground">{t("installer.source.chinaMirrorDesc")}</p>
              </div>
            </div>
          )}

          <div className="p-2.5 rounded-md bg-muted/50 border">
            <p className="text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3 inline mr-1 text-yellow-500" />
              {t("installer.source.requirements")}
            </p>
            <p className="text-xs font-mono text-muted-foreground mt-1">pnpm, Node.js 22+</p>
          </div>
        </div>
      );
    }

    return null;
  };

  const hasOptions = (id: string) => id === "docker" || id === "npm" || id === "pnpm" || id === "vagrant" || id === "source";

  return (
    <div className="space-y-6">
      {/* Status banner */}
      {preflight.openclawInstalled && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-sm font-medium">{t("installer.alreadyInstalled")}</p>
                <p className="text-xs text-muted-foreground">{t("installer.reinstall")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Refresh */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={fetchPreflight} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />
          {t("env.recheck")}
        </Button>
      </div>

      {/* Install methods */}
      <div className="grid gap-4">
        {preflight.methods.map((method) => {
          const isInstalling = installing === method.id;
          const isRecommended = METHOD_RECOMMENDED[method.id];
          const isExpanded = expandedOptions === method.id;
          return (
            <Card
              key={method.id}
              className={`transition-all ${
                method.available ? "hover:border-primary/40" : "opacity-60"
              } ${isRecommended && method.available ? "border-primary/30 bg-primary/[0.02]" : ""}`}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div
                      className={`mt-0.5 ${method.available ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {METHOD_ICONS[method.id]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <h3 className="text-sm font-medium">
                          {t(`installer.methods.${method.id}.title` as const)}
                        </h3>
                        <Badge variant="secondary" className="text-xs">
                          {t(`installer.methods.${method.id}.badge` as const)}
                        </Badge>
                        {isRecommended && method.available && (
                          <Badge className="text-xs bg-primary/90 gap-1">
                            <Zap className="h-3 w-3" />
                            {t("installer.recommended")}
                          </Badge>
                        )}
                        {method.available ? (
                          <Badge className="text-xs bg-green-600 hover:bg-green-600">
                            {t("installer.methodAvailable")}
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            {t("installer.methodUnavailable")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t(`installer.methods.${method.id}.desc` as const)}
                      </p>
                      {!method.available && method.reason && (
                        <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {method.reason}
                        </p>
                      )}
                      {/* Auto-install Docker via BT Panel */}
                      {method.id === "docker" && !method.available && method.extra?.canAutoInstall && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!installing}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleInstall("btpanel-docker");
                            }}
                            className="gap-1.5 text-xs h-7"
                          >
                            {installing === "btpanel-docker" ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                            {t("installer.docker.btpanelInstall")}
                          </Button>
                          <span className="text-xs text-muted-foreground">{t("installer.docker.btpanelDesc")}</span>
                        </div>
                      )}
                      {/* Auto-install deps button for vagrant */}
                      {method.id === "vagrant" && !method.available && method.extra?.canAutoInstall && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {method.extra.packageManagers?.map((pm) => {
                            const targets: string[] = [];
                            if (method.extra?.missingVagrant) targets.push("vagrant");
                            if (method.extra?.missingVbox) targets.push("virtualbox");
                            return (
                              <Button
                                key={pm}
                                size="sm"
                                variant="outline"
                                disabled={installingDeps}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAutoInstallDeps(pm, targets);
                                }}
                                className="gap-1.5 text-xs h-7"
                              >
                                {installingDeps ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Download className="h-3 w-3" />
                                )}
                                {t("installer.vagrant.autoInstall", { pm })}
                              </Button>
                            );
                          })}
                        </div>
                      )}
                      {/* Auto-install result */}
                      {method.id === "vagrant" && depsResult && (
                        <div className={`mt-2 p-2 rounded-md text-xs ${depsResult.ok ? "bg-green-500/10 border border-green-500/30" : "bg-destructive/10 border border-destructive/30"}`}>
                          {depsResult.steps.map((s, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              {s.ok ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <XCircle className="h-3 w-3 text-destructive" />}
                              <span>{s.message}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-4">
                    {hasOptions(method.id) && method.available && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleOptions(method.id)}
                        className="h-8 w-8"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <Settings2 className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={!method.available || !!installing}
                      onClick={() => handleInstall(method.id)}
                      className="gap-1.5"
                    >
                      {isInstalling ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {isInstalling ? t("installer.installing") : t("installer.install")}
                    </Button>
                  </div>
                </div>
                {renderMethodOptions(method.id)}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Universal progress panel — visible during any install */}
      {installing && (
        <Card className="border-primary/30">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                {vagrantStep || t("installer.installing")}
              </span>
              <span className="font-mono font-medium text-primary">{vagrantProgress}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${Math.max(vagrantProgress, 2)}%` }}
              />
            </div>
            {vagrantLogs.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md bg-muted/30 border p-2 scroll-smooth" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
                {vagrantLogs.map((line, i) => (
                  <p key={i} className="text-xs font-mono text-muted-foreground leading-relaxed">{line}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Install result */}
      {result && !installing && (
        <Card className={result.ok ? "border-green-500/30" : "border-destructive/30"}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              {result.ok ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              <CardTitle className="text-base">
                {result.ok ? t("installer.installSuccess") : t("installer.installFailed")}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="p-3 rounded-lg bg-muted/50 border text-xs overflow-auto max-h-80 leading-relaxed whitespace-pre-wrap">
              {result.message}
              {result.onboard && `\n\n--- Onboard ---\n${result.onboard}`}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
