import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Key, Lock } from "lucide-react";

const PROVIDERS = [
  // 直连提供商
  { id: "anthropic", name: "Anthropic (Claude)", envKey: "ANTHROPIC_API_KEY", models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-3.5"], relay: false },
  { id: "openai", name: "OpenAI (GPT)", envKey: "OPENAI_API_KEY", models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o"], relay: false },
  { id: "openrouter", name: "OpenRouter", envKey: "OPENROUTER_API_KEY", models: ["auto"], relay: false },
  { id: "mistral", name: "Mistral", envKey: "MISTRAL_API_KEY", models: ["mistral-large-latest"], relay: false },
  { id: "moonshot", name: "Moonshot AI (Kimi)", envKey: "MOONSHOT_API_KEY", models: ["moonshot-v1-128k"], relay: false },
  { id: "together", name: "Together AI", envKey: "TOGETHER_API_KEY", models: ["meta-llama/Llama-3-70b"], relay: false },
  { id: "ollama", name: "Ollama (本地)", envKey: "", models: ["llama3", "mistral", "codellama"], relay: false },
  // 中转站提供商
  { id: "dmxapi", name: "默认配置", envKey: "OPENAI_API_KEY", models: ["GLM-4.7-Flash", "glm-5.1-free", "qwen-flash-free", "doubao-seed-2.0-pro-free", "doubao-seed-2.0-code-free", "DMXAPI-CodeX-Free", "KAT-Coder-ProV2-free", "Qwen3.5-35B-A3B-free", "qwen3.5-plus-free", "kimi-k2.5-free", "mimo-v2-pro-free", "MiniMax-M2.7-free", "qwen3-8b-free", "Qwen3.5-2B-free", "GLM-4.1V-Thinking-Flash", "Hunyuan-MT-7B"], relay: true, baseUrl: "https://www.dmxapi.cn/v1", doc: "https://doc.dmxapi.cn" },
  { id: "api2d", name: "API2D (中转站)", envKey: "OPENAI_API_KEY", models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "claude-opus-4-6", "claude-sonnet-4-6"], relay: true, baseUrl: "https://oa.api2d.net/v1", doc: "https://api2d.com" },
  { id: "openai-sb", name: "OpenAI-SB (中转站)", envKey: "OPENAI_API_KEY", models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "claude-opus-4-6", "claude-sonnet-4-6"], relay: true, baseUrl: "https://api.openai-sb.com/v1", doc: "https://openai-sb.com" },
  { id: "custom-relay", name: "自定义中转站", envKey: "OPENAI_API_KEY", models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-3.5"], relay: true, baseUrl: "", doc: "" },
];

interface ConfigModelStepProps {
  onNext: () => void;
  onBack: () => void;
  config: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  setConfig: (config: { provider: string; apiKey: string; model: string; baseUrl: string }) => void;
}

export function ConfigModelStep({ onNext, onBack, config, setConfig }: ConfigModelStepProps) {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    if (config.provider !== "dmxapi" && !unlocked) {
      setConfig({
        provider: "dmxapi",
        apiKey: "sk-lDqloedR32DFKp4rhsRLiVLGiNjQZA7ISKG2s4tqAkkdlflk",
        model: "GLM-4.7-Flash",
        baseUrl: "https://www.dmxapi.cn/v1",
      });
    }
  }, [config.provider, setConfig, unlocked]);

  const selectedProvider = PROVIDERS.find((p) => p.id === config.provider) || PROVIDERS[0];
  const isRelay = selectedProvider.relay;

  function unlockEditing() {
    if (password === "8881101640") {
      setUnlocked(true);
      setPassword("");
      setPasswordError("");
      return;
    }
    setPasswordError("密码错误，无法修改默认配置");
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">配置 AI 模型</h2>
        <p className="text-muted-foreground mt-1">
          默认配置已预设完成，如需修改请先输入密码解锁
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4" />
            模型提供商
          </CardTitle>
          <CardDescription>默认配置已写死，输入密码后才允许修改</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!unlocked && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm text-amber-300">
                <Lock className="h-4 w-4" />
                <span>当前为默认配置锁定状态</span>
              </div>
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="输入修改密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <Button type="button" onClick={unlockEditing}>修改配置</Button>
              </div>
              {passwordError && <p className="text-xs text-red-400">{passwordError}</p>}
            </div>
          )}

          <div className="rounded-md border border-blue-500/20 bg-blue-500/10 p-3 space-y-1.5 text-xs text-muted-foreground">
            <p className="text-blue-300 font-medium">默认模型策略</p>
            <p>主力对话: GLM-4.7-Flash → glm-5.1-free → qwen-flash-free → doubao-seed-2.0-pro-free</p>
            <p>长文本: Qwen3.5-35B-A3B-free → qwen3.5-plus-free → kimi-k2.5-free</p>
            <p>代码任务: KAT-Coder-ProV2-free → doubao-seed-2.0-code-free → DMXAPI-CodeX-Free</p>
            <p>多模态: GLM-4.1V-Thinking-Flash → MiniMax-M2.7-free</p>
            <p>翻译: Hunyuan-MT-7B；轻量: qwen3-8b-free / Qwen3.5-2B-free</p>
            <p className="text-green-300">自动循环降级: 模型无响应或欠费时自动切换下一个，16个免费模型轮换。</p>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">AI 提供商</label>
            <Select
              value={config.provider}
              disabled={!unlocked}
              onChange={(value) => {
                const p = PROVIDERS.find((pv) => pv.id === value);
                setConfig({
                  ...config,
                  provider: value,
                  model: "",
                  baseUrl: p?.relay && "baseUrl" in p ? (p as any).baseUrl : "",
                });
              }}
              options={[
                ...PROVIDERS.filter((p) => !p.relay).map((p) => ({ value: p.id, label: p.name })),
                { value: "---", label: "── 中转站 ──", disabled: true },
                ...PROVIDERS.filter((p) => p.relay).map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>

          {selectedProvider.envKey && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                API 密钥
                <Badge variant="outline" className="ml-2 text-[10px]">{selectedProvider.envKey}</Badge>
              </label>
              <Input
                type="password"
                placeholder={isRelay ? "输入中转站提供的 API 密钥" : `输入 ${selectedProvider.envKey}`}
                value={config.apiKey}
                disabled={!unlocked}
                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {isRelay
                  ? "使用中转站分配的密钥，而非官方密钥"
                  : "密钥将保存到 ~/.openclaw/.env 文件中"}
              </p>
            </div>
          )}

          {selectedProvider.id === "ollama" && (
            <div className="rounded-md bg-accent/50 p-3 text-sm text-muted-foreground">
              Ollama 为本地运行，无需 API 密钥。请确保 Ollama 服务已启动。
            </div>
          )}

          <div>
            <label className="text-sm font-medium mb-1.5 block">默认模型</label>
            <Input
              placeholder={selectedProvider.models[0] || "输入模型 ID"}
              value={config.model}
              disabled={!unlocked}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              输入模型 ID，如 {selectedProvider.models.slice(0, 3).join("、")}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>← 返回</Button>
        <Button onClick={onNext}>下一步 →</Button>
      </div>
    </div>
  );
}
