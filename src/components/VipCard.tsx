import { useState, useRef, useEffect } from "react";
import { useVip } from "@/lib/vip";
import { useRemoteConfig } from "@/lib/remoteConfig";
import { PaymentDialog } from "@/components/PaymentDialog";
import { Crown, RefreshCw, Wrench, AlertCircle, Download, CheckCircle2 } from "lucide-react";

export function VipCard() {
  const { vip, resetVip, isExpired, isExpiringSoon, daysRemaining, adminUnlocked, setAdminUnlocked } = useVip();
  const config = useRemoteConfig();
  const [showPayment, setShowPayment] = useState(false);
  const [payPlanKey, setPayPlanKey] = useState<"monthly" | "install">("monthly");

  // App version + update check
  const [appVersion, setAppVersion] = useState("");
  const [ocVersion, setOcVersion] = useState<string>("检测中…");
  const [checking, setChecking] = useState(false);
  const [latestVersion, setLatestVersion] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadPct, setDownloadPct] = useState(0);
  const [updateApplied, setUpdateApplied] = useState(false);

  // openclaw CLI auto-update state
  const [ocUpdateStatus, setOcUpdateStatus] = useState<"idle" | "checking" | "updating" | "done" | "error">("idle");
  const [ocUpdateTarget, setOcUpdateTarget] = useState("");
  const [ocUpdateLog, setOcUpdateLog] = useState<string[]>([]);
  const [ocHasUpdate, setOcHasUpdate] = useState(false);
  const [ocInstallPct, setOcInstallPct] = useState(0);
  const [ocInstallLabel, setOcInstallLabel] = useState("安装中...");

  useEffect(() => {
    window.electronAPI.getAppVersion?.().then((v) => v && setAppVersion(v)).catch(() => {});
    fetchOcVersion();
    doOcAutoUpdate();
    // Auto-check installer update after a small delay
    const t = setTimeout(doCheckUpdate, 4000);
    return () => clearTimeout(t);
  }, []);

  async function fetchOcVersion() {
    try {
      const r = await window.electronAPI.exec("openclaw --version");
      const v = (r.stdout || r.stderr || "").trim().replace(/^openclaw\s*/i, "");
      setOcVersion(v || "未安装");
    } catch {
      setOcVersion("未安装");
    }
  }

  async function doOcAutoUpdate() {
    setOcUpdateStatus("checking");
    setOcHasUpdate(false);
    try {
      const check = await window.electronAPI.ocCheckUpdate?.();
      if (!check?.ok || !check.hasUpdate) {
        setOcUpdateStatus("idle");
        return;
      }
      setOcHasUpdate(true);
      setOcUpdateTarget(check.latest ?? "");
      setOcUpdateStatus("updating");
      setOcUpdateLog([]);
      setOcInstallPct(0);
      setOcInstallLabel("准备中...");
      const unsub = window.electronAPI.onOcUpdateOutput?.((line) => {
        if (line.startsWith("__PCT__:")) {
          const parts = line.split(":");
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) setOcInstallPct(n);
          const label = parts.slice(2).join(":");
          if (label) setOcInstallLabel(label);
          return;
        }
        setOcUpdateLog((prev) => [...prev.slice(-30), line]);
      });
      const result = await window.electronAPI.ocInstall?.();
      unsub?.();
      if (result?.ok) {
        setOcInstallPct(100);
        setOcUpdateStatus("done");
        // Use version returned by the install handler (read from package.json)
        // rather than re-running `openclaw --version` which may be stale.
        if (result.version) {
          setOcVersion(result.version.replace(/\s*\([^)]+\)$/, ""));
        } else {
          fetchOcVersion();
        }
      } else {
        setOcUpdateStatus("error");
      }
    } catch {
      setOcUpdateStatus("error");
    }
  }

  async function doOcForceInstall() {
    setOcUpdateStatus("updating");
    setOcUpdateLog([]);
    setOcInstallPct(0);
    setOcInstallLabel("准备中...");
    try {
      const unsub = window.electronAPI.onOcUpdateOutput?.((line) => {
        if (line.startsWith("__PCT__:")) {
          const parts = line.split(":");
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) setOcInstallPct(n);
          const label = parts.slice(2).join(":");
          if (label) setOcInstallLabel(label);
          return;
        }
        setOcUpdateLog((prev) => [...prev.slice(-30), line]);
      });
      const result = await window.electronAPI.ocInstall?.();
      unsub?.();
      if (result?.ok) {
        setOcInstallPct(100);
        setOcUpdateStatus("done");
        if (result.version) {
          setOcVersion(result.version.replace(/\s*\([^)]+\)$/, ""));
        } else {
          fetchOcVersion();
        }
      } else {
        setOcUpdateStatus("error");
      }
    } catch {
      setOcUpdateStatus("error");
    }
  }

  async function doCheckUpdate() {
    setChecking(true);
    try {
      const result = await window.electronAPI.checkUpdate?.();
      if (result?.ok && result.hasUpdate) {
        setLatestVersion(result.latest ?? "");
        setDownloadUrl(result.downloadUrl ?? null);
      } else {
        setLatestVersion("");
        setDownloadUrl(null);
      }
    } catch { /* ignore */ }
    setChecking(false);
  }

  async function applyUpdate() {
    if (!downloadUrl) {
      window.electronAPI.openVersionsPage?.();
      return;
    }
    setDownloading(true);
    setDownloadPct(0);
    const unsub = window.electronAPI.onUpdateProgress?.((d) => {
      if (d.pct >= 0) setDownloadPct(d.pct);
    });
    try {
      const result = await window.electronAPI.downloadUpdate?.(downloadUrl);
      if (result?.ok) {
        setUpdateApplied(true);
        setLatestVersion("");
      }
    } catch { /* ignore */ }
    unsub?.();
    setDownloading(false);
  }

  // 10-click version unlock
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAdminDialog, setShowAdminDialog] = useState(false);
  const [adminPwd, setAdminPwd] = useState("");
  const [adminPwdErr, setAdminPwdErr] = useState(false);

  function handleVersionClick() {
    clickCountRef.current++;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => { clickCountRef.current = 0; }, 3000);
    if (clickCountRef.current >= 10) {
      clickCountRef.current = 0;
      setAdminPwd("");
      setAdminPwdErr(false);
      setShowAdminDialog(true);
    }
  }

  function submitAdminPwd() {
    if (adminPwd === "8881101640") {
      setAdminUnlocked(true);
      setShowAdminDialog(false);
    } else {
      setAdminPwdErr(true);
    }
  }

  const days = daysRemaining();
  const expiringSoon = isExpiringSoon();
  const expired = isExpired();
  const monthly = config.plans.monthly;
  const install = config.plans.install;

  function openPayment(plan: "monthly" | "install") {
    setPayPlanKey(plan);
    setShowPayment(true);
  }

  return (
    <>
      <div className="mt-auto pt-3 space-y-2">
        {vip.active ? (
          /* ── VIP active state ── */
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 px-1">
              <Crown className="h-3.5 w-3.5 text-yellow-400" />
              <span className="text-[11px] text-yellow-400 font-medium">VIP 会员</span>
            </div>
            <div className="text-[10px] text-muted-foreground px-1">
              到期: {vip.expiresAt ? new Date(vip.expiresAt).toLocaleDateString("zh-CN") : "-"}
              {days >= 0 && <span className="ml-1 text-muted-foreground/60">({days}天)</span>}
            </div>
            {expiringSoon && (
              <button
                onClick={() => openPayment("monthly")}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-orange-400 bg-orange-400/10 hover:bg-orange-400/20 border border-orange-400/20 rounded-lg transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                续期
              </button>
            )}
            <button
              onClick={() => resetVip()}
              className="w-full flex items-center justify-center gap-1.5 py-1 text-[10px] text-muted-foreground/60 hover:text-red-400 transition-colors"
            >
              退订 VIP
            </button>
          </div>
        ) : expired ? (
          /* ── VIP expired state — must recharge ── */
          <div className="space-y-2">
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                <span className="text-[11px] text-red-400 font-medium">VIP 已到期</span>
              </div>
              <p className="text-[10px] text-red-300/70">
                到期时间: {vip.expiresAt ? new Date(vip.expiresAt).toLocaleString("zh-CN") : "-"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                服务已关闭，重新充值后可恢复使用
              </p>
            </div>

            {/* Renewal buttons — same payment cards */}
            {monthly.enabled && (
              <button
                onClick={() => openPayment("monthly")}
                className="w-full group relative overflow-hidden rounded-xl border border-red-500/30 bg-gradient-to-br from-red-500/15 to-[#e91e63]/10 p-3 text-left transition-all hover:border-red-500/50 hover:from-red-500/25 hover:to-[#e91e63]/15 animate-pulse"
              >
                <div className="flex items-center gap-2 mb-1">
                  <RefreshCw className="h-4 w-4 text-red-400" />
                  <span className="text-xs font-bold text-white">¥{monthly.price}/{monthly.unit}</span>
                  <span className="ml-auto bg-red-500/20 text-red-300 text-[9px] px-1.5 py-0.5 rounded-full">续费</span>
                </div>
                <p className="text-[10px] text-red-300/60">立即续费恢复全部服务</p>
              </button>
            )}

            {install.enabled && (
              <button
                onClick={() => openPayment("install")}
                className="w-full group relative overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 to-teal-500/10 p-3 text-left transition-all hover:border-emerald-500/50 hover:from-emerald-500/25 hover:to-teal-500/15"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Wrench className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white">¥{install.price}/{install.unit}</span>
                  <span className="ml-auto bg-emerald-500/20 text-emerald-300 text-[9px] px-1.5 py-0.5 rounded-full">{install.name}</span>
                </div>
                <p className="text-[10px] text-emerald-300/60">专业工程师远程/上门部署</p>
              </button>
            )}
          </div>
        ) : (
          /* ── Payment cards (never activated) ── */
          <div className="space-y-2">
            {/* Monthly subscription */}
            {monthly.enabled && (
              <button
                onClick={() => openPayment("monthly")}
                className="w-full group relative overflow-hidden rounded-xl border border-[#6c63ff]/30 bg-gradient-to-br from-[#6c63ff]/15 to-[#e91e63]/10 p-3 text-left transition-all hover:border-[#6c63ff]/50 hover:from-[#6c63ff]/25 hover:to-[#e91e63]/15"
              >
                <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-[#6c63ff]/20 to-transparent rounded-bl-full" />
                <div className="flex items-center gap-2 mb-1.5">
                  <Crown className="h-4 w-4 text-yellow-400" />
                  <span className="text-xs font-bold text-white">¥{monthly.price}/{monthly.unit}</span>
                  <span className="ml-auto bg-[#e91e63]/20 text-[#ff6b9d] text-[9px] px-1.5 py-0.5 rounded-full">{monthly.name}</span>
                </div>
                <p className="text-[10px] text-[#a9a6ff]">模型积分免费中</p>
              </button>
            )}

            {/* On-site installation */}
            {install.enabled && (
              <button
                onClick={() => openPayment("install")}
                className="w-full group relative overflow-hidden rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 to-teal-500/10 p-3 text-left transition-all hover:border-emerald-500/50 hover:from-emerald-500/25 hover:to-teal-500/15"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Wrench className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white">¥{install.price}/{install.unit}</span>
                  <span className="ml-auto bg-emerald-500/20 text-emerald-300 text-[9px] px-1.5 py-0.5 rounded-full">{install.name}</span>
                </div>
                <p className="text-[10px] text-emerald-300/60">专业工程师远程/上门部署</p>
              </button>
            )}
          </div>
        )}

        {/* Version rows + update button */}
        <div className="space-y-1">
          {/* OpenClaw CLI version row */}
          <div
            className="flex items-center gap-1 px-0.5 cursor-default select-none min-w-0"
            onClick={handleVersionClick}
          >
            <span className="text-[10px] font-mono leading-none min-w-0 flex-1 truncate">
              <span className="text-muted-foreground/60">openclaw</span>
              &nbsp;
              <span className={ocUpdateStatus === "done" ? "text-green-400" : "text-muted-foreground/90"}>
                {ocVersion.replace(/\s*\([^)]+\)$/, "")}
              </span>
            </span>
            {ocUpdateStatus === "done" && (
              <span className="shrink-0 text-green-400/70 text-[9px]">✓</span>
            )}
            {ocUpdateStatus === "error" && (
              <span className="shrink-0 text-orange-400/70 text-[9px]">失败</span>
            )}
            <div className="flex items-center gap-1 shrink-0">
              {/* Idle: update button + refresh */}
              {ocUpdateStatus === "idle" && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); doOcForceInstall(); }}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border border-[#6c63ff]/30 bg-[#6c63ff]/10 hover:bg-[#6c63ff]/20 hover:border-[#6c63ff]/50 text-[9px] font-medium text-[#a9a6ff] transition-all"
                    title="下载并安装最新 openclaw 源码"
                  >
                    <Download className="h-2 w-2" />
                    更新源码
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); fetchOcVersion(); }}
                    className="p-0.5 text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors"
                    title="刷新版本"
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                  </button>
                </>
              )}
              {/* Checking spinner */}
              {ocUpdateStatus === "checking" && (
                <span className="flex items-center gap-1 text-[9px] text-muted-foreground/50">
                  <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                  检查中
                </span>
              )}
              {/* Error: retry button */}
              {ocUpdateStatus === "error" && (
                <button
                  onClick={(e) => { e.stopPropagation(); doOcForceInstall(); }}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 hover:border-orange-500/50 text-[9px] font-medium text-orange-300 transition-all"
                  title="重试更新"
                >
                  <RefreshCw className="h-2 w-2" />
                  重试
                </button>
              )}
            </div>
          </div>

          {/* Progress bar — shown while updating */}
          {ocUpdateStatus === "updating" && (
            <div className="px-0.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-[#a9a6ff]">
                  {ocInstallLabel}
                </span>
                <span className="text-[9px] text-[#a9a6ff]/70 tabular-nums">{ocInstallPct}%</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#6c63ff] to-[#e91e63] rounded-full transition-all duration-500"
                  style={{ width: `${ocInstallPct}%` }}
                />
              </div>
              {ocUpdateLog.length > 0 && (
                <div className="text-[8px] text-muted-foreground/40 font-mono truncate leading-tight">
                  {ocUpdateLog[ocUpdateLog.length - 1]}
                </div>
              )}
            </div>
          )}

          {/* Installer version row */}
          <div className="flex items-center justify-between px-0.5 select-none">
            <span className="text-[10px] text-muted-foreground/50 font-mono">
              installer&nbsp;{appVersion ? `v${appVersion}` : `v${config.version}`}
              {adminUnlocked && <span className="ml-1 text-green-500/60">✓</span>}
            </span>

            {/* Installer update available */}
            {latestVersion && !downloading && !updateApplied && (
              <button
                onClick={applyUpdate}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border border-[#6c63ff]/30 bg-[#6c63ff]/10 hover:bg-[#6c63ff]/20 hover:border-[#6c63ff]/50 text-[9px] font-medium text-[#a9a6ff] transition-all"
                title={`更新安装包到 v${latestVersion}`}
              >
                <Download className="h-2 w-2" />
                v{latestVersion}
              </button>
            )}

            {/* Installer downloading progress bar */}
            {downloading && (
              <div className="flex items-center gap-1.5 min-w-0 flex-1 ml-2">
                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#6c63ff] to-[#e91e63] rounded-full transition-all duration-300"
                    style={{ width: downloadPct > 0 ? `${downloadPct}%` : "30%" }}
                  />
                </div>
                <span className="text-[9px] text-[#a9a6ff] shrink-0 tabular-nums">
                  {downloadPct > 0 ? `${downloadPct}%` : "…"}
                </span>
              </div>
            )}

            {/* Restart after installer update */}
            {updateApplied && (
              <button
                onClick={() => window.electronAPI.restartApp?.()}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 hover:border-green-500/50 text-[9px] font-medium text-green-300 transition-all"
              >
                <CheckCircle2 className="h-2 w-2" />
                重启
              </button>
            )}

            {/* Check installer update button */}
            {!latestVersion && !downloading && !updateApplied && (
              <button
                onClick={doCheckUpdate}
                disabled={checking}
                className="p-0.5 text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors disabled:opacity-40"
                title="检查安装包更新"
              >
                <RefreshCw className={`h-2.5 w-2.5 ${checking ? "animate-spin" : ""}`} />
              </button>
            )}
          </div>
        </div>
      </div>

      <PaymentDialog
        open={showPayment}
        onClose={() => setShowPayment(false)}
        plan={config.plans[payPlanKey]}
        planKey={payPlanKey}
      />

      {/* Admin unlock dialog */}
      {showAdminDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAdminDialog(false)} />
          <div className="relative bg-[#1a1a2e] border border-[#6c63ff]/30 rounded-2xl w-[280px] p-5 shadow-2xl">
            <p className="text-white text-sm font-medium mb-3 text-center">输入管理员密码</p>
            <input
              type="password"
              value={adminPwd}
              onChange={(e) => { setAdminPwd(e.target.value); setAdminPwdErr(false); }}
              onKeyDown={(e) => e.key === "Enter" && submitAdminPwd()}
              placeholder="密码"
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#6c63ff]/60 mb-2"
            />
            {adminPwdErr && (
              <p className="text-red-400 text-[11px] mb-2 text-center">密码错误，请重试</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setShowAdminDialog(false)}
                className="flex-1 py-1.5 text-xs text-muted-foreground bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
              >取消</button>
              <button
                onClick={submitAdminPwd}
                className="flex-1 py-1.5 text-xs text-white bg-[#6c63ff] hover:bg-[#5a52e0] rounded-lg transition-colors"
              >确认</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
