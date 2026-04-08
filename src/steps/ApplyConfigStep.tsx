import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TerminalOutput } from "@/components/TerminalOutput";
import { Loader2, Rocket, CheckCircle2 } from "lucide-react";

interface ChannelConfig {
  type: string;
  enabled: boolean;
  token: string;
  dmPolicy: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuConnectionMode?: string;
  feishuEncryptKey?: string;
  feishuVerificationToken?: string;
}

interface ApplyConfigStepProps {
  onNext: () => void;
  onBack: () => void;
  modelConfig: { provider: string; apiKey: string; model: string; baseUrl: string };
  gatewayConfig: { port: string; bind: string; authMode: string; authToken: string };
  channels: ChannelConfig[];
}

export function ApplyConfigStep({ onNext, onBack, modelConfig, gatewayConfig, channels }: ApplyConfigStepProps) {
  const [applying, setApplying] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const usingDefaultStrategy = modelConfig.provider === "dmxapi" && modelConfig.baseUrl.trim() === "https://www.dmxapi.cn/v1";

  // 所有 DMXAPI 免费模型，依次循环降级：若某模型无法通讯或欠费则自动使用下一个
  const DEFAULT_DMXAPI_MODEL_STRATEGY = {
    primary: "dmxapi/GLM-4.7-Flash",
    fallbacks: [
      "dmxapi/glm-5.1-free",
      "dmxapi/qwen-flash-free",
      "dmxapi/doubao-seed-2.0-pro-free",
      "dmxapi/Qwen3.5-35B-A3B-free",
      "dmxapi/qwen3.5-plus-free",
      "dmxapi/kimi-k2.5-free",
      "dmxapi/KAT-Coder-ProV2-free",
      "dmxapi/doubao-seed-2.0-code-free",
      "dmxapi/DMXAPI-CodeX-Free",
      "dmxapi/mimo-v2-pro-free",
      "dmxapi/MiniMax-M2.7-free",
      "dmxapi/qwen3-8b-free",
      "dmxapi/Qwen3.5-2B-free",
      "dmxapi/Hunyuan-MT-7B",
    ],
    imagePrimary: "dmxapi/GLM-4.1V-Thinking-Flash",
    imageFallbacks: ["dmxapi/MiniMax-M2.7-free", "dmxapi/qwen3.5-plus-free"],
    pdfPrimary: "dmxapi/qwen3.5-plus-free",
    pdfFallbacks: ["dmxapi/kimi-k2.5-free", "dmxapi/Qwen3.5-35B-A3B-free"],
    allowlist: {
      "dmxapi/GLM-4.7-Flash": { alias: "对话主力" },
      "dmxapi/glm-5.1-free": { alias: "对话备用一" },
      "dmxapi/qwen-flash-free": { alias: "对话备用二" },
      "dmxapi/doubao-seed-2.0-pro-free": { alias: "对话备用三" },
      "dmxapi/Qwen3.5-35B-A3B-free": { alias: "长文本一" },
      "dmxapi/qwen3.5-plus-free": { alias: "长文本二" },
      "dmxapi/kimi-k2.5-free": { alias: "长文本三" },
      "dmxapi/KAT-Coder-ProV2-free": { alias: "代码一" },
      "dmxapi/doubao-seed-2.0-code-free": { alias: "代码二" },
      "dmxapi/DMXAPI-CodeX-Free": { alias: "代码三" },
      "dmxapi/mimo-v2-pro-free": { alias: "通用备用" },
      "dmxapi/MiniMax-M2.7-free": { alias: "多模态" },
      "dmxapi/qwen3-8b-free": { alias: "轻量对话" },
      "dmxapi/Qwen3.5-2B-free": { alias: "超轻量" },
      "dmxapi/GLM-4.1V-Thinking-Flash": { alias: "视觉" },
      "dmxapi/Hunyuan-MT-7B": { alias: "翻译" },
    },
  };

  async function applyConfig() {
    setApplying(true);
    setOutput(["正在写入配置..."]);

    const unsub = window.electronAPI.onShellOutput((data) => {
      setOutput((prev) => [...prev, data.trim()].filter(Boolean));
    });

    try {
      // Relay providers (中转站) use their own provider ID with openai-completions API adapter
      const relayProviders = new Set(["dmxapi", "api2d", "openai-sb", "custom-relay"]);
      const isRelay = relayProviders.has(modelConfig.provider);
      const providerPrefix = modelConfig.provider;
      const fullModel = `${providerPrefix}/${modelConfig.model}`;
      const useDefaultDmxapiStrategy =
        modelConfig.provider === "dmxapi" && modelConfig.baseUrl.trim() === "https://www.dmxapi.cn/v1";

      if (useDefaultDmxapiStrategy) {
        setOutput((prev) => [...prev, `设置默认主模型: ${DEFAULT_DMXAPI_MODEL_STRATEGY.primary}`]);
        await window.electronAPI.exec(`openclaw config set agents.defaults.model.primary "${DEFAULT_DMXAPI_MODEL_STRATEGY.primary}"`);

        setOutput((prev) => [...prev, `设置普通/代码/长文本轮换 fallback`]);
        await window.electronAPI.exec(`openclaw config set agents.defaults.model.fallbacks '${JSON.stringify(DEFAULT_DMXAPI_MODEL_STRATEGY.fallbacks)}'`);

        setOutput((prev) => [...prev, `设置图片模型: ${DEFAULT_DMXAPI_MODEL_STRATEGY.imagePrimary}`]);
        await window.electronAPI.exec(`openclaw config set agents.defaults.imageModel.primary "${DEFAULT_DMXAPI_MODEL_STRATEGY.imagePrimary}"`);
        await window.electronAPI.exec(`openclaw config set agents.defaults.imageModel.fallbacks '${JSON.stringify(DEFAULT_DMXAPI_MODEL_STRATEGY.imageFallbacks)}'`);

        setOutput((prev) => [...prev, `设置长文本/PDF 模型: ${DEFAULT_DMXAPI_MODEL_STRATEGY.pdfPrimary}`]);
        await window.electronAPI.exec(`openclaw config set agents.defaults.pdfModel.primary "${DEFAULT_DMXAPI_MODEL_STRATEGY.pdfPrimary}"`);
        await window.electronAPI.exec(`openclaw config set agents.defaults.pdfModel.fallbacks '${JSON.stringify(DEFAULT_DMXAPI_MODEL_STRATEGY.pdfFallbacks)}'`);

        setOutput((prev) => [...prev, `写入模型白名单与别名`]);
        await window.electronAPI.exec(`openclaw config set agents.defaults.models '${JSON.stringify(DEFAULT_DMXAPI_MODEL_STRATEGY.allowlist)}'`);
      } else {
        setOutput((prev) => [...prev, `设置默认模型: ${fullModel}`]);
        await window.electronAPI.exec(`openclaw config set agents.defaults.model.primary "${fullModel}"`);

        // Clear old model allowlist and set only the current model
        setOutput((prev) => [...prev, `设置模型白名单: ${fullModel}`]);
        await window.electronAPI.exec(`openclaw config set agents.defaults.models '{}'`);
        await window.electronAPI.exec(`openclaw config set "agents.defaults.models.${fullModel}" "{}"`);
      }

      if (isRelay && modelConfig.baseUrl) {
        // Register relay as a custom provider with baseUrl, api adapter, apiKey, and empty models array
        const baseUrl = modelConfig.baseUrl.trim();
        const providerConfig: Record<string, unknown> = {
          baseUrl,
          api: "openai-completions",
          models: useDefaultDmxapiStrategy
            ? [
                { id: "GLM-4.7-Flash" },
                { id: "glm-5.1-free" },
                { id: "qwen-flash-free" },
                { id: "doubao-seed-2.0-pro-free" },
                { id: "doubao-seed-2.0-code-free" },
                { id: "DMXAPI-CodeX-Free" },
                { id: "KAT-Coder-ProV2-free" },
                { id: "Qwen3.5-35B-A3B-free" },
                { id: "qwen3.5-plus-free" },
                { id: "kimi-k2.5-free" },
                { id: "mimo-v2-pro-free" },
                { id: "MiniMax-M2.7-free" },
                { id: "qwen3-8b-free" },
                { id: "Qwen3.5-2B-free" },
                { id: "GLM-4.1V-Thinking-Flash" },
                { id: "Hunyuan-MT-7B" },
              ]
            : [],
        };
        if (modelConfig.apiKey) {
          providerConfig.apiKey = modelConfig.apiKey;
        }
        const configJson = JSON.stringify(providerConfig);
        setOutput((prev) => [...prev, `注册中转站提供商: ${providerPrefix} (${baseUrl})`]);
        await window.electronAPI.exec(`openclaw config set models.providers.${providerPrefix} '${configJson}'`);
      }

      // Set API key via env file (standard providers only; relay apiKey is in provider config)
      // Uses upsert logic: if the key already exists, update it; otherwise append
      if (modelConfig.apiKey && !isRelay) {
        const envKeyMap: Record<string, string> = {
          anthropic: "ANTHROPIC_API_KEY",
          openai: "OPENAI_API_KEY",
          openrouter: "OPENROUTER_API_KEY",
          mistral: "MISTRAL_API_KEY",
          moonshot: "MOONSHOT_API_KEY",
          together: "TOGETHER_API_KEY",
        };
        const envKey = envKeyMap[modelConfig.provider];
        if (envKey) {
          setOutput((prev) => [...prev, `保存 API 密钥: ${envKey}`]);
          const info = await window.electronAPI.getSystemInfo();
          const envValue = modelConfig.apiKey;
          if (info.platform === "win32") {
            // PowerShell: read file, remove old entries for this key, append new entry
            const envPath = `$env:USERPROFILE\\.openclaw\\.env`;
            const upsertCmd = [
              `$p = "${envPath}"`,
              `if (Test-Path $p) { $lines = @(Get-Content $p | Where-Object { $_ -notmatch '^${envKey}=' }); Set-Content -Path $p -Value $lines }`,
              `Add-Content -Path $p -Value "${envKey}=${envValue}"`,
            ].join("; ");
            await window.electronAPI.exec(upsertCmd);
          } else {
            const upsertCmd = [
              `sed -i '/^${envKey}=/d' ~/.openclaw/.env 2>/dev/null || true`,
              `echo '${envKey}=${envValue}' >> ~/.openclaw/.env`,
            ].join(" && ");
            await window.electronAPI.exec(upsertCmd);
          }
        }
      }

      // Set gateway config
      setOutput((prev) => [...prev, `设置网关模式: local`]);
      await window.electronAPI.exec(`openclaw config set gateway.mode local`);

      setOutput((prev) => [...prev, `设置网关端口: ${gatewayConfig.port}`]);
      await window.electronAPI.exec(`openclaw config set gateway.port ${gatewayConfig.port}`);

      setOutput((prev) => [...prev, `设置绑定地址: ${gatewayConfig.bind}`]);
      await window.electronAPI.exec(`openclaw config set gateway.bind "${gatewayConfig.bind}"`);

      setOutput((prev) => [...prev, `设置认证模式: ${gatewayConfig.authMode}`]);
      await window.electronAPI.exec(`openclaw config set gateway.auth.mode "${gatewayConfig.authMode}"`);

      if (gatewayConfig.authToken) {
        await window.electronAPI.exec(`openclaw config set gateway.auth.token "${gatewayConfig.authToken}"`);
      }

      // Set channel config
      for (const ch of channels) {
        if (ch.enabled) {
          setOutput((prev) => [...prev, `配置通道: ${ch.type}`]);
          await window.electronAPI.exec(`openclaw config set channels.${ch.type}.enabled true`);
          await window.electronAPI.exec(`openclaw config set channels.${ch.type}.dmPolicy "${ch.dmPolicy}"`);

          if (ch.type === "feishu") {
            // Feishu uses appId/appSecret instead of botToken
            if (ch.feishuAppId) {
              await window.electronAPI.exec(`openclaw config set channels.feishu.appId "${ch.feishuAppId}"`);
            }
            if (ch.feishuAppSecret) {
              await window.electronAPI.exec(`openclaw config set channels.feishu.appSecret "${ch.feishuAppSecret}"`);
            }
            if (ch.feishuConnectionMode) {
              await window.electronAPI.exec(`openclaw config set channels.feishu.connectionMode "${ch.feishuConnectionMode}"`);
            }
            if (ch.feishuConnectionMode === "webhook") {
              if (ch.feishuEncryptKey) {
                await window.electronAPI.exec(`openclaw config set channels.feishu.encryptKey "${ch.feishuEncryptKey}"`);
              }
              if (ch.feishuVerificationToken) {
                await window.electronAPI.exec(`openclaw config set channels.feishu.verificationToken "${ch.feishuVerificationToken}"`);
              }
            }
          } else if (ch.type !== "openclaw-weixin" && ch.token) {
            // openclaw-weixin manages its own auth via the Tencent iLink plugin
            await window.electronAPI.exec(`openclaw config set channels.${ch.type}.botToken "${ch.token}"`);
          }
        }
      }

      setOutput((prev) => [...prev, "", "✅ 所有配置已写入!"]);
      setDone(true);
    } catch (err) {
      setOutput((prev) => [...prev, "", `❌ 配置写入失败: ${err}`]);
    }

    unsub();
    setApplying(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">应用配置</h2>
        <p className="text-muted-foreground mt-1">
          确认并写入所有配置到 OpenClaw
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">配置摘要</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">AI 提供商</span>
            <Badge variant="secondary">{modelConfig.provider}</Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">默认模型</span>
            <Badge variant="secondary">{usingDefaultStrategy ? "智能轮换策略" : modelConfig.model}</Badge>
          </div>
          {usingDefaultStrategy && (
            <div className="rounded-md border bg-accent/30 p-3 text-xs space-y-1">
              <p>普通对话: GLM-4.7-Flash, qwen-flash-free</p>
              <p>代码任务: doubao-seed-2.0-code-free, DMXAPI-CodeX-Free</p>
              <p>长文本: qwen3.5-plus-free, kimi-k2.5-free</p>
              <p>图片分析: GLM-4.1V-Thinking-Flash</p>
              <p>翻译任务: Hunyuan-MT-7B</p>
              <p className="text-amber-400">单模型 1 分钟内不超过 2 次，按 fallback 顺序切换。</p>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">API 密钥</span>
            <Badge variant={modelConfig.apiKey ? "success" : "outline"}>
              {modelConfig.apiKey ? "已配置" : "未设置"}
            </Badge>
          </div>
          {modelConfig.baseUrl && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">中转 API</span>
              <span className="font-mono text-xs truncate max-w-[200px]">{modelConfig.baseUrl}</span>
            </div>
          )}
          <div className="border-t my-2" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">网关端口</span>
            <span className="font-mono text-xs">{gatewayConfig.port}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">绑定地址</span>
            <span className="font-mono text-xs">{gatewayConfig.bind}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">认证方式</span>
            <span className="font-mono text-xs">{gatewayConfig.authMode}</span>
          </div>
          {channels.length > 0 && (
            <>
              <div className="border-t my-2" />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">消息通道</span>
                <div className="flex gap-1">
                  {channels.map((ch, i) => (
                    <Badge key={i} variant="outline">{ch.type}</Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {!applying && !done && (
            <Button onClick={applyConfig} className="w-full" size="lg">
              <Rocket className="mr-2 h-4 w-4" />
              写入配置
            </Button>
          )}
          {applying && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在写入配置...
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />
              配置写入完成!
            </div>
          )}
          <TerminalOutput lines={output} />
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={applying}>← 返回</Button>
        <Button onClick={onNext} disabled={applying}>
          下一步 →
        </Button>
      </div>
    </div>
  );
}
