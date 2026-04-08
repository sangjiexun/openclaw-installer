import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { TitleBar } from "@/components/TitleBar";
import { Stepper, type Step } from "@/components/Stepper";
import { VipCard } from "@/components/VipCard";
import { VipContext, loadVipState, activateVipDb, resetVipDb, type VipState } from "@/lib/vip";
import {
  RemoteConfigContext, DEFAULT_REMOTE_CONFIG, fetchLocalConfig, fetchRemoteConfig, startConfigPolling,
  type RemoteConfig,
} from "@/lib/remoteConfig";
import { WelcomeStep } from "@/steps/WelcomeStep";
import { OneClickInstallStep } from "@/steps/OneClickInstallStep";
import { ConfigModelStep } from "@/steps/ConfigModelStep";
import { GatewayConfigStep } from "@/steps/GatewayConfigStep";
import { ChannelStep } from "@/steps/ChannelStep";
import { ApplyConfigStep } from "@/steps/ApplyConfigStep";
import { FinishStep } from "@/steps/FinishStep";

const STEPS: Step[] = [
  { id: "welcome", title: "环境检测", description: "检查系统依赖" },
  { id: "install", title: "一键安装", description: "沙箱运行时 + CLI" },
  { id: "model", title: "AI 模型", description: "配置 LLM 提供商" },
  { id: "gateway", title: "网关设置", description: "端口、绑定、认证" },
  { id: "channels", title: "消息通道", description: "连接消息平台" },
  { id: "apply", title: "应用配置", description: "写入配置文件" },
  { id: "finish", title: "完成", description: "启动网关" },
];

