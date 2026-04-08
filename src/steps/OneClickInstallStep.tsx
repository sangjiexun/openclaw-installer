import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TerminalOutput } from "@/components/TerminalOutput";
import {
  Loader2, Rocket, CheckCircle2, XCircle, Download, Package,
  Settings, Shield, Zap, Clock, HardDrive, RefreshCw,
} from "lucide-react";

interface OneClickInstallStepProps {
  onNext: () => void;
  onBack: () => void;
}

interface PhaseInfo {
  id: string;
  label: string;
  icon: typeof Rocket;
  status: "pending" | "active" | "done" | "error" | "skipped";
  detail?: string;
}

const INITIAL_PHASES: PhaseInfo[] = [
  { id: "detect", label: "检测系统环境", icon: Settings, status: "pending" },
  { id: "download", label: "下载 Node.js 运行时", icon: Download, status: "pending" },
  { id: "extract", label: "解压到沙箱目录", icon: HardDrive, status: "pending" },
  { id: "install", label: "安装 OpenClaw CLI", icon: Package, status: "pending" },
  { id: "configure", label: "配置环境变量", icon: Settings, status: "pending" },
];

export function OneClickInstallStep({ onNext, onBack }: OneClickInstallStepProps) {
  const [installing, setInstalling] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [phases, setPhases] = useState<PhaseInfo[]>(INITIAL_PHASES);
  const [downloadProgress, setDownloadProgress] = useState<{ current: number; total: number; detail: string } | null>(null);
  const [installTailscale, setInstallTailscale] = useState(false);
  const [sandboxStatus, setSandboxStatus] = useState<{
    nodeInstalled: boolean;
    openclawInstalled: boolean;
    nodeVersion: string | null;
    openclawVersion: string | null;
  } | null>(null);

  // Source-update state
  const [updateStatus, setUpdateStatus] = useState<"idle" | "updating" | "done" | "error">("idle");
  const [updatePct, setUpdatePct] = useState(0);
  const [updateLabel, setUpdateLabel] = useState("");
  const [updateLog, setUpdateLog] = useState<string[]>([]);

  // Check existing sandbox status on mount
  useEffect(() => {
    (async () => {
      try {
        const status = await window.electronAPI.sandboxStatus();
        setSandboxStatus(status);
        // If already fully installed, mark as done
        if (status.nodeInstalled && status.openclawInstalled) {
          setDone(true);
          setPhases(INITIAL_PHASES.map((p) => ({ ...p, status: "done" as const })));
          setOutput([
            `沙箱运行时已安装`,
            `Node.js: ${status.nodeVersion || "已安装"}`,
            `OpenClaw: ${status.openclawVersion || "已安装"}`,
            "",
            "✅ 环境就绪，可直接进入下一步",
          ]);
        }
        // Also check system-wide
        if (!status.nodeInstalled || !status.openclawInstalled) {
          const nodeCheck = await window.electronAPI.which("node");
          const ocCheck = await window.electronAPI.which("openclaw");
          if (nodeCheck && ocCheck) {
            setDone(true);
            setPhases(INITIAL_PHASES.map((p) => ({ ...p, status: "done" as const })));
            setOutput([
              "系统已安装 Node.js 和 OpenClaw",
              `Node.js: ${nodeCheck}`,
              `OpenClaw: ${ocCheck}`,
              "",
              "✅ 环境就绪，可直接进入下一步",
            ]);
          }
        }
      } catch {
        // Ignore errors during status check
      }
    })();
  }, []);

  const startInstall = useCallback(async () => {
    setInstalling(true);
    setFailed(false);
    setOutput([]);
    setPhases(INITIAL_PHASES);
    setDownloadProgress(null);

    // Subscribe to real-time output
    const unsubOutput = window.electronAPI.onSandboxOutput((data) => {
      setOutput((prev) => [...prev.slice(-500), data]);
    });

    // Subscribe to progress updates
    const unsubProgress = window.electronAPI.onSandboxProgress((progress) => {
      const { phase, current, total, detail } = progress;

      // Update phase status
      setPhases((prev) =>
        prev.map((p) => {
          if (p.id === phase) {
            if (detail === "失败") return { ...p, status: "error", detail };
            if (current >= total && total > 0) return { ...p, status: "done", detail };
            return { ...p, status: "active", detail };
          }
          // Mark previous phases as done if we've moved past them
          const phaseOrder = INITIAL_PHASES.map((x) => x.id);
          const currentIdx = phaseOrder.indexOf(phase);
          const thisIdx = phaseOrder.indexOf(p.id);
          if (thisIdx < currentIdx && p.status !== "done" && p.status !== "skipped") {
            return { ...p, status: "done" };
          }
          return p;
        })
      );

      // Track download progress for the progress bar
      if (phase === "download" && total > 0) {
        setDownloadProgress({ current, total, detail });
      }
    });

    try {
      const result = await window.electronAPI.sandboxOneClickInstall({
        installTailscale,
      });

      if (result.ok) {
        setDone(true);
        setPhases((prev) => prev.map((p) => ({
          ...p,
          status: p.status === "error" ? "error" : "done",
        })));
      } else {
        setFailed(true);
      }
    } catch (err) {
      setFailed(true);
      setOutput((prev) => [...prev, `安装异常: ${err}`]);
    } finally {
      unsubOutput();
      unsubProgress();
      setInstalling(false);
      setDownloadProgress(null);
    }
  }, [installTailscale]);

  const startSourceUpdate = useCallback(async () => {
    setUpdateStatus("updating");
    setUpdatePct(0);
    setUpdateLabel("准备中...");
    setUpdateLog([]);
    const unsub = window.electronAPI.onOcUpdateOutput?.((line: string) => {
      if (line.startsWith("__PCT__:")) {
        const parts = line.split(":");
        const n = parseInt(parts[1], 10);
        if (!isNaN(n)) setUpdatePct(n);
        const label = parts.slice(2).join(":");
        if (label) setUpdateLabel(label);
        return;
      }
      setUpdateLog((prev) => [...prev.slice(-60), line]);
    });
    try {
      const result = await window.electronAPI.ocInstall?.();
      unsub?.();
      if (result?.ok) {
        setUpdatePct(100);
        setUpdateStatus("done");
        setUpdateLabel("更新完成");
        // refresh sandbox status display
        const status = await window.electronAPI.sandboxStatus();
        setSandboxStatus(status);
      } else {
        setUpdateStatus("error");
        setUpdateLabel(result?.error || "更新失败");
      }
    } catch (err) {
      unsub?.();
      setUpdateStatus("error");
      setUpdateLabel(String(err));
    }
  }, []);

  const downloadPct = downloadProgress && downloadProgress.total > 0
    ? Math.round((downloadProgress.current / downloadProgress.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Zap className="h-6 w-6 text-yellow-400" />
          一键安装
        </h2>
        <p className="text-muted-foreground mt-1">
          自动下载便携版 Node.js 运行时，在沙箱环境中安装 OpenClaw CLI，无需 Scoop 或系统级依赖
        </p>
      </div>

      {/* Phase Progress */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">安装进度</CardTitle>
          <CardDescription>
            冷启动沙箱模式：独立运行时 → 零污染系统环境 → 秒级服务启动
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {phases.map((phase) => (
            <div key={phase.id} className="flex items-center gap-3">
              {/* Status icon */}
              <div className="shrink-0 w-5 h-5 flex items-center justify-center">
                {phase.status === "done" || phase.status === "skipped" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : phase.status === "error" ? (
                  <XCircle className="h-4 w-4 text-red-400" />
                ) : phase.status === "active" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                ) : (
                  <div className="h-3 w-3 rounded-full border border-muted-foreground/30" />
                )}
              </div>
              {/* Label */}
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${
                  phase.status === "active" ? "text-blue-400 font-medium" :
                  phase.status === "done" || phase.status === "skipped" ? "text-green-400/80" :
                  phase.status === "error" ? "text-red-400" :
                  "text-muted-foreground"
                }`}>
                  {phase.label}
                </span>
                {phase.detail && (
                  <span className="text-xs text-muted-foreground ml-2">
                    {phase.status === "skipped" ? "(已跳过)" : phase.detail}
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* Download progress bar */}
          {downloadProgress && downloadProgress.total > 0 && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>下载进度</span>
                <span>{downloadProgress.detail}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${downloadPct}%` }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action area */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Info box */}
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-200 space-y-1">
            <div className="font-medium flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              沙箱隔离安装
            </div>
            <div className="text-blue-100/80">
              便携版 Node.js 将下载到 ~/.openclaw/sandbox/，与系统环境完全隔离。
              不会修改系统注册表或安装系统级服务，卸载只需删除目录。
            </div>
          </div>

          {/* Tailscale toggle */}
          {!done && (
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={installTailscale}
                onChange={(e) => setInstallTailscale(e.target.checked)}
                className="rounded border-muted-foreground/50"
                disabled={installing}
              />
              <span className="text-muted-foreground">
                同时安装 Tailscale (远程访问，可选)
              </span>
            </label>
          )}

          {/* Install button */}
          {!installing && !done && (
            <Button onClick={startInstall} className="w-full" size="lg" disabled={installing}>
              <Rocket className="mr-2 h-4 w-4" />
              {failed ? "重试一键安装" : "一键安装"}
            </Button>
          )}

          {installing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在安装，请稍候...
            </div>
          )}

          {done && (
            <div className="flex items-center gap-2 text-sm text-green-400 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              安装完成
            </div>
          )}

          {/* ── 更新源码 section (shown when install is done) ── */}
          {done && (
            <div className="rounded-lg border border-[#6c63ff]/20 bg-[#6c63ff]/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#a9a6ff]">OpenClaw 源码更新</span>
                {updateStatus === "idle" && (
                  <button
                    onClick={startSourceUpdate}
                    className="flex items-center gap-1 px-2 py-1 rounded-md border border-[#6c63ff]/30 bg-[#6c63ff]/10 hover:bg-[#6c63ff]/20 hover:border-[#6c63ff]/50 text-[11px] font-medium text-[#a9a6ff] transition-all"
                  >
                    <Download className="h-3 w-3" />
                    更新源码
                  </button>
                )}
                {updateStatus === "done" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-green-400">✓ 已更新</span>
                    <button
                      onClick={startSourceUpdate}
                      className="flex items-center gap-1 px-2 py-1 rounded-md border border-[#6c63ff]/30 bg-[#6c63ff]/10 hover:bg-[#6c63ff]/20 text-[11px] text-[#a9a6ff] transition-all"
                    >
                      <RefreshCw className="h-3 w-3" />
                      再次更新
                    </button>
                  </div>
                )}
                {updateStatus === "error" && (
                  <button
                    onClick={startSourceUpdate}
                    className="flex items-center gap-1 px-2 py-1 rounded-md border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 text-[11px] text-orange-300 transition-all"
                  >
                    <RefreshCw className="h-3 w-3" />
                    重试
                  </button>
                )}
              </div>

              {updateStatus === "updating" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#a9a6ff]/80">{updateLabel}</span>
                    <span className="text-[11px] text-[#a9a6ff]/60 tabular-nums">{updatePct}%</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#6c63ff] to-[#e91e63] rounded-full transition-all duration-500"
                      style={{ width: `${updatePct}%` }}
                    />
                  </div>
                  {updateLog.length > 0 && (
                    <div className="text-[10px] text-muted-foreground/50 font-mono truncate">
                      {updateLog[updateLog.length - 1]}
                    </div>
                  )}
                </div>
              )}

              {updateStatus === "error" && (
                <div className="text-[11px] text-orange-300/80 font-mono truncate">{updateLabel}</div>
              )}

              {updateStatus === "done" && updateLog.length > 0 && (
                <div className="text-[10px] text-green-400/60 font-mono truncate">
                  {updateLog[updateLog.length - 1]}
                </div>
              )}

              <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
                下载最新 openclaw 源码包并覆盖已安装版本，不影响沙箱运行时。
              </p>
            </div>
          )}

          {/* Terminal output */}
          <TerminalOutput lines={output} className="max-h-56" />
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>← 返回</Button>
        <Button onClick={onNext} disabled={!done}>
          下一步 →
        </Button>
      </div>
    </div>
  );
}
