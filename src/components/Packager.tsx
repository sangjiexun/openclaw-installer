import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Package,
  Loader2,
  CheckCircle2,
  XCircle,
  Download,
  RefreshCw,
  HardDrive,
  Monitor,
  Container,
  Settings2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface BuiltPackage {
  name: string;
  size: number;
  created: string;
}

const API = "http://localhost:3456";

const TARGETS = [
  { id: "docker", label: "Docker" },
  { id: "vagrant-kali", label: "Vagrant (Kali Linux)" },
  { id: "vagrant-windows", label: "Vagrant (Windows 10)" },
  { id: "windows-x64", label: "Windows 10 x64" },
  { id: "windows-x86", label: "Windows 10 x86" },
  { id: "redhat", label: "Red Hat / CentOS" },
  { id: "uos", label: "统信 UOS" },
  { id: "ubuntukylin", label: "优麒麟 Ubuntu Kylin" },
  { id: "macos", label: "🍎 macOS" },
];

const TARGET_ICONS: Record<string, React.ReactNode> = {
  docker: <Container className="h-5 w-5" />,
  "vagrant-kali": <Monitor className="h-5 w-5" />,
  "vagrant-windows": <Monitor className="h-5 w-5" />,
  "windows-x64": <HardDrive className="h-5 w-5" />,
  "windows-x86": <HardDrive className="h-5 w-5" />,
  redhat: <HardDrive className="h-5 w-5" />,
  uos: <HardDrive className="h-5 w-5" />,
  ubuntukylin: <HardDrive className="h-5 w-5" />,
  macos: <HardDrive className="h-5 w-5" />,
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function Packager() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set(["docker"]));
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [stepMsg, setStepMsg] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [packages, setPackages] = useState<BuiltPackage[]>([]);
  const [loadingPkgs, setLoadingPkgs] = useState(true);
  const [showOptions, setShowOptions] = useState(false);

  // Options
  const [envVars, setEnvVars] = useState("");
  const [installDir, setInstallDir] = useState("/opt/openclaw");
  const [nodeVersion, setNodeVersion] = useState("24");

  const fetchPackages = async () => {
    setLoadingPkgs(true);
    try {
      const res = await fetch(`${API}/api/packager/list`);
      if (res.ok) {
        const data = await res.json();
        setPackages(data.packages || []);
      }
    } catch { /* ignore */ }
    setLoadingPkgs(false);
  };

  useEffect(() => { fetchPackages(); }, []);

  const toggleTarget = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === TARGETS.length) setSelected(new Set());
    else setSelected(new Set(TARGETS.map((t) => t.id)));
  };

  const handleBuild = async () => {
    if (selected.size === 0) return;
    setBuilding(true);
    setProgress(0);
    setLogs([]);
    setStepMsg("");
    setResult(null);

    try {
      const res = await fetch(`${API}/api/packager/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: Array.from(selected),
          envVars: envVars.trim() || undefined,
          installDir,
          nodeVersion,
        }),
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
                  setProgress(data.percent);
                  if (data.line) setStepMsg(data.line);
                } else if (eventType === "log") {
                  setLogs((prev) => [...prev.slice(-200), data.text]);
                } else if (eventType === "step") {
                  setStepMsg(data.message);
                } else if (eventType === "done") {
                  setResult({ ok: data.ok, message: data.message || "" });
                }
              } catch { /* ignore */ }
            }
          }
        }
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Build failed" });
    }
    setBuilding(false);
    fetchPackages();
  };

  return (
    <div className="space-y-6">
      {/* Target selection */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">{t("packager.selectTargets")}</CardTitle>
            </div>
            <Button variant="outline" size="sm" onClick={selectAll} className="text-xs">
              {selected.size === TARGETS.length ? t("packager.deselectAll") : t("packager.selectAll")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("packager.selectDesc")}</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {TARGETS.map((tgt) => (
              <button
                key={tgt.id}
                onClick={() => toggleTarget(tgt.id)}
                disabled={building}
                className={`flex items-center gap-2.5 p-3 rounded-lg border text-left transition-all ${
                  selected.has(tgt.id)
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-input hover:border-muted-foreground/40 text-muted-foreground"
                } ${building ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className={selected.has(tgt.id) ? "text-primary" : "text-muted-foreground"}>
                  {TARGET_ICONS[tgt.id]}
                </div>
                <div>
                  <p className="text-xs font-medium leading-tight">{tgt.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t(`packager.targets.${tgt.id}` as const)}</p>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Options */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowOptions(!showOptions)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">{t("packager.options")}</CardTitle>
            </div>
            {showOptions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </CardHeader>
        {showOptions && (
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("packager.installDir")}</Label>
                <Input value={installDir} onChange={(e) => setInstallDir(e.target.value)} className="text-xs font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("packager.nodeVer")}</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={nodeVersion} onChange={(e) => setNodeVersion(e.target.value)}
                >
                  <option value="22">Node 22 LTS</option>
                  <option value="24">Node 24</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("packager.envVars")}</Label>
              <Input placeholder="KEY1=val1,KEY2=val2" value={envVars} onChange={(e) => setEnvVars(e.target.value)} className="text-xs font-mono" />
              <p className="text-xs text-muted-foreground">{t("packager.envVarsHint")}</p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Build button */}
      <div className="flex items-center gap-3">
        <Button onClick={handleBuild} disabled={building || selected.size === 0} className="gap-1.5">
          {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
          {building ? t("packager.building") : t("packager.build")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("packager.selectedCount", { count: selected.size })}
        </span>
      </div>

      {/* Progress */}
      {building && (
        <Card className="border-primary/30">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                {stepMsg || t("packager.building")}
              </span>
              <span className="font-mono font-medium text-primary">{progress}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-300 ease-out" style={{ width: `${Math.max(progress, 2)}%` }} />
            </div>
            {logs.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md bg-muted/30 border p-2 scroll-smooth" ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
                {logs.map((line, i) => (
                  <p key={i} className="text-xs font-mono text-muted-foreground leading-relaxed">{line}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {result && !building && (
        <Card className={result.ok ? "border-green-500/30" : "border-destructive/30"}>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-2">
              {result.ok ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <XCircle className="h-5 w-5 text-destructive" />}
              <span className="text-sm font-medium">{result.ok ? t("packager.buildSuccess") : t("packager.buildFailed")}</span>
            </div>
            <pre className="p-3 rounded-lg bg-muted/50 border text-xs overflow-auto max-h-40 whitespace-pre-wrap">{result.message}</pre>
          </CardContent>
        </Card>
      )}

      {/* Built packages / downloads */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">{t("packager.downloads")}</CardTitle>
            </div>
            <Button variant="outline" size="sm" onClick={fetchPackages} disabled={loadingPkgs} className="gap-1.5">
              <RefreshCw className={`h-4 w-4 ${loadingPkgs ? "animate-spin" : ""}`} />
              {t("env.recheck")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingPkgs ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : packages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("packager.noPackages")}</p>
          ) : (
            <div className="space-y-2">
              {packages.map((pkg) => (
                <div key={pkg.name} className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/30 transition-colors border">
                  <div className="flex items-center gap-3 min-w-0">
                    <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-mono truncate">{pkg.name}</p>
                      <p className="text-xs text-muted-foreground">{formatSize(pkg.size)} · {new Date(pkg.created).toLocaleString()}</p>
                    </div>
                  </div>
                  <a href={`${API}/api/packager/download/${encodeURIComponent(pkg.name)}`} download>
                    <Button size="sm" variant="outline" className="gap-1.5 shrink-0">
                      <Download className="h-3.5 w-3.5" />
                      {t("packager.download")}
                    </Button>
                  </a>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