export default function App() {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // VIP state
  const [vip, setVip] = useState<VipState>({ active: false, expiresAt: null });

  // Remote config (banben.json) — fetched on mount, polled every 30 min
  const [remoteConfig, setRemoteConfig] = useState<RemoteConfig>(DEFAULT_REMOTE_CONFIG);

  // Admin unlock state — set true by the 10-click version password trick
  const [adminUnlocked, setAdminUnlocked] = useState(false);

  // Track whether gateway was auto-stopped due to expiration (prevents repeated stops)
  const expiredStoppedRef = useRef(false);

  // Reload VIP from SQLite (used by periodic check + after payment)
  const reloadVip = useCallback(async () => {
    const state = await loadVipState();
    setVip(state);
    return state;
  }, []);

  // Load VIP from SQLite on mount
  useEffect(() => {
    reloadVip();
  }, [reloadVip]);

  // Periodic VIP expiration check — every 60 seconds, reload from DB
  // DB auto-sets active=0 when expired, so re-reading is enough
  useEffect(() => {
    const timer = setInterval(async () => {
      const state = await reloadVip();
      // If VIP just expired and gateway might be running, auto-stop it
      // But skip auto-stop when admin is unlocked (password bypass)
      if (!state.active && state.expiresAt && !expiredStoppedRef.current && !adminUnlocked) {
        expiredStoppedRef.current = true;
        try { await window.electronAPI.gatewayStop(); } catch { /* ignore */ }
      }
      // Reset flag when VIP is re-activated
      if (state.active) expiredStoppedRef.current = false;
    }, 60_000);
    return () => clearInterval(timer);
  }, [reloadVip, adminUnlocked]);

  // Load local banben.json first (immediate, works offline), then try remote
  useEffect(() => {
    fetchLocalConfig().then((local) => { if (local) setRemoteConfig(local); });
    fetchRemoteConfig().then((cfg) => { if (cfg) setRemoteConfig(cfg); });
    return startConfigPolling(setRemoteConfig);
  }, []);

  const vipCtx = useMemo(() => ({
    vip,
    activate: async (months: number, outTradeNo?: string, amount?: number) => {
      console.log(`[VIP] activate called: months=${months}, tradeNo=${outTradeNo}, amount=${amount}`);
      const next = await activateVipDb(months, outTradeNo, amount);
      console.log("[VIP] activateVipDb returned:", JSON.stringify(next));
      setVip(next);
      expiredStoppedRef.current = false; // allow gateway start after recharge
      // Belt-and-suspenders: reload from DB to verify persistence
      try {
        const verified = await reloadVip();
        console.log("[VIP] reloadVip verified:", JSON.stringify(verified));
      } catch (e) { console.error("[VIP] reloadVip error:", e); }
    },
    resetVip: async () => {
      const next = await resetVipDb();
      setVip(next);
    },
    reloadVip,
    isExpired: () => {
      // VIP was once active but has expired (expiresAt in the past, active=false)
      if (vip.active) return false;
      if (!vip.expiresAt) return false;
      return new Date(vip.expiresAt).getTime() < Date.now();
    },
    isExpiringSoon: () => {
      if (!vip.active || !vip.expiresAt) return false;
      const diff = new Date(vip.expiresAt).getTime() - Date.now();
      return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000;
    },
    daysRemaining: () => {
      if (!vip.expiresAt) return 0;
      return Math.max(0, Math.ceil((new Date(vip.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    },
    adminUnlocked,
    setAdminUnlocked,
  }), [vip, reloadVip, adminUnlocked, setAdminUnlocked]);

  // Model config state
  const [modelConfig, setModelConfig] = useState({
    provider: "dmxapi",
    apiKey: "sk-lDqloedR32DFKp4rhsRLiVLGiNjQZA7ISKG2s4tqAkkdlflk",
    model: "GLM-4.7-Flash",
    baseUrl: "https://www.dmxapi.cn/v1",
  });

  // Gateway config state
  const [gatewayConfig, setGatewayConfig] = useState({
    port: "18789",
    bind: "loopback",
    authMode: "token",
    authToken: "",
  });

  // Channel config state
  const [channels, setChannels] = useState<
    { type: string; enabled: boolean; token: string; dmPolicy: string; feishuAppId?: string; feishuAppSecret?: string; feishuConnectionMode?: string; feishuEncryptKey?: string; feishuVerificationToken?: string }[]
  >([]);

  // Install config state (path + sandbox mode + PATH registration)
  const [installConfig, setInstallConfig] = useState({
    installPath: "",
    sandboxMode: "off",
    addToPath: true,
  });

  function goNext() {
    setCompletedSteps((prev) => new Set([...prev, currentStep]));
    setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  }

  function goBack() {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }

  function renderStep() {
    switch (STEPS[currentStep].id) {
      case "welcome":
        return <WelcomeStep onNext={goNext} installConfig={installConfig} setInstallConfig={setInstallConfig} />;
      case "install":
        return <OneClickInstallStep onNext={goNext} onBack={goBack} />;
      case "model":
        return <ConfigModelStep onNext={goNext} onBack={goBack} config={modelConfig} setConfig={setModelConfig} />;
      case "gateway":
        return <GatewayConfigStep onNext={goNext} onBack={goBack} config={gatewayConfig} setConfig={setGatewayConfig} />;
      case "channels":
        return <ChannelStep onNext={goNext} onBack={goBack} channels={channels} setChannels={setChannels} />;
      case "apply":
        return (
          <ApplyConfigStep
            onNext={goNext}
            onBack={goBack}
            modelConfig={modelConfig}
            gatewayConfig={gatewayConfig}
            channels={channels}
          />
        );
      case "finish":
        return <FinishStep onBack={goBack} gatewayConfig={gatewayConfig} />;
      default:
        return null;
    }
  }

  return (
    <RemoteConfigContext.Provider value={remoteConfig}>
    <VipContext.Provider value={vipCtx}>
    <div className="flex flex-col h-screen">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-56 border-r bg-card/50 p-4 shrink-0 overflow-y-auto flex flex-col">
          <div className="mb-4">
            <h1 className="text-sm font-bold tracking-tight">OpenClaw</h1>
            <p className="text-[10px] text-muted-foreground">安装配置向导</p>
          </div>
          <Stepper steps={STEPS} currentStep={currentStep} completedSteps={completedSteps} />
          <VipCard />
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-8 relative">
          {/* VIP mask overlay — blocks all interaction when inactive */}
          {!vip.active && !adminUnlocked && (
            <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] z-10 flex items-center justify-center pointer-events-auto">
              <div className="text-center max-w-xs">
                {vipCtx.isExpired() ? (
                  /* Expired state */
                  <>
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-500/20 mb-3">
                      <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <p className="text-red-400 font-medium text-sm mb-1">VIP 已到期，服务已关闭</p>
                    <p className="text-muted-foreground text-xs mb-1">到期时间: {vip.expiresAt ? new Date(vip.expiresAt).toLocaleString("zh-CN") : "-"}</p>
                    <p className="text-muted-foreground/70 text-[10px]">请点击左下角重新充值以恢复服务</p>
                  </>
                ) : (
                  /* Never activated */
                  <>
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#6c63ff]/20 mb-3">
                      <svg className="h-6 w-6 text-[#6c63ff]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <p className="text-muted-foreground text-sm mb-1">请先充值开通 VIP</p>
                    <p className="text-muted-foreground/70 text-[10px]">点击左下角充值卡激活全部功能</p>
                  </>
                )}
              </div>
            </div>
          )}
          <div className={!vip.active && !adminUnlocked ? "pointer-events-none" : ""}>
            <div className="max-w-2xl mx-auto">
              {renderStep()}
            </div>
          </div>
        </div>
      </div>
    </div>
    </VipContext.Provider>
    </RemoteConfigContext.Provider>
  );
}
