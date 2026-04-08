import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, MessageSquare, ExternalLink } from "lucide-react";

type WeixinPhase = "idle" | "installing" | "installed" | "qrcode" | "scanning" | "confirmed" | "error";
interface WeixinState {
  phase: WeixinPhase;
  log: string[];
  qrcodeUrl?: string;
  qrcodeToken?: string;
  errorMsg?: string;
}

interface ChannelConfig {
  type: string;
  enabled: boolean;
  token: string;
  dmPolicy: string;
  // Feishu specific
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuConnectionMode?: string;
  feishuEncryptKey?: string;
  feishuVerificationToken?: string;
}

interface ChannelStepProps {
  onNext: () => void;
  onBack: () => void;
  channels: ChannelConfig[];
  setChannels: (channels: ChannelConfig[]) => void;
}

const CHANNEL_TYPES = [
  { id: "telegram", name: "Telegram", tokenLabel: "Bot Token (从 @BotFather 获取)" },
  { id: "discord", name: "Discord", tokenLabel: "Bot Token (从 Developer Portal 获取)" },
  { id: "slack", name: "Slack", tokenLabel: "Bot Token" },
  { id: "whatsapp", name: "WhatsApp", tokenLabel: "QR 配对 (启动后自动生成)" },
  { id: "feishu", name: "飞书 / Lark", tokenLabel: "" },
  { id: "signal", name: "Signal", tokenLabel: "手机号 + PIN" },
  { id: "webchat", name: "WebChat (浏览器)", tokenLabel: "无需配置" },
  { id: "openclaw-weixin", name: "微信 (个人号)", tokenLabel: "" },
];

