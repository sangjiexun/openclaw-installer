import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TerminalOutput } from "@/components/TerminalOutput";
import {
  Loader2, Play, CheckCircle2, PartyPopper, Terminal, Globe,
  Square, Pause, RotateCcw, Activity, ShieldCheck, Copy, Check, MonitorDown,
  AlertTriangle, Shield, Link2, Network, ExternalLink, Timer,
} from "lucide-react";
import { useVip } from "@/lib/vip";

interface FinishStepProps {
  onBack: () => void;
  gatewayConfig: { port: string; bind: string; authMode: string; authToken: string };
}

type ServiceStatus = "stopped" | "starting" | "running" | "suspended" | "error";

// ─── Copy button for command lines ───────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await window.electronAPI.copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
      title="复制命令"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ─── System check result row ─────────────────────────────────────────────────
function CheckRow({ item }: { item: { name: string; status: string; detail: string } }) {
  const icon = item.status === "pass" ? "✅" : item.status === "warn" ? "⚠️" : "❌";
  const color = item.status === "pass" ? "text-green-400" : item.status === "warn" ? "text-yellow-400" : "text-red-400";
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span>{icon}</span>
      <span className="text-muted-foreground w-28 shrink-0">{item.name}</span>
      <span className={color}>{item.detail}</span>
    </div>
  );
}

// ─── Status badge ────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: ServiceStatus }) {
  const map: Record<ServiceStatus, { label: string; variant: "success" | "secondary" | "destructive" | "default" | "outline" }> = {
    stopped: { label: "已停止", variant: "secondary" },
    starting: { label: "启动中...", variant: "default" },
    running: { label: "运行中", variant: "success" },
    suspended: { label: "已挂起", variant: "outline" },
    error: { label: "异常", variant: "destructive" },
  };
  const { label, variant } = map[status] || map.stopped;
  return <Badge variant={variant}>{label}</Badge>;
}

