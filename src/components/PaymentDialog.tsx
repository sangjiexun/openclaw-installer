import { useState, useEffect, useRef, useCallback } from "react";
import { useVip } from "@/lib/vip";
import type { PayPlan } from "@/lib/remoteConfig";
import { Crown, X, Sparkles, CheckCircle2, Loader2, QrCode, RefreshCw, Wrench } from "lucide-react";

// QR code generated via public API (no server needed)
const QR_API = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=";

interface PaymentDialogProps {
  open: boolean;
  onClose: () => void;
  plan: PayPlan;
  planKey: "monthly" | "install";
}

type PayStage = "idle" | "creating" | "scanning" | "success" | "error" | "timeout";

export function PaymentDialog({ open, onClose, plan, planKey }: PaymentDialogProps) {
  const { activate } = useVip();
  const [stage, setStage] = useState<PayStage>("idle");
  const [qrUrl, setQrUrl] = useState("");
  const [outTradeNo, setOutTradeNo] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  // Cleanup on unmount or close
  useEffect(() => {
    if (!open) { cleanup(); setStage("idle"); setQrUrl(""); setOutTradeNo(""); }
    return cleanup;
  }, [open, cleanup]);

  const isMonthly = planKey === "monthly";
  const Icon = isMonthly ? Crown : Wrench;
  const gradientFrom = isMonthly ? "#6c63ff" : "#10b981";
  const gradientTo = isMonthly ? "#e91e63" : "#14b8a6";

  async function handlePay() {
    cleanup();
    settledRef.current = false;
    setStage("creating");
    setErrorMsg("");

    try {
      // Call WeChat Pay via Electron main process (no external server)
      const res = await window.electronAPI.payCreateOrder(plan.price, plan.description);

      if (!res.success) {
        setStage("error");
        setErrorMsg(res.message || "创建订单失败");
        return;
      }

      const tradeNo = res.data.out_trade_no;
      const codeUrl = res.data.code_url;
      setOutTradeNo(tradeNo);
      // Generate QR code image from the weixin:// payment URL
      setQrUrl(`${QR_API}${encodeURIComponent(codeUrl)}`);
      setStage("scanning");

      // Start 120s countdown
      let remaining = 120;
      setCountdown(remaining);
      countdownRef.current = setInterval(() => {
        remaining--;
        setCountdown(remaining);
        if (remaining <= 0) {
          cleanup();
          setStage("timeout");
        }
      }, 1000);

      // Poll payment status every 3s via Electron IPC
      let checks = 0;
      pollingRef.current = setInterval(async () => {
        if (settledRef.current) return;
        checks++;
        if (checks > 40) { cleanup(); setStage("timeout"); return; }
        try {
          const statusRes = await window.electronAPI.payCheckStatus(tradeNo);
          console.log(`[Payment] Poll #${checks} tradeNo=${tradeNo}`, JSON.stringify(statusRes));
          if (statusRes.success && statusRes.data?.status === "SUCCESS") {
            if (settledRef.current) return; // guard double fire
            settledRef.current = true;
            cleanup();
            console.log("[Payment] WeChat SUCCESS detected, activating VIP...");
            // Update order status in local DB
            try { await window.electronAPI.dbOrderUpdateStatus(tradeNo, "SUCCESS"); } catch {}
            // Monthly gives 1 month VIP; install gives 12 months
            const months = isMonthly ? 1 : 12;
            try {
              console.log(`[Payment] Calling activate(${months}, ${tradeNo}, ${plan.price})`);
              await activate(months, tradeNo, plan.price);
              console.log("[Payment] activate() returned successfully");
              setStage("success");
              setTimeout(() => { setStage("idle"); onClose(); }, 1500);
            } catch (err) {
              console.error("[Payment] VIP activation failed after successful payment:", err);
              setStage("error");
              setErrorMsg("支付成功但 VIP 激活失败，请重启应用或联系客服");
            }
          }
        } catch (err) {
          console.error("[Payment] Poll error:", err);
        }
      }, 3000);
    } catch (e: unknown) {
      setStage("error");
      setErrorMsg(e instanceof Error ? e.message : "支付服务异常，请稍后重试");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { cleanup(); onClose(); }} />

      {/* Dialog */}
      <div className="relative bg-[#1a1a2e] border border-[#6c63ff]/30 rounded-2xl w-[400px] shadow-2xl overflow-hidden">
        {/* Gradient header */}
        <div className="relative p-6 pb-8" style={{ background: `linear-gradient(to right, ${gradientFrom}, ${gradientTo})` }}>
          <button
            onClick={() => { cleanup(); onClose(); }}
            className="absolute top-3 right-3 p-1 rounded-full hover:bg-white/20 transition-colors"
          >
            <X className="h-4 w-4 text-white/80" />
          </button>
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-xl p-2.5">
              <Icon className="h-7 w-7 text-yellow-300" />
            </div>
            <div>
              <h3 className="text-white font-bold text-lg">{plan.name}</h3>
              <p className="text-white/70 text-xs">{isMonthly ? '解锁全部功能，畅享 AI 体验' : '专业工程师远程/上门部署'}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 -mt-3">
          {/* Idle / Creating: show price + benefits + button */}
          {(stage === "idle" || stage === "creating") && (
            <>
              {/* Price card */}
              <div className="rounded-xl p-4 mb-4 border" style={{ background: `linear-gradient(to bottom right, ${gradientFrom}20, ${gradientTo}10)`, borderColor: `${gradientFrom}30` }}>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-3xl font-bold text-white">¥{plan.price}</span>
                  <span className="text-muted-foreground text-sm">/{plan.unit}</span>
                </div>
                <p className="text-[#a9a6ff] text-xs">{plan.description}</p>
              </div>

              {/* Benefits */}
              <div className="space-y-2 mb-5">
                {(isMonthly
                  ? ["全部 AI 模型无限调用", "高级网关配置功能", "多通道消息同步", "优先技术支持"]
                  : ["专业工程师远程部署", "完整环境配置", "通道接入调试", "一对一技术指导"]
                ).map((text) => (
                  <div key={text} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: gradientFrom }} />
                    <span>{text}</span>
                  </div>
                ))}
              </div>

              {/* Pay button */}
              <button
                onClick={handlePay}
                disabled={stage === "creating"}
                className="w-full py-3 disabled:opacity-60 text-white font-medium rounded-xl transition-all text-sm flex items-center justify-center gap-2"
                style={{ background: `linear-gradient(to right, ${gradientFrom}, ${gradientTo})` }}
              >
                {stage === "creating" ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />正在创建订单...</>
                ) : (
                  <><Icon className="h-4 w-4" />微信支付 ¥{plan.price}</>
                )}
              </button>
            </>
          )}

          {/* Scanning: QR code */}
          {stage === "scanning" && (
            <div className="flex flex-col items-center">
              <div className="bg-white rounded-xl p-3 mb-4">
                {qrUrl ? (
                  <img src={qrUrl} alt="微信支付二维码" className="w-52 h-52" />
                ) : (
                  <div className="w-52 h-52 flex items-center justify-center">
                    <QrCode className="h-16 w-16 text-gray-300" />
                  </div>
                )}
              </div>
              <p className="text-white text-sm font-medium mb-1">请使用微信扫码支付</p>
              <p className="text-muted-foreground text-xs mb-1">订单号：{outTradeNo}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin text-[#6c63ff]" />
                <span>等待支付中... {countdown > 0 ? `${countdown}秒` : ""}</span>
              </div>
            </div>
          )}

          {/* Success */}
          {stage === "success" && (
            <div className="flex flex-col items-center py-6">
              <CheckCircle2 className="h-16 w-16 text-green-400 mb-3" />
              <p className="text-green-400 font-bold text-lg">支付成功!</p>
              <p className="text-muted-foreground text-xs mt-1">VIP 已开通，感谢支持</p>
            </div>
          )}

          {/* Error */}
          {stage === "error" && (
            <div className="flex flex-col items-center py-4">
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4 text-center w-full">
                <p className="text-red-400 text-sm">{errorMsg}</p>
              </div>
              <button
                onClick={handlePay}
                className="w-full py-3 text-white font-medium rounded-xl transition-all text-sm flex items-center justify-center gap-2"
                style={{ background: `linear-gradient(to right, ${gradientFrom}, ${gradientTo})` }}
              >
                <RefreshCw className="h-4 w-4" />重新发起支付
              </button>
            </div>
          )}

          {/* Timeout */}
          {stage === "timeout" && (
            <div className="flex flex-col items-center py-4">
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-4 text-center w-full">
                <p className="text-yellow-400 text-sm">支付超时，二维码已过期</p>
              </div>
              <button
                onClick={handlePay}
                className="w-full py-3 text-white font-medium rounded-xl transition-all text-sm flex items-center justify-center gap-2"
                style={{ background: `linear-gradient(to right, ${gradientFrom}, ${gradientTo})` }}
              >
                <RefreshCw className="h-4 w-4" />重新发起支付
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
