import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FileJson,
  Save,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Copy,
  CheckCheck,
  Eye,
  EyeOff,
  RotateCcw,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const API = "http://localhost:3456";

interface ConfigResult {
  ok: boolean;
  content: string;
  exists: boolean;
  error?: string;
}

function JsonEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);

  const handleChange = (v: string) => {
    onChange(v);
    try {
      JSON.parse(v);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  return (
    <div className="space-y-1">
      <textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        readOnly={readOnly}
        spellCheck={false}
        className={`w-full h-96 p-3 font-mono text-xs rounded-lg border resize-y bg-background focus:outline-none focus:ring-1 focus:ring-primary ${
          error ? "border-red-400 focus:ring-red-400" : "border-input"
        } ${readOnly ? "opacity-70 cursor-default" : ""}`}
      />
      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <XCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}

export function ConfigManager() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [hotReloadEnabled, setHotReloadEnabled] = useState(true);
  const [externalChange, setExternalChange] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(true);
  const [parsedView, setParsedView] = useState<Record<string, unknown> | null>(null);
  const evtSourceRef = useRef<EventSource | null>(null);

  const isDirty = content !== savedContent;

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExternalChange(false);
    try {
      const res = await fetch(`${API}/api/config/read`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ConfigResult = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to read config");
      setContent(data.content);
      setSavedContent(data.content);
      try { setParsedView(JSON.parse(data.content)); } catch { setParsedView(null); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    }
    setLoading(false);
  }, []);

  // SSE watcher for external file changes (hot-reload detection)
  useEffect(() => {
    if (!hotReloadEnabled) return;

    const src = new EventSource(`${API}/api/config/watch`);
    evtSourceRef.current = src;

    src.addEventListener("change", () => {
      setExternalChange(true);
    });

    src.onerror = () => {
      // Reconnect silently
    };

    return () => {
      src.close();
      evtSourceRef.current = null;
    };
  }, [hotReloadEnabled]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    // Validate JSON first
    try {
      JSON.parse(content);
    } catch (e) {
      setSaveResult({ ok: false, message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }

    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch(`${API}/api/config/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (data.ok) {
        setSavedContent(content);
        setSaveResult({ ok: true, message: t("config.saveSuccess") });
        try { setParsedView(JSON.parse(content)); } catch { setParsedView(null); }
      } else {
        setSaveResult({ ok: false, message: data.error || t("config.saveFailed") });
      }
    } catch (err) {
      setSaveResult({ ok: false, message: err instanceof Error ? err.message : "Save failed" });
    }
    setSaving(false);
    setTimeout(() => setSaveResult(null), 4000);
  };

  const handleReload = async () => {
    setReloading(true);
    try {
      const res = await fetch(`${API}/api/config/reload`, { method: "POST" });
      const data = await res.json();
      setSaveResult({ ok: data.ok, message: data.message || (data.ok ? t("config.reloadSuccess") : t("config.reloadFailed")) });
    } catch (err) {
      setSaveResult({ ok: false, message: err instanceof Error ? err.message : "Reload failed" });
    }
    setReloading(false);
    setTimeout(() => setSaveResult(null), 4000);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRevert = () => {
    setContent(savedContent);
    setExternalChange(false);
  };

  const handleReloadExternal = async () => {
    await fetchConfig();
    setExternalChange(false);
  };

  // Try to compute a pretty summary of major config sections
  const configSummary = parsedView
    ? Object.keys(parsedView)
        .map((k) => k)
        .join(", ")
    : null;

  return (
    <div className="space-y-5">
      {/* External change alert */}
      {externalChange && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30">
          <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">{t("config.externalChange")}</p>
            <p className="text-xs text-yellow-700 dark:text-yellow-300">{t("config.externalChangeDesc")}</p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0 gap-1.5 border-yellow-400" onClick={handleReloadExternal}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("config.reload")}
          </Button>
        </div>
      )}

      {/* Editor card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <FileJson className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">{t("config.editorTitle")}</CardTitle>
              {isDirty && (
                <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                  {t("config.unsaved")}
                </Badge>
              )}
              <div className="flex items-center gap-1.5 ml-2">
                <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{t("config.hotReload")}</span>
                <button
                  onClick={() => setHotReloadEnabled(!hotReloadEnabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    hotReloadEnabled ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      hotReloadEnabled ? "translate-x-4.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="sm" onClick={() => setShowRaw(!showRaw)} className="gap-1.5 h-8 text-xs">
                {showRaw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showRaw ? t("config.treeView") : t("config.rawJson")}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5 h-8 text-xs">
                {copied ? <CheckCheck className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("common.copied") : t("common.copy")}
              </Button>
              <Button variant="outline" size="sm" onClick={fetchConfig} disabled={loading} className="gap-1.5 h-8 text-xs">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                {t("config.reload")}
              </Button>
              {isDirty && (
                <Button variant="ghost" size="sm" onClick={handleRevert} className="gap-1.5 h-8 text-xs">
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t("config.revert")}
                </Button>
              )}
              <Button size="sm" onClick={handleSave} disabled={saving || !isDirty} className="gap-1.5 h-8 text-xs">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {t("common.save")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleReload} disabled={reloading} className="gap-1.5 h-8 text-xs">
                {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                {t("config.triggerReload")}
              </Button>
            </div>
          </div>
          {configSummary && (
            <p className="text-xs text-muted-foreground">
              {t("config.sections")}: <span className="font-mono">{configSummary}</span>
            </p>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-sm text-red-500 py-4">
              <XCircle className="h-4 w-4" />
              {error}
            </div>
          ) : showRaw ? (
            <JsonEditor value={content} onChange={setContent} />
          ) : (
            <ConfigTreeView data={parsedView} />
          )}

          {saveResult && (
            <div
              className={`mt-3 flex items-start gap-2 p-3 rounded-lg text-sm ${
                saveResult.ok
                  ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                  : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
              }`}
            >
              {saveResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
              <span>{saveResult.message}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Key config sections quick-edit */}
      {parsedView && <ConfigQuickEdit config={parsedView} onUpdate={(c) => {
        const newContent = JSON.stringify(c, null, 2);
        setContent(newContent);
      }} />}
    </div>
  );
}

// Collapsible tree view of parsed JSON
function ConfigTreeView({ data }: { data: Record<string, unknown> | null }) {
  const { t } = useTranslation();
  if (!data) {
    return <p className="text-xs text-muted-foreground py-4">{t("config.invalidJson")}</p>;
  }
  return (
    <div className="rounded-lg border p-3 font-mono text-xs overflow-auto max-h-96">
      <JsonNode value={data} depth={0} />
    </div>
  );
}

function JsonNode({ value, depth }: { value: unknown; depth: number }) {
  const [collapsed, setCollapsed] = useState(depth > 1);

  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (typeof value === "boolean") return <span className="text-blue-500">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-orange-500">{value}</span>;
  if (typeof value === "string") return <span className="text-green-600 dark:text-green-400">"{value}"</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">[]</span>;
    return (
      <span>
        <button onClick={() => setCollapsed(!collapsed)} className="text-yellow-600 dark:text-yellow-400 hover:underline">
          [{collapsed ? `...${value.length} items` : ""}
        </button>
        {!collapsed && (
          <span>
            {value.map((item, i) => (
              <div key={i} style={{ marginLeft: `${(depth + 1) * 16}px` }}>
                <JsonNode value={item} depth={depth + 1} />
                {i < value.length - 1 && ","}
              </div>
            ))}
            <span style={{ marginLeft: `${depth * 16}px` }}>]</span>
          </span>
        )}
        {collapsed && "]"}
      </span>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-muted-foreground">{"{}"}</span>;
    return (
      <span>
        <button onClick={() => setCollapsed(!collapsed)} className="text-purple-600 dark:text-purple-400 hover:underline">
          {"{"}
          {collapsed ? `...${entries.length} keys` : ""}
        </button>
        {!collapsed && (
          <span>
            {entries.map(([k, v], i) => (
              <div key={k} style={{ marginLeft: `${(depth + 1) * 16}px` }}>
                <span className="text-foreground font-semibold">"{k}"</span>
                <span className="text-muted-foreground">: </span>
                <JsonNode value={v} depth={depth + 1} />
                {i < entries.length - 1 && ","}
              </div>
            ))}
            <span style={{ marginLeft: `${depth * 16}px` }}>{"}"}</span>
          </span>
        )}
        {collapsed && "}"}
      </span>
    );
  }

  return <span>{String(value)}</span>;
}

// Quick edit for commonly-used config fields
function ConfigQuickEdit({
  config,
  onUpdate,
}: {
  config: Record<string, unknown>;
  onUpdate: (c: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();

  const gateway = (config.gateway as Record<string, unknown>) || {};
  const port = (gateway.port as number) ?? 18789;
  const [editPort, setEditPort] = useState(String(port));

  const applyGatewayPort = () => {
    const p = parseInt(editPort, 10);
    if (!isNaN(p) && p > 0 && p < 65536) {
      onUpdate({ ...config, gateway: { ...gateway, port: p } });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("config.quickEdit")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("config.quickEditDesc")}</p>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-4">
          {/* Gateway port */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t("config.gatewayPort")}</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={editPort}
                onChange={(e) => setEditPort(e.target.value)}
                min={1}
                max={65535}
                className="flex-1 h-8 px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={applyGatewayPort}>
                {t("common.apply")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("config.gatewayPortDesc")}</p>
          </div>

          {/* Config path info */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">{t("config.configPath")}</label>
            <p className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1.5 rounded">
              ~/.openclaw/openclaw.json
            </p>
            <p className="text-xs text-muted-foreground">{t("config.configPathDesc")}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