// ─── Format bytes ────────────────────────────────────────────────────────────
function formatBytes(bytes: number | null) {
  if (!bytes) return "-";
  if (bytes > 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}时${m}分`;
}

// ═════════════════════════════════════════════════════════════════════════════
export function FinishStep({ onBack, gatewayConfig }: FinishStepProps) {
  const [output, setOutput] = useState<string[]>([]);
  const { vip, isExpired, adminUnlocked } = useVip();
  const vipBlocked = !vip.active && !adminUnlocked; // admin password bypass
  const [status, setStatus] = useState<ServiceStatus>("stopped");
  const [pid, setPid] = useState<number | null>(null);
  const [uptime, setUptime] = useState(0);
  const [memory, setMemory] = useState<number | null>(null);
  const [restartCount, setRestartCount] = useState(0);
  const [checking, setChecking] = useState(false);
  const [checkResults, setCheckResults] = useState<{ name: string; status: string; detail: string }[] | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [remoteLoading, setRemoteLoading] = useState<string | null>(null);
  const [serviceRegistered, setServiceRegistered] = useState(false);
  const [serviceLoading, setServiceLoading] = useState(false);
  const [tailscaleHost, setTailscaleHost] = useState("");
  const [tailscaleIp, setTailscaleIp] = useState("");
  const [tailscaleReady, setTailscaleReady] = useState(false);

  const tokenValue = gatewayConfig.authToken.trim();
  const effectiveTokenPath = "~/.openclaw/gateway.token";
  const secureAcpUrl = tailscaleHost ? `wss://${tailscaleHost}` : "";
  const tailnetWsUrl = tailscaleIp ? `ws://${tailscaleIp}:${gatewayConfig.port || "18789"}` : "";
  const serveControlUrl = tailscaleHost ? `https://${tailscaleHost}/` : "";
  const tailnetControlUrl = tailscaleIp ? `http://${tailscaleIp}:${gatewayConfig.port || "18789"}/` : "";

  const acpCommand = useMemo(() => {
    if (secureAcpUrl) {
      return `openclaw acp --url ${secureAcpUrl} ${tokenValue ? `--token-file ${effectiveTokenPath}` : "--token <token>"}`;
    }
    if (tailnetWsUrl) {
      return `openclaw acp --url ${tailnetWsUrl} ${tokenValue ? `--token-file ${effectiveTokenPath}` : "--token <token>"}`;
    }
    return "openclaw acp --url wss://<gateway-host> --token-file ~/.openclaw/gateway.token";
  }, [secureAcpUrl, tailnetWsUrl, tokenValue]);

  // Subscribe to gateway output + status updates
  useEffect(() => {
    const unsubOutput = window.electronAPI.onGatewayOutput((data) => {
      const lines = data.split("\n").filter((l: string) => l.trim());
      if (lines.length) setOutput((prev) => [...prev.slice(-500), ...lines]);
    });
    const unsubStatus = window.electronAPI.onGatewayStatus((s) => {
      setStatus(s.status);
      setPid(s.pid);
      setUptime(s.uptime);
      setMemory(s.memory);
      setRestartCount(s.restartCount);
    });
    // Poll status periodically for uptime/memory refresh
    const poll = setInterval(async () => {
      const s = await window.electronAPI.gatewayGetStatus();
      setStatus(s.status);
      setPid(s.pid);
      setUptime(s.uptime);
      setMemory(s.memory);
      setRestartCount(s.restartCount);
    }, 5000);

    return () => { unsubOutput(); unsubStatus(); clearInterval(poll); };
  }, []);

  const refreshTailscaleInfo = useCallback(async () => {
    const which = await window.electronAPI.which("tailscale");
    if (!which) {
      setTailscaleReady(false);
      setTailscaleHost("");
      setTailscaleIp("");
      return;
    }
    setTailscaleReady(true);
    const statusRes = await window.electronAPI.exec("tailscale status --json");
    if (statusRes.code === 0 && statusRes.stdout.trim()) {
      try {
        const status = JSON.parse(statusRes.stdout);
        const self = status?.Self ?? {};
        const dnsName = typeof self.DNSName === "string" ? self.DNSName.replace(/\.$/, "") : "";
        const ips = Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : [];
        setTailscaleHost(dnsName);
        setTailscaleIp(typeof ips[0] === "string" ? ips[0] : "");
      } catch {
        // ignore parse issues
      }
    }
    const ipRes = await window.electronAPI.exec("tailscale ip -4");
    if (ipRes.code === 0 && ipRes.stdout.trim()) {
      const ip = ipRes.stdout.split(/\r?\n/).map((v) => v.trim()).find(Boolean);
      if (ip) setTailscaleIp(ip);
    }
  }, []);

  useEffect(() => {
    refreshTailscaleInfo();
  }, [refreshTailscaleInfo]);

  // Check service auto-start status on mount
  useEffect(() => {
    (async () => {
      try {
        const s = await window.electronAPI.serviceStatus();
        setServiceRegistered(s.registered);
      } catch {}
    })();
  }, []);

  const toggleService = useCallback(async () => {
    setServiceLoading(true);
    try {
      if (serviceRegistered) {
        const res = await window.electronAPI.serviceUnregister();
        if (res.ok) {
          setServiceRegistered(false);
          setOutput((prev) => [...prev, "[开机自启] 已取消注册"]);
        } else {
          setOutput((prev) => [...prev, `[开机自启] 取消失败: ${res.error}`]);
        }
      } else {
        const res = await window.electronAPI.serviceRegister({
          port: gatewayConfig.port || "18789",
          bind: gatewayConfig.bind || "loopback",
        });
        if (res.ok) {
          setServiceRegistered(true);
          setOutput((prev) => [...prev, "[开机自启] 已注册 Windows 计划任务"]);
        } else {
          setOutput((prev) => [...prev, `[开机自启] 注册失败: ${res.error}`]);
        }
      }
    } catch (err) {
      setOutput((prev) => [...prev, `[开机自启] 操作异常: ${err}`]);
    }
    setServiceLoading(false);
  }, [serviceRegistered, gatewayConfig]);

  async function configureTailscale(mode: "serve" | "funnel" | "tailnet") {
    setRemoteLoading(mode);
    const port = gatewayConfig.port || "18789";
    const lines: string[] = [];
    const run = async (cmd: string) => {
      lines.push(`> ${cmd}`);
      const res = await window.electronAPI.exec(cmd);
      if (res.stdout.trim()) lines.push(...res.stdout.split(/\r?\n/).filter(Boolean));
      if (res.stderr.trim()) lines.push(...res.stderr.split(/\r?\n/).filter(Boolean));
      if (res.code !== 0) throw new Error(`命令失败: ${cmd}`);
    };

    try {
      await refreshTailscaleInfo();
      if (!tailscaleReady && !(await window.electronAPI.which("tailscale"))) {
        throw new Error("未检测到 tailscale 命令，请先在基础环境步骤安装或登录 Tailscale");
      }
      await run("tailscale status");

      if (mode === "serve") {
        await run('openclaw config set gateway.bind "loopback"');
        await run('openclaw config set gateway.tailscale.mode "serve"');
        await run('openclaw config set gateway.auth.allowTailscale true');
        if (tailscaleHost) {
          await run(`openclaw config set gateway.controlUi.allowedOrigins '["https://${tailscaleHost}"]'`);
        }
        lines.push("已配置 Tailscale Serve。推荐通过 HTTPS 访问控制台和 ACP。 ");
      } else if (mode === "funnel") {
        const password = tokenValue || `oc-${Math.random().toString(36).slice(2, 14)}`;
        await run('openclaw config set gateway.bind "loopback"');
        await run('openclaw config set gateway.tailscale.mode "funnel"');
        await run('openclaw config set gateway.auth.mode "password"');
        await run(`openclaw config set gateway.auth.password "${password}"`);
        await run('openclaw config set gateway.auth.allowTailscale false');
        if (tailscaleHost) {
          await run(`openclaw config set gateway.controlUi.allowedOrigins '["https://${tailscaleHost}"]'`);
        }
        lines.push(`已配置 Tailscale Funnel。共享密码: ${password}`);
        lines.push("注意: Funnel 是公网暴露方式，只建议在必须公网访问时启用。");
      } else {
        await run('openclaw config set gateway.tailscale.mode "off"');
        await run('openclaw config set gateway.bind "tailnet"');
        await run('openclaw config set gateway.auth.mode "token"');
        await run('openclaw config set gateway.auth.allowTailscale false');
        if (tokenValue) {
          await run(`openclaw config set gateway.auth.token "${tokenValue}"`);
        }
        if (tailscaleIp) {
          await run(`openclaw config set gateway.controlUi.allowedOrigins '["http://${tailscaleIp}:${port}"]'`);
        }
        lines.push("已配置 Tailnet 直连。仅建议 ACP/受信设备使用，控制台仍优先推荐 Serve HTTPS。");
      }

      setOutput((prev) => [...prev, ...lines]);
      await refreshTailscaleInfo();
    } catch (err) {
      setOutput((prev) => [...prev, ...lines, `❌ Tailscale 配置失败: ${err}`]);
    }
    setRemoteLoading(null);
  }

  async function writeGatewayTokenFile() {
    if (!tokenValue) {
      setOutput((prev) => [...prev, "⚠ 当前未配置 token，无法写入 gateway.token 文件"]);
      return;
    }
    const cmd = [
      '$dir = Join-Path $env:USERPROFILE ".openclaw"',
      'New-Item -ItemType Directory -Path $dir -Force | Out-Null',
      `$path = Join-Path $dir "gateway.token"`,
      `Set-Content -Path $path -Value "${tokenValue.replace(/"/g, '`"')}" -Encoding UTF8`,
      'Write-Output $path',
    ].join('; ');
    const res = await window.electronAPI.exec(cmd);
    const pathLine = res.stdout.trim() || effectiveTokenPath;
    setOutput((prev) => [...prev, `✅ 已写入 token 文件: ${pathLine}`]);
  }

  // ─── System Check ──────────────────────────────────────────────────────────
  const runSystemCheck = useCallback(async () => {
    setChecking(true);
    setCheckResults(null);
    setOutput((prev) => [...prev, "[系统检测] 正在检查系统配置..."]);
    const results = await window.electronAPI.gatewaySystemCheck();
    setCheckResults(results);
    const allPass = results.every((r) => r.status === "pass");
    setOutput((prev) => [
      ...prev,
      `[系统检测] 完成 — ${allPass ? "全部通过 ✅" : "存在警告项，请查看下方详情"}`,
    ]);
    setChecking(false);
    return results;
  }, []);

  // ─── Service Controls ──────────────────────────────────────────────────────
  const handleStart = async () => {
    if (vipBlocked) {
      setOutput(["❌ VIP 未激活或已到期，无法启动网关。请先充值开通 VIP。"]);
      return;
    }
    setActionLoading("start");
    setOutput([]);
    // Run system check first
    setOutput(["[启动前检查] 正在检测系统配置..."]);
    const checks = await runSystemCheck();
    const hasFail = checks.some((c) => c.status === "fail");
    if (hasFail) {
      setOutput((prev) => [...prev, "", "❌ 系统检测发现严重问题，请先解决后再启动"]);
      setActionLoading(null);
      return;
    }
    setOutput((prev) => [...prev, "", "[服务启动] 正在设置网关模式..."]);
    const resolved = await window.electronAPI.resolveOpenClaw();
    // Ensure gateway.mode=local is set (required for gateway to start)
    await window.electronAPI.exec(`${resolved.cmd} config set gateway.mode local`, resolved.cwd);
    setOutput((prev) => [...prev, "[服务启动] 正在启动网关..."]);
    await window.electronAPI.gatewayStart({
      cmd: resolved.cmd,
      cwd: resolved.cwd,
      port: gatewayConfig.port || "18789",
      bind: gatewayConfig.bind || "loopback",
    });
    setActionLoading(null);
  };

  const handleStop = async () => {
    setActionLoading("stop");
    await window.electronAPI.gatewayStop();
    setActionLoading(null);
  };

  const handleSuspend = async () => {
    setActionLoading("suspend");
    const res = await window.electronAPI.gatewaySuspend();
    if (!res.ok) setOutput((prev) => [...prev, `[挂起失败] ${res.reason}`]);
    setActionLoading(null);
  };

  const handleResume = async () => {
    setActionLoading("resume");
    const res = await window.electronAPI.gatewayResume();
    if (!res.ok) {
      setOutput((prev) => [...prev, `[恢复失败] ${res.reason}`]);
      // If resume fails, try fresh start
      await handleStart();
    }
    setActionLoading(null);
  };

  async function verifySetup() {
    setOutput(["运行 openclaw doctor..."]);
    const resolved = await window.electronAPI.resolveOpenClaw();
    const unsub = window.electronAPI.onShellOutput((data) => {
      setOutput((prev) => [...prev, data.trim()].filter(Boolean));
    });
    const result = await window.electronAPI.exec(`${resolved.cmd} doctor`, resolved.cwd);
    unsub();
    setOutput((prev) => [...prev, result.stdout || "", result.stderr || ""]);
  }

  function minimizeToTray() {
    window.electronAPI.toTray();
  }

  async function openWebUI() {
    const port = gatewayConfig.port || "18789";
    let url = `http://localhost:${port}`;
    if (gatewayConfig.authToken) {
      url += `?token=${encodeURIComponent(gatewayConfig.authToken)}`;
    }
    const info = await window.electronAPI.getSystemInfo();
    if (info.platform === "win32") {
      await window.electronAPI.exec(`Start-Process '${url}'`);
    } else if (info.platform === "darwin") {
      await window.electronAPI.exec(`open '${url}'`);
    } else {
      await window.electronAPI.exec(`xdg-open '${url}'`);
    }
  }

  const isRunning = status === "running";
  const isSuspended = status === "suspended";
  const isBusy = status === "starting" || actionLoading !== null;

  // ─── Common commands list ──────────────────────────────────────────────────
  const commands = [
    { label: "启动网关", cmd: "openclaw gateway run --force --allow-unconfigured" },
    { label: "查看状态", cmd: "openclaw channels status --probe" },
    { label: "诊断", cmd: "openclaw doctor" },
    { label: "配置", cmd: "openclaw config edit" },
    { label: "发送消息", cmd: "openclaw message send --target ..." },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="text-center py-3">
        <PartyPopper className="h-10 w-10 mx-auto text-warning mb-2" />
        <h2 className="text-2xl font-bold tracking-tight">安装完成!</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          OpenClaw 已配置完毕，启动网关开始使用
        </p>
      </div>

      {/* ─── System Check ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                系统检测
              </CardTitle>
              <CardDescription>启动前自动检查系统配置</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={runSystemCheck}
              disabled={checking}
            >
              {checking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Activity className="mr-1.5 h-3.5 w-3.5" />}
              {checking ? "检查中..." : "重新检测"}
            </Button>
          </div>
        </CardHeader>
        {checkResults && (
          <CardContent className="pt-0">
            <div className="space-y-1.5 bg-black/30 rounded-md p-3 border">
              {checkResults.map((item, i) => (
                <CheckRow key={i} item={item} />
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            安全远程访问
          </CardTitle>
          <CardDescription>
            最后一环直接配置 ACP 远程接入和 Tailscale 发布。优先推荐 Tailscale Serve + `wss://` + `--token-file`。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-100">
            <div className="font-medium mb-1">安全原则</div>
            <div>1. ACP 远程接入优先使用 `wss://`，不要直接在命令行暴露长期 token。</div>
            <div>2. 控制台远程访问优先使用 Tailscale Serve，保持网关仍绑定在 loopback。</div>
            <div>3. Funnel 为公网暴露，只在必须公网访问时使用，并强制密码认证。</div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-md border bg-black/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-2"><Network className="h-4 w-4" />Tailscale 状态</span>
                <Badge variant={tailscaleReady ? "success" : "outline"}>{tailscaleReady ? "已检测" : "未检测"}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">MagicDNS: {tailscaleHost || "未解析"}</div>
              <div className="text-xs text-muted-foreground">Tailnet IP: {tailscaleIp || "未获取"}</div>
              <Button variant="outline" size="sm" onClick={refreshTailscaleInfo} disabled={remoteLoading !== null}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />刷新 Tailscale 信息
              </Button>
            </div>

            <div className="rounded-md border bg-black/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-2"><Link2 className="h-4 w-4" />ACP 远程接入</span>
                <CopyButton text={acpCommand} />
              </div>
              <div className="text-xs text-muted-foreground">推荐命令</div>
              <code className="block text-[11px] whitespace-pre-wrap break-all bg-black/40 rounded px-2 py-2">{acpCommand}</code>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={writeGatewayTokenFile} disabled={!tokenValue}>
                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />写入 token 文件
                </Button>
              </div>
            </div>
          </div>

          {!tailscaleReady && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-start gap-2">
              <Shield className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium mb-1">未检测到 Tailscale</div>
                <div>请先安装并登录 Tailscale，然后点击"刷新 Tailscale 信息"。可在一键安装步骤勾选"同时安装 Tailscale"，或手动下载安装：</div>
                <a href="#" className="underline text-amber-300 hover:text-amber-100" onClick={(e) => { e.preventDefault(); window.electronAPI.exec('start https://tailscale.com/download'); }}>https://tailscale.com/download</a>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className={`rounded-md border p-3 space-y-2 bg-black/10 ${!tailscaleReady ? "opacity-50" : ""}`}>
              <div className="text-sm font-medium">Tailscale Serve</div>
              <div className="text-xs text-muted-foreground">Tailnet 内 HTTPS 发布，最安全，适合控制台和 ACP。</div>
              <div className="text-[11px] text-muted-foreground break-all">{serveControlUrl || "https://<magicdns>/"}</div>
              <Button size="sm" className="w-full" onClick={() => configureTailscale("serve")} disabled={!tailscaleReady || remoteLoading !== null}>
                {remoteLoading === "serve" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Shield className="mr-1.5 h-3.5 w-3.5" />}
                启用 Serve
              </Button>
            </div>

            <div className={`rounded-md border p-3 space-y-2 bg-black/10 ${!tailscaleReady ? "opacity-50" : ""}`}>
              <div className="text-sm font-medium">Tailnet 直连</div>
              <div className="text-xs text-muted-foreground">参考文章里的 tailnet IP 访问方式，适合受信设备/ACP，控制台安全性弱于 Serve。</div>
              <div className="text-[11px] text-muted-foreground break-all">{tailnetControlUrl || `http://<tailnet-ip>:${gatewayConfig.port || "18789"}/`}</div>
              <Button variant="outline" size="sm" className="w-full" onClick={() => configureTailscale("tailnet")} disabled={!tailscaleReady || remoteLoading !== null}>
                {remoteLoading === "tailnet" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Network className="mr-1.5 h-3.5 w-3.5" />}
                配置直连
              </Button>
            </div>

            <div className={`rounded-md border p-3 space-y-2 bg-black/10 ${!tailscaleReady ? "opacity-50" : ""}`}>
              <div className="text-sm font-medium">Tailscale Funnel</div>
              <div className="text-xs text-muted-foreground">公网 HTTPS 暴露，必须密码认证，仅在需要外网访问时启用。</div>
              <div className="text-[11px] text-amber-400">公网暴露风险更高，请谨慎使用</div>
              <Button variant="outline" size="sm" className="w-full" onClick={() => configureTailscale("funnel")} disabled={!tailscaleReady || remoteLoading !== null}>
                {remoteLoading === "funnel" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="mr-1.5 h-3.5 w-3.5" />}
                配置 Funnel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Service Control ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">网关服务管理</CardTitle>
              <CardDescription>服务级别管理，支持自动重启和性能优化</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={status} />
              {pid && <span className="text-[10px] text-muted-foreground font-mono">PID:{pid}</span>}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* VIP blocked banner */}
          {vipBlocked && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
              <div className="text-xs">
                <span className="text-red-400 font-medium">
                  {isExpired() ? "VIP 已到期，服务已关闭" : "VIP 未激活"}
                </span>
                <span className="text-muted-foreground ml-1">— 请先充值后才能启动网关</span>
              </div>
            </div>
          )}

          {/* Service stats */}
          {(isRunning || isSuspended) && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-black/20 rounded-md p-2 border">
                <div className="text-[10px] text-muted-foreground">运行时间</div>
                <div className="text-sm font-mono font-medium">{formatUptime(uptime)}</div>
              </div>
              <div className="bg-black/20 rounded-md p-2 border">
                <div className="text-[10px] text-muted-foreground">内存占用</div>
                <div className="text-sm font-mono font-medium">{formatBytes(memory)}</div>
              </div>
              <div className="bg-black/20 rounded-md p-2 border">
                <div className="text-[10px] text-muted-foreground">重启次数</div>
                <div className="text-sm font-mono font-medium">{restartCount}</div>
              </div>
            </div>
          )}

          {/* Control buttons */}
          <div className="flex gap-2">
            {status === "stopped" || status === "error" ? (
              <Button onClick={handleStart} disabled={isBusy || vipBlocked} className="flex-1">
                {actionLoading === "start" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                启动网关
              </Button>
            ) : isSuspended ? (
              <>
                <Button onClick={handleResume} disabled={isBusy} className="flex-1">
                  {actionLoading === "resume" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  恢复运行
                </Button>
                <Button variant="destructive" onClick={handleStop} disabled={isBusy}>
                  <Square className="mr-2 h-4 w-4" />
                  停止
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={handleSuspend} disabled={isBusy} className="flex-1">
                  {actionLoading === "suspend" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Pause className="mr-2 h-4 w-4" />
                  )}
                  挂起
                </Button>
                <Button variant="destructive" onClick={handleStop} disabled={isBusy}>
                  {actionLoading === "stop" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="mr-2 h-4 w-4" />
                  )}
                  停止
                </Button>
              </>
            )}
            <Button variant="outline" onClick={verifySetup} disabled={isBusy}>
              <RotateCcw className="mr-2 h-4 w-4" />
              诊断
            </Button>
          </div>

          {/* Features description */}
          <div className="flex gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" />崩溃自动重启</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" />进程优先级优化</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" />健康状态监控</span>
          </div>

          {/* Output */}
          <TerminalOutput lines={output} className="max-h-40" />
        </CardContent>
      </Card>

      {/* ─── Auto Start Service ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Timer className="h-4 w-4" />
                开机自启
              </CardTitle>
              <CardDescription>
                注册 Windows 计划任务，登录后自动启动网关
              </CardDescription>
            </div>
            <Button
              variant={serviceRegistered ? "destructive" : "default"}
              size="sm"
              onClick={toggleService}
              disabled={serviceLoading}
            >
              {serviceLoading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : serviceRegistered ? (
                <Square className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {serviceRegistered ? "取消自启" : "注册自启"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="rounded-md border bg-black/20 p-3 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">状态:</span>
              <Badge variant={serviceRegistered ? "success" : "secondary"}>
                {serviceRegistered ? "已注册" : "未注册"}
              </Badge>
            </div>
            <div>任务名称: OpenClawGateway</div>
            <div>触发器: 用户登录时</div>
            <div>端口: {gatewayConfig.port || "18789"} | 绑定: {gatewayConfig.bind || "loopback"}</div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Management UI ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">管理界面</CardTitle>
          <CardDescription>终端界面 (TUI) 或浏览器界面 (WebUI)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" size="lg" className="h-18 flex-col gap-1.5" onClick={minimizeToTray}>
              <MonitorDown className="h-5 w-5" />
              <div className="text-center">
                <div className="text-sm font-medium">收纳到任务栏</div>
                <div className="text-[10px] text-muted-foreground">后台运行，右键菜单管理</div>
              </div>
            </Button>
            <Button variant="outline" size="lg" className="h-18 flex-col gap-1.5" onClick={openWebUI}>
              <Globe className="h-5 w-5" />
              <div className="text-center">
                <div className="text-sm font-medium">打开 WebUI</div>
                <div className="text-[10px] text-muted-foreground">localhost:{gatewayConfig.port || "18789"}</div>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Commands with copy buttons ───────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">常用命令</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {commands.map(({ label, cmd }) => (
              <div
                key={cmd}
                className="flex items-center gap-2 font-mono text-xs group rounded-md px-2 py-1.5 hover:bg-white/5 transition-colors"
              >
                <span className="text-muted-foreground shrink-0 w-20">{label}:</span>
                <code className="text-foreground flex-1 select-all">{cmd}</code>
                <CopyButton text={cmd} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ─── Footer ───────────────────────────────────────────────────────── */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>← 返回</Button>
        <Button variant="secondary" onClick={() => window.electronAPI.close()}>
          关闭向导
        </Button>
      </div>
    </div>
  );
}