export function ChannelStep({ onNext, onBack, channels, setChannels }: ChannelStepProps) {
  function addChannel() {
    setChannels([
      ...channels,
      { type: "telegram", enabled: true, token: "", dmPolicy: "pairing", feishuAppId: "", feishuAppSecret: "", feishuConnectionMode: "websocket", feishuEncryptKey: "", feishuVerificationToken: "" },
    ]);
  }

  function removeChannel(index: number) {
    setChannels(channels.filter((_, i) => i !== index));
  }

  function updateChannel(index: number, updates: Partial<ChannelConfig>) {
    setChannels(channels.map((ch, i) => (i === index ? { ...ch, ...updates } : ch)));
  }

  // ── WeChat state ─────────────────────────────────────────────────────────
  const [weixinStates, setWeixinStates] = useState<Record<number, WeixinState>>({});
  const pollTimers = useRef<Record<number, ReturnType<typeof setInterval>>>({});
  const weixinStatesRef = useRef(weixinStates);
  const channelsRef = useRef(channels);
  const setChannelsRef = useRef(setChannels);
  weixinStatesRef.current = weixinStates;
  channelsRef.current = channels;
  setChannelsRef.current = setChannels;

  // Auto-poll every 3 s while any channel is in "scanning" phase
  useEffect(() => {
    for (const [idxStr, wx] of Object.entries(weixinStates)) {
      const idx = Number(idxStr);
      if (wx.phase === "scanning" && wx.qrcodeToken && !pollTimers.current[idx]) {
        pollTimers.current[idx] = setInterval(async () => {
          const cur = weixinStatesRef.current[idx];
          if (!cur || cur.phase !== "scanning" || !cur.qrcodeToken) {
            clearInterval(pollTimers.current[idx]);
            delete pollTimers.current[idx];
            return;
          }
          const res = await window.electronAPI.weixinPollStatus?.(cur.qrcodeToken);
          if (!res?.ok) return;
          if (res.status === "confirmed") {
            clearInterval(pollTimers.current[idx]);
            delete pollTimers.current[idx];
            setWeixinStates((prev) => ({ ...prev, [idx]: { ...prev[idx], phase: "confirmed" } }));
            setChannelsRef.current(channelsRef.current.map((ch, i) => (i === idx ? { ...ch, enabled: true } : ch)));
          } else if (res.status === "scaned") {
            setWeixinStates((prev) => ({ ...prev, [idx]: { ...prev[idx], errorMsg: "已扫码，请在手机上点击确认授权..." } }));
          }
        }, 3000);
      } else if (wx.phase !== "scanning" && pollTimers.current[idx]) {
        clearInterval(pollTimers.current[idx]);
        delete pollTimers.current[idx];
      }
    }
  }, [weixinStates]);

  // Clear timers on unmount
  useEffect(() => {
    return () => { for (const t of Object.values(pollTimers.current)) clearInterval(t); };
  }, []);

  async function installWeixinPlugin(idx: number) {
    setWeixinStates((prev) => ({ ...prev, [idx]: { phase: "installing", log: [] } }));
    const unsub = window.electronAPI.onWeixinOutput?.((line) => {
      setWeixinStates((prev) => {
        const cur = prev[idx] ?? { phase: "installing", log: [] };
        return { ...prev, [idx]: { ...cur, log: [...cur.log, line] } };
      });
    });
    const res = await window.electronAPI.weixinInstallPlugin?.().catch((e: unknown) => ({ ok: false, error: String(e) }));
    unsub?.();
    if (res?.ok) {
      setWeixinStates((prev) => ({ ...prev, [idx]: { ...prev[idx], phase: "installed" } }));
    } else {
      setWeixinStates((prev) => ({ ...prev, [idx]: { ...prev[idx], phase: "error", errorMsg: res?.error ?? "安装失败" } }));
    }
  }

  async function getWeixinQrcode(idx: number) {
    setWeixinStates((prev) => ({ ...prev, [idx]: { ...prev[idx], phase: "qrcode" } }));
    const res = await window.electronAPI.weixinGetQrcode?.().catch(() => null);
    if (!res) {
      setWeixinStates((prev) => ({ ...prev, [idx]: { ...prev[idx], phase: "installed", errorMsg: "API 不可用，请检查网络" } }));
      return;
    }
    if (res.ok && res.url && res.token) {
      setWeixinStates((prev) => ({ ...prev, [idx]: { ...prev[idx], phase: "scanning", qrcodeUrl: res.url, qrcodeToken: res.token, errorMsg: undefined } }));
    } else {
      setWeixinStates((prev) => ({ ...prev, [idx]: { ...prev[idx], phase: "installed", errorMsg: res.error } }));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">配置消息通道</h2>
        <p className="text-muted-foreground mt-1">
          添加需要连接的消息平台 (可选，可稍后再配置)
        </p>
      </div>

      {channels.map((ch, index) => {
        const channelType = CHANNEL_TYPES.find((t) => t.id === ch.type);
        return (
          <Card key={index}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  通道 #{index + 1}
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={() => removeChannel(index)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">平台类型</label>
                  <Select
                    value={ch.type}
                    onChange={(value) => updateChannel(index, { type: value })}
                    options={CHANNEL_TYPES.map((t) => ({ value: t.id, label: t.name }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">DM 策略</label>
                  <Select
                    value={ch.dmPolicy}
                    onChange={(value) => updateChannel(index, { dmPolicy: value })}
                    options={[
                      { value: "pairing", label: "pairing (配对码认证)" },
                      { value: "allowlist", label: "allowlist (白名单)" },
                      { value: "open", label: "open (允许所有)" },
                      { value: "disabled", label: "disabled (禁用 DM)" },
                    ]}
                  />
                </div>
              </div>
              {channelType && ch.type === "feishu" && (
                <div className="col-span-2 space-y-3">
                  <div className="rounded-md bg-accent/50 p-3 text-sm">
                    <p className="font-medium text-xs mb-1.5">飞书机器人配置</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      使用 <code className="bg-muted px-1 py-0.5 rounded">@larksuiteoapi/node-sdk</code> 连接飞书开放平台
                    </p>
                    <a
                      href="https://open.feishu.cn/app"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      前往飞书开放平台创建应用
                    </a>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">App ID</label>
                      <Input
                        value={ch.feishuAppId || ""}
                        onChange={(e) => updateChannel(index, { feishuAppId: e.target.value })}
                        placeholder="cli_xxxxxxxxxx"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">App Secret</label>
                      <Input
                        type="password"
                        value={ch.feishuAppSecret || ""}
                        onChange={(e) => updateChannel(index, { feishuAppSecret: e.target.value })}
                        placeholder="输入 App Secret"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">连接模式</label>
                    <Select
                      value={ch.feishuConnectionMode || "websocket"}
                      onChange={(value) => updateChannel(index, { feishuConnectionMode: value })}
                      options={[
                        { value: "websocket", label: "WebSocket 长连接 (推荐)" },
                        { value: "webhook", label: "Webhook 回调" },
                      ]}
                    />
                  </div>
                  {ch.feishuConnectionMode === "webhook" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Encrypt Key</label>
                        <Input
                          type="password"
                          value={ch.feishuEncryptKey || ""}
                          onChange={(e) => updateChannel(index, { feishuEncryptKey: e.target.value })}
                          placeholder="消息加密密钥"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Verification Token</label>
                        <Input
                          type="password"
                          value={ch.feishuVerificationToken || ""}
                          onChange={(e) => updateChannel(index, { feishuVerificationToken: e.target.value })}
                          placeholder="事件验证令牌"
                        />
                      </div>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>📋 配置步骤: 1) 创建企业应用 → 2) 复制 App ID & Secret → 3) 开启机器人能力 → 4) 添加 im:message 权限 → 5) 订阅 im.message.receive_v1 事件 → 6) 发布应用</p>
                  </div>
                </div>
              )}
              {ch.type === "openclaw-weixin" && (() => {
                const wx = weixinStates[index] ?? { phase: "idle" as WeixinPhase, log: [] };
                const isDone = wx.phase === "confirmed";
                return (
                  <div className="col-span-2 space-y-4">
                    {/* Info */}
                    <div className="rounded-md bg-accent/50 p-3 text-xs space-y-1">
                      <p className="font-medium">微信个人号接入 (腾讯 iLink)</p>
                      <p className="text-muted-foreground">通过腾讯官方 iLink 接口接入微信个人号，无需手动填写 Token，扫码即可完成登录。</p>
                    </div>

                    {/* Step 1: Install plugin */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">第 1 步 — 安装插件</span>
                        {["installed", "qrcode", "scanning", "confirmed"].includes(wx.phase) && (
                          <Badge variant="secondary" className="text-xs py-0 h-4">✓ 已安装</Badge>
                        )}
                      </div>
                      {wx.phase === "idle" && (
                        <Button size="sm" onClick={() => installWeixinPlugin(index)}>安装微信插件</Button>
                      )}
                      {wx.phase === "error" && (
                        <div className="space-y-1.5">
                          <p className="text-xs text-red-400">{wx.errorMsg ?? "安装失败"}</p>
                          <Button size="sm" variant="outline" onClick={() => setWeixinStates((p) => ({ ...p, [index]: { phase: "idle", log: [] } }))}>重试</Button>
                        </div>
                      )}
                      {wx.phase === "installing" && (
                        <div className="space-y-1.5">
                          <p className="text-xs text-muted-foreground animate-pulse">正在安装，请稍候...</p>
                          {wx.log.length > 0 && (
                            <div className="bg-black/80 rounded p-2 font-mono text-xs max-h-28 overflow-y-auto space-y-0.5">
                              {wx.log.map((l, i) => <div key={i} className="text-green-400 whitespace-pre-wrap break-all">{l}</div>)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Step 2: Get QR code link */}
                    {["installed", "qrcode", "scanning", "confirmed"].includes(wx.phase) && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-muted-foreground">第 2 步 — 获取扫码链接</span>
                          {["scanning", "confirmed"].includes(wx.phase) && (
                            <Badge variant="secondary" className="text-xs py-0 h-4">✓ 已获取</Badge>
                          )}
                        </div>
                        {wx.phase === "installed" && (
                          <div className="space-y-1.5">
                            {wx.errorMsg && <p className="text-xs text-amber-400">{wx.errorMsg}</p>}
                            <Button size="sm" onClick={() => getWeixinQrcode(index)}>获取扫码链接</Button>
                          </div>
                        )}
                        {wx.phase === "qrcode" && (
                          <p className="text-xs text-muted-foreground animate-pulse">正在获取二维码链接...</p>
                        )}
                        {["scanning", "confirmed"].includes(wx.phase) && wx.qrcodeUrl && (
                          <div className="space-y-1.5">
                            <p className="text-xs text-muted-foreground">在浏览器打开以下链接，用微信扫码授权：</p>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-blue-400 truncate max-w-[260px]">{wx.qrcodeUrl}</span>
                              <Button
                                size="sm" variant="outline" className="shrink-0 h-6 text-xs px-2"
                                onClick={() => window.open(wx.qrcodeUrl, "_blank")}
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />在浏览器打开
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Step 3: Poll / confirm */}
                    {["scanning", "confirmed"].includes(wx.phase) && (
                      <div className="space-y-2">
                        <span className="text-xs font-semibold text-muted-foreground">第 3 步 — 等待扫码确认</span>
                        {wx.phase === "scanning" && (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-xs animate-pulse">等待扫码...</Badge>
                              <Button
                                size="sm" variant="ghost" className="h-6 text-xs"
                                onClick={async () => {
                                  if (!wx.qrcodeToken) return;
                                  const res = await window.electronAPI.weixinPollStatus?.(wx.qrcodeToken);
                                  if (!res?.ok) { setWeixinStates((p) => ({ ...p, [index]: { ...p[index], errorMsg: res?.error } })); return; }
                                  if (res.status === "confirmed") {
                                    setWeixinStates((p) => ({ ...p, [index]: { ...p[index], phase: "confirmed" } }));
                                    updateChannel(index, { enabled: true });
                                  } else if (res.status === "scaned") {
                                    setWeixinStates((p) => ({ ...p, [index]: { ...p[index], errorMsg: "已扫码，请在手机上点击确认授权..." } }));
                                  } else {
                                    setWeixinStates((p) => ({ ...p, [index]: { ...p[index], errorMsg: "尚未扫码，请打开链接后扫码" } }));
                                  }
                                }}
                              >手动刷新</Button>
                            </div>
                            {wx.errorMsg && <p className="text-xs text-amber-400">{wx.errorMsg}</p>}
                            <p className="text-xs text-muted-foreground">每 3 秒自动检测一次，或点击手动刷新</p>
                          </div>
                        )}
                        {wx.phase === "confirmed" && !isDone && null}
                        {isDone && (
                          <Badge className="text-xs bg-green-600 hover:bg-green-600">✅ 微信登录成功，通道已启用</Badge>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              {channelType && channelType.id !== "whatsapp" && channelType.id !== "webchat" && channelType.id !== "feishu" && channelType.id !== "openclaw-weixin" && (
                <div>
                  <label className="text-sm font-medium mb-1.5 block">{channelType.tokenLabel}</label>
                  <Input
                    type="password"
                    value={ch.token}
                    onChange={(e) => updateChannel(index, { token: e.target.value })}
                    placeholder={`输入 ${channelType.name} 凭证`}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Button variant="outline" onClick={addChannel} className="w-full border-dashed">
        <Plus className="mr-2 h-4 w-4" />
        添加消息通道
      </Button>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>← 返回</Button>
        <Button onClick={onNext}>
          {channels.length === 0 ? "跳过，下一步 →" : "下一步 →"}
        </Button>
      </div>
    </div>
  );
}
