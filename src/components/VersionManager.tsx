import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Tag,
  Download,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Terminal,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const API = "http://localhost:3456";

interface VersionEntry {
  version: string;
  date: string;
  zipUrl: string;
}

interface VersionsData {
  ok: boolean;
  latestVersion: string | null;
  latestUrl: string;
  history: VersionEntry[];
  changelog: string | null;
  error?: string;
}

interface InstallStep {
  step: string;
  status: "running" | "done" | "error";
  message: string;
}

export function VersionManager() {
  const { t } = useTranslation();
  const [data, setData] = useState<VersionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  const [installing, setInstalling] = useState(false);
  const [installVersion, setInstallVersion] = useState<string | null>(null);
  const [installSteps, setInstallSteps] = useState<InstallStep[]>([]);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [installProgress, setInstallProgress] = useState(0);
  const [installResult, setInstallResult] = useState<{ ok: boolean; message: string } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchVersions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/versions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch versions");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchVersions();
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [installLogs]);

  const handleInstall = async (zipUrl: string, version: string) => {
    setInstalling(true);
    setInstallVersion(version);
    setInstallSteps([]);
    setInstallLogs([]);
    setInstallProgress(0);
    setInstallResult(null);

    try {
      const res = await fetch(`${API}/api/install/source-zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zipUrl, version }),
      });

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
                  setInstallSteps((prev) => {
                    const idx = prev.findIndex((s) => s.step === d.step);
                    if (idx >= 0) {
                      const next = [...prev];
                      next[idx] = d;
                      return next;
                    }
                    return [...prev, d];
                  });
                } else if (eventType === "progress") {
                  setInstallProgress(d.percent ?? 0);
                  if (d.line) setInstallLogs((prev) => [...prev.slice(-300), d.line]);
                } else if (eventType === "log") {
                  setInstallLogs((prev) => [...prev.slice(-300), d.text]);
                } else if (eventType === "done") {
                  setInstallResult({ ok: d.ok, message: d.message || "" });
                }
              } catch { /* ignore */ }
            }
          }
        }
      }
    } catch (err) {
      setInstallResult({ ok: false, message: err instanceof Error ? err.message : "Install failed" });
    }
    setInstalling(false);
  };

  const currentInstalled = data?.latestVersion;

  return (
    <div className="space-y-5">
      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">{t("versions.title")}</CardTitle>
            </div>
            <Button variant="outline" size="sm" onClick={fetchVersions} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t("versions.refresh")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("versions.subtitle")}</p>
        </CardHeader>
        <CardContent>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("versions.fetching")}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-500">
              <XCircle className="h-4 w-4" />
              {error}
            </div>
          )}
          {!loading && data && (
            <div className="space-y-4">
              {/* Latest version */}
              {data.latestVersion && (
                <div className="p-4 rounded-lg border border-primary/30 bg-primary/5">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-primary" />
                          <span className="text-sm font-semibold text-primary">
                            {t("versions.latest")}: v{data.latestVersion}
                          </span>
                          <Badge variant="default" className="text-xs bg-primary">
                            {t("versions.latestBadge")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t("versions.sourceFrom")} hunyuandata.cn
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={data.latestUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t("versions.downloadZip")}
                      </a>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={installing}
                        onClick={() => handleInstall(data.latestUrl, data.latestVersion!)}
                      >
                        {installing && installVersion === data.latestVersion ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        {t("versions.installFromSource")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Changelog */}
              {data.changelog && (
                <div>
                  <button
                    onClick={() => setShowChangelog(!showChangelog)}
                    className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors"
                  >
                    <Terminal className="h-3.5 w-3.5" />
                    {t("versions.changelog")}
                    {showChangelog ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {showChangelog && (
                    <pre className="mt-2 p-3 rounded-lg bg-muted text-xs font-mono overflow-x-auto max-h-48 leading-relaxed">
                      {data.changelog}
                    </pre>
                  )}
                </div>
              )}

              {/* Error from remote */}
              {!data.ok && data.error && (
                <p className="text-xs text-yellow-600">
                  {t("versions.fetchWarning")}: {data.error}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      {data && data.history.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center justify-between w-full"
            >
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">
                  {t("versions.history")} ({data.history.length})
                </CardTitle>
              </div>
              {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </CardHeader>
          {showHistory && (
            <CardContent className="pt-0">
              <div className="max-h-80 overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{t("versions.version")}</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{t("versions.date")}</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">{t("versions.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.history.map((v) => (
                      <tr key={v.version} className="hover:bg-muted/30">
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs font-semibold">v{v.version}</span>
                          {v.version === currentInstalled && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                              {t("versions.current")}
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{v.date}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <a
                              href={v.zipUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs px-2 gap-1"
                              disabled={installing}
                              onClick={() => handleInstall(v.zipUrl, v.version)}
                            >
                              {installing && installVersion === v.version ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                              {t("versions.install")}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Install progress */}
      {(installing || installResult) && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              {installing ? (
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
              ) : installResult?.ok ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
              <CardTitle className="text-sm">
                {installing
                  ? t("versions.installing", { version: installVersion })
                  : installResult?.ok
                    ? t("versions.installSuccess")
                    : t("versions.installFailed")}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Progress bar */}
            {installing && (
              <div className="space-y-1">
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${installProgress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-right">{installProgress}%</p>
              </div>
            )}

            {/* Steps */}
            {installSteps.length > 0 && (
              <div className="space-y-1">
                {installSteps.map((s) => (
                  <div key={s.step} className="flex items-start gap-2 text-xs">
                    {s.status === "running" && <Loader2 className="h-3.5 w-3.5 text-primary animate-spin mt-0.5 shrink-0" />}
                    {s.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />}
                    {s.status === "error" && <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />}
                    <span className={s.status === "error" ? "text-red-600" : ""}>{s.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Result message */}
            {installResult && (
              <pre
                className={`p-3 rounded-lg text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto ${
                  installResult.ok ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
                }`}
              >
                {installResult.message}
              </pre>
            )}

            {/* Live logs */}
            {installLogs.length > 0 && (
              <details>
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  {t("versions.showLogs")} ({installLogs.length})
                </summary>
                <div className="mt-2 p-2 rounded bg-black/90 text-green-400 text-xs font-mono max-h-48 overflow-y-auto">
                  {installLogs.map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
