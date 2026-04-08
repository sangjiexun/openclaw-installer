import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Settings2 } from "lucide-react";

interface GatewayConfigStepProps {
  onNext: () => void;
  onBack: () => void;
  config: {
    port: string;
    bind: string;
    authMode: string;
    authToken: string;
  };
  setConfig: (config: { port: string; bind: string; authMode: string; authToken: string }) => void;
}

export function GatewayConfigStep({ onNext, onBack, config, setConfig }: GatewayConfigStepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">网关配置</h2>
        <p className="text-muted-foreground mt-1">
          配置 OpenClaw 网关的网络和安全设置
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            网关设置
          </CardTitle>
          <CardDescription>配置网关的端口、绑定地址和认证方式</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">端口</label>
              <Input
                type="number"
                value={config.port}
                onChange={(e) => setConfig({ ...config, port: e.target.value })}
                placeholder="18789"
              />
              <p className="text-xs text-muted-foreground mt-1">默认: 18789</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">绑定地址</label>
              <Select
                value={config.bind}
                onChange={(value) => setConfig({ ...config, bind: value })}
                options={[
                  { value: "loopback", label: "loopback (仅本机)" },
                  { value: "all", label: "all (所有接口)" },
                  { value: "tailnet", label: "tailnet (Tailscale 直连网络)" },
                ]}
              />
              <p className="text-xs text-muted-foreground mt-1">推荐 loopback 以确保安全</p>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">
              认证方式
              <Badge variant="outline" className="ml-2 text-[10px]">安全</Badge>
            </label>
            <Select
              value={config.authMode}
              onChange={(value) => setConfig({ ...config, authMode: value })}
              options={[
                { value: "token", label: "Token (Bearer 令牌认证)" },
                { value: "password", label: "Password (HTTP Basic 认证)" },
              ]}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">认证令牌 / 密码</label>
            <Input
              type="password"
              value={config.authToken}
              onChange={(e) => setConfig({ ...config, authToken: e.target.value })}
              placeholder="留空将自动生成"
            />
            <p className="text-xs text-muted-foreground mt-1">
              留空时将自动生成安全的随机令牌
            </p>
          </div>

          <div className="rounded-md bg-accent/50 p-3 text-sm">
            <p className="font-medium text-xs mb-1">配置文件位置</p>
            <code className="text-xs text-muted-foreground">~/.openclaw/openclaw.json</code>
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
