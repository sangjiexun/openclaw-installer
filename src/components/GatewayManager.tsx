import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  PlayCircle,
  StopCircle,
  RotateCcw,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Terminal,
  Wifi,
  WifiOff,
  Cpu,
  ChevronDown,
  ChevronUp,
  Zap,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const API = "http://localhost:3456";

interface GatewayStatus {
  running: boolean;
  port: number;
  pid: number | null;
  version: string | null;
  daemonStatus: string | null;
}

interface ControlStep {
  step: string;
  status: "running" | "done" | "error";
  message: string;
}

export function GatewayManager() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [controlling, setControlling] = useState<"start" | "stop" | "restart" | null>(null);
  const [controlSteps, setControlSteps] = useState<ControlStep[]>([]);
  const [controlProgress, setControlProgress] = useState(0);
  const [controlResult, setControlResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<Array<{ text: string; type: string }>>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsEvtRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch(`${API}/api/gateway/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json());
    } catch {
      setStatus(null);
    }
    setLoadingStatus(false);
  };

  useEffect(() => {
    fetchStatus();
    // Poll status every 10 seconds
    pollRef.current = setInterval(fetchStatus, 10_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const openLogs = () => {
    if (logsEvtRef.current) {
      logsEvtRef.current.close();
      logsEvtRef.current = null;
    }
    setLogs([]);
    setLoadingLogs(true);
    setShowLogs(true);

    const src = new EventSource(`${API}/api/gateway/logs`);
    logsEvtRef.current = src;

    src.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        setLogs((prev) => [...prev.slice(-500), d]);
      } catch { /* ignore */ }
      setLoadingLogs(false);
    };

    src.onerror = () => {
      setLoadingLogs(false);
    };
  };

  const closeLogs = () => {
    logsEvtRef.current?.close();
    logsEvtRef.current = null;
    setShowLogs(false);
    setLogs([]);
  };

  const handleControl = async (action: "start" | "restart") => {
    setControlling(action);
    setControlSteps([]);
    setControlProgress(0);
    setControlResult(null);

    try {
      const res = await fetch(`${API}/api/gateway/${action}`, { method: "POST" });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
        let eventType = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              try {
                const d = JSON.parse(line.slice(6));
                if (eventType === "step") {
                  setControlSteps((prev) => {
                    const idx = prev.findIndex((s) => s.step === d.step);
                    if (idx >= 0) { const n = [...prev]; n[idx] = d; return n; }
                    return [...prev, d];
                  });
                } else if (eventType === "progress") {
                  setControlProgress(d.percent ?? 0);
                } else if (eventType === "done") {
                  setControlResult({ ok: d.ok, message: d.message || "" });
                  await fetchStatus();
                }
              } catch { /* ignore */ }
            }
          }
        }
      }
    } catch (err) {
      setControlResult({ ok: false, message: err instanceof Error ? err.message : "Failed" });
    }
    setControlling(null);
  };

  const handleStop = async () => {
    setControlling("stop");
    setControlResult(null);
    try {
      const res = await fetch(`${API}/api/gateway/stop`, { method: "POST" });
      const data = await res.json();
      setControlResult({ ok: data.ok, message: data.ok ? t("gateway.stopped") : (data.steps?.[0]?.message || "Stop failed") });
    } catch (err) {
      setControlResult({ ok: false, message: err instanceof Error ? err.message : "Failed" });
    }
    setControlling(null);
    setTimeout(fetchStatus, 1500);
  };

  const isRunning = status?.running ?? false;
  const inProgress = !!controlling;

  return (
    <div className="space-y-5">
      {/* Status card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">{t("gateway.title")}</CardTitle>
            </div>
            <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loadingStatus} className="gap-1.5">
              {loadingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t("gateway.refresh")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status indicator */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              {loadingStatus ? (
                <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
              ) : isRunning ? (
                <Wifi className="h-5 w-5 text-green-500" />
              ) : (
                <WifiOff className="h-5 w-5 text-red-500" />
              )}
              <span className="text-sm font-medium">
                {loadingStatus ? t("gateway.checking") : isRunning ? t("gateway.running") : t("gateway.stopped")}
              </span>
              {!loadingStatus && (
                <Badge
                  variant={isRunning ? "default" : "destructive"}
                  className={`text-xs ${isRunning ? "bg-green-600 hover:bg-green-600" : ""}`}
                >
                  {isRunning ? t("gateway.portListening", { port: status?.port }) : t("gateway.portDown")}
                </Badge>
              )}
            </div>

            {status && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {status.version && (
                  <span className="flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5" />
                    {status.version}
                  </span>
                )}
                {status.pid && (
                  <span className="flex items-center gap-1">
                    <Cpu className="h-3.5 w-3.5" />
                    PID {status.pid}
                  </span>
                )}
                {status.daemonStatus && (
                  <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{status.daemonStatus}</span>
                )}
              </div>
            )}
          </div>

          {/* Control buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              className="gap-1.5"
              disabled={inProgress || isRunning}
              onClick={() => handleControl("start")}
            >
              {controlling === "start" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              {t("gateway.start")}
            </Button>

            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              disabled={inProgress || !isRunning}
              onClick={handleStop}
            >
              {controlling === "stop" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <StopCircle className="h-4 w-4" />
              )}
              {t("gateway.stop")}
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={inProgress}
              onClick={() => handleControl("restart")}
            >
              {controlling === "restart" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              {t("gateway.restart")}
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={showLogs ? closeLogs : openLogs}
            >
              <Terminal className="h-4 w-4" />
              {showLogs ? t("gateway.hideLogs") : t("gateway.showLogs")}
            </Button>
          </div>

          {/* Progress */}
          {inProgress && controlSteps.length > 0 && (
            <div className="space-y-2">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${controlProgress}%` }}
                />
              </div>
              <div className="space-y-1">
                {controlSteps.map((s) => (
                  <div key={s.step} className="flex items-center gap-2 text-xs">
                    {s.status === "running" && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />}
                    {s.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                    {s.status === "error" && <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
                    <span>{s.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result banner */}
          {controlResult && !inProgress && (
            <div
              className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
                controlResult.ok
                  ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                  : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
              }`}
            >
              {controlResult.ok ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <span className="whitespace-pre-wrap">{controlResult.message}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Logs viewer */}
      {showLogs && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">{t("gateway.logs")}</CardTitle>
                {loadingLogs && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setLogs([])} className="h-7 text-xs">
                  {t("gateway.clearLogs")}
                </Button>
                <Button variant="ghost" size="sm" onClick={closeLogs} className="h-7 text-xs">
                  {t("gateway.hideLogs")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="bg-black rounded-b-lg min-h-32 max-h-72 overflow-y-auto p-3 font-mono text-xs">
              {logs.length === 0 && !loadingLogs && (
                <p className="text-gray-500">{t("gateway.noLogs")}</p>
              )}
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={`leading-relaxed ${
                    l.type === "error"
                      ? "text-red-400"
                      : l.type === "existing"
                        ? "text-gray-400"
                        : "text-green-400"
                  }`}
                >
                  {l.text}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick actions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t("gateway.quickActions")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border hover:bg-muted/30 space-y-1">
              <p className="text-xs font-medium">{t("gateway.dashboardTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("gateway.dashboardDesc")}</p>
              <a
                href="http://localhost:18789"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
              >
                {t("gateway.openDashboard")}
              </a>
            </div>
            <div className="p-3 rounded-lg border hover:bg-muted/30 space-y-1">
              <p className="text-xs font-medium">{t("gateway.statusCheckTitle")}</p>
              <code className="block text-xs font-mono bg-muted px-2 py-1 rounded mt-1">
                openclaw gateway status
              </code>
              <code className="block text-xs font-mono bg-muted px-2 py-1 rounded">
                openclaw doctor
              </code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
