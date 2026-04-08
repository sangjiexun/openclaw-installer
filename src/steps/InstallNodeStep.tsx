import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TerminalOutput } from "@/components/TerminalOutput";
import { Loader2, Download, Shield, Wrench } from "lucide-react";

interface InstallNodeStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function InstallNodeStep({ onNext, onBack }: InstallNodeStepProps) {
  const [installing, setInstalling] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  async function installNode() {
    setInstalling(true);
    const info = await window.electronAPI.getSystemInfo();
    setOutput([`平台: ${info.platform}`, info.platform === "win32"
      ? "开始执行 Windows 基础环境安装: Scoop + Git + Node.js LTS + pnpm + Tailscale"
      : "正在检查 Node.js..."]);

    if (info.platform === "win32") {
      const scoopPath = await window.electronAPI.which("scoop");
      const gitPath = await window.electronAPI.which("git");
      const nodePath = await window.electronAPI.which("node");
      const pnpmPath = await window.electronAPI.which("pnpm");
      const tailscalePath = await window.electronAPI.which("tailscale");
      if (scoopPath && gitPath && nodePath && pnpmPath && tailscalePath) {
        const version = await window.electronAPI.exec("node --version");
        setOutput((prev) => [...prev, `Node.js 已安装: ${version.stdout.trim() || info.nodeVersion}`, "Scoop / Git / pnpm / Tailscale 已就绪", "✓ 跳过安装"]);
        setDone(true);
        setInstalling(false);
        return;
      }

      const result = await window.electronAPI.installWindowsToolchain();
      const lines = [
        result.profile ? `镜像策略: ${result.profile.label}` : "镜像策略: 默认官方源",
        result.profile?.ip ? `公网 IP: ${result.profile.ip}` : "",
        ...(result.stdout ? result.stdout.split(/\r?\n/).filter(Boolean) : []),
        ...(result.stderr ? result.stderr.split(/\r?\n/).filter(Boolean) : []),
      ].filter(Boolean);
      if (result.ok) {
        setOutput((prev) => [...prev, ...lines, "", "✅ Windows 基础环境安装成功"]);
        setDone(true);
      } else {
        setOutput((prev) => [
          ...prev,
          ...lines,
          "",
          "❌ Windows 基础环境安装失败",
          `退出码: ${result.code ?? "unknown"}`,
          "请查看上面的详细日志；当前会自动处理管理员权限，剩余失败通常是 Scoop 安装或镜像访问问题。",
        ]);
      }
      setInstalling(false);
      return;
    }

    const nodePath = await window.electronAPI.which("node");
    if (nodePath) {
      setOutput((prev) => [...prev, `Node.js 已安装: v${info.nodeVersion}`, "✓ 跳过安装"]);
      setDone(true);
      setInstalling(false);
      return;
    }

    const unsub = window.electronAPI.onShellOutput((data) => {
      setOutput((prev) => [...prev, data.trim()].filter(Boolean));
    });

    let cmd: string;
    if (info.platform === "darwin") {
      cmd = `brew install node@22 || (curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash && brew install node@22)`;
    } else {
      cmd = `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`;
    }

    const result = await window.electronAPI.exec(cmd);
    unsub();

    if (result.code === 0) {
      setOutput((prev) => [...prev, "", "✅ Node.js 安装成功!"]);
      setDone(true);
    } else {
      setOutput((prev) => [
        ...prev,
        "",
        "❌ 自动安装失败",
        "请手动从 https://nodejs.org 下载安装 Node.js 22+",
        result.stderr || "",
      ]);
    }
    setInstalling(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">安装基础环境</h2>
        <p className="text-muted-foreground mt-1">
          Windows 将使用管理员权限安装 Scoop、Git、Node.js LTS、pnpm 和 Tailscale
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">基础工具安装</CardTitle>
          <CardDescription>
            Windows: 提权后通过 Scoop 安装开发环境，并按公网 IP 自动切换加速镜像
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <div className="flex items-center gap-2 font-medium">
              <Shield className="h-3.5 w-3.5" />
              Windows 安装会弹出 UAC 提权窗口
            </div>
            <div className="mt-1 text-amber-100/80">
              将自动安装 Scoop、Git、Node.js LTS、pnpm、Tailscale，并为中国大陆网络优先选择加速镜像。
            </div>
          </div>
          {!installing && !done && (
            <Button onClick={installNode} className="w-full" size="lg">
              <Wrench className="mr-2 h-4 w-4" />
              安装基础环境
            </Button>
          )}
          {installing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在安装...
            </div>
          )}
          <TerminalOutput lines={output} />
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>← 返回</Button>
        <Button onClick={onNext} disabled={!done}>
          下一步 →
        </Button>
      </div>
    </div>
  );
}
