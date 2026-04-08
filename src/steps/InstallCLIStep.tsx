import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TerminalOutput } from "@/components/TerminalOutput";
import { Loader2, Package, Shield } from "lucide-react";

interface InstallCLIStepProps {
  onNext: () => void;
  onBack: () => void;
  installConfig: { installPath: string; sandboxMode: string; addToPath: boolean };
}

export function InstallCLIStep({ onNext, onBack, installConfig }: InstallCLIStepProps) {
  const [installing, setInstalling] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  async function installCLI() {
    setInstalling(true);
    setOutput(["检查 OpenClaw CLI..."]);

    const existing = await window.electronAPI.which("openclaw");
    if (existing) {
      setOutput((prev) => [...prev, `OpenClaw 已安装: ${existing}`, "✓ 跳过安装"]);
      // If sandbox mode was chosen, still configure it
      if (installConfig.sandboxMode !== "off") {
        await configureSandbox();
      }
      setDone(true);
      setInstalling(false);
      return;
    }

    const info = await window.electronAPI.getSystemInfo();

    if (info.platform === "win32") {
      setOutput((prev) => [
        ...prev,
        installConfig.installPath ? `安装到自定义目录: ${installConfig.installPath}` : "安装到系统全局环境",
        "将通过管理员权限执行 npm 全局安装，并自动写入 PATH",
      ]);
      const result = await window.electronAPI.installWindowsOpenClaw(installConfig.installPath || undefined);
      const lines = [
        result.profile ? `镜像策略: ${result.profile.label}` : "镜像策略: 默认官方源",
        ...(result.stdout ? result.stdout.split(/\r?\n/).filter(Boolean) : []),
        ...(result.stderr ? result.stderr.split(/\r?\n/).filter(Boolean) : []),
      ].filter(Boolean);
      if (result.ok) {
        setOutput((prev) => [...prev, ...lines, "", "✅ OpenClaw CLI 安装成功!"]);
        if (installConfig.addToPath) {
          setOutput((prev) => [...prev, "✓ 已通过安装脚本写入全局 PATH"]);
        }
        if (installConfig.sandboxMode !== "off") {
          await configureSandbox();
        }
        setDone(true);
      } else {
        setOutput((prev) => [
          ...prev,
          ...lines,
          "",
          "❌ 安装失败",
          "请确认已经完成基础环境安装，并允许管理员提权",
        ]);
      }
      setInstalling(false);
      return;
    }

    let cmd: string;
    if (installConfig.installPath) {
      setOutput((prev) => [...prev, `安装到自定义目录: ${installConfig.installPath}`]);
      cmd = `npm install --prefix "${installConfig.installPath}" openclaw@latest`;
    } else {
      setOutput((prev) => [...prev, "正在通过 npm 全局安装 openclaw..."]);
      cmd = `npm install -g openclaw@latest`;
    }

    const unsub = window.electronAPI.onShellOutput((data) => {
      setOutput((prev) => [...prev, data.trim()].filter(Boolean));
    });

    const result = await window.electronAPI.exec(cmd);
    unsub();

    if (result.code === 0) {
      setOutput((prev) => [...prev, "", "✅ OpenClaw CLI 安装成功!"]);

      // Persist openclaw bin in PATH so it works from any terminal
      if (installConfig.addToPath) {
        setOutput((prev) => [...prev, "正在将 openclaw 路径写入系统环境变量..."]);
        try {
          const pathResult = await window.electronAPI.addToPath(installConfig.installPath || undefined);
          for (const entry of pathResult.results) {
            if (entry.added) {
              setOutput((prev) => [...prev, `✅ 已添加到${entry.scope === "user" ? "用户" : "系统"} PATH: ${entry.dir}`]);
            } else if (entry.error) {
              setOutput((prev) => [...prev, `⚠ ${entry.scope === "user" ? "用户" : "系统"} PATH 写入失败: ${entry.error}`]);
            } else {
              setOutput((prev) => [...prev, `✓ ${entry.scope === "user" ? "用户" : "系统"} PATH 已包含: ${entry.dir}`]);
            }
          }
        } catch {
          setOutput((prev) => [...prev, "⚠ 自动写入 PATH 失败，请手动将 openclaw 所在目录添加到环境变量"]);
        }
      }

      // Configure sandbox mode if selected
      if (installConfig.sandboxMode !== "off") {
        await configureSandbox();
      }

      setDone(true);
    } else {
      setOutput((prev) => [
        ...prev,
        "",
        "❌ 安装失败",
        "尝试使用管理员权限:",
        info.platform === "win32"
          ? "  以管理员身份运行: npm install -g openclaw@latest"
          : "  sudo npm install -g openclaw@latest",
        result.stderr || "",
      ]);
    }
    setInstalling(false);
  }

  async function configureSandbox() {
    setOutput((prev) => [...prev, "", `⚙ 配置沙箱模式: ${installConfig.sandboxMode}`]);

    await window.electronAPI.exec(
      `openclaw config set agents.defaults.sandbox.mode "${installConfig.sandboxMode}"`
    );
    await window.electronAPI.exec(
      `openclaw config set agents.defaults.sandbox.scope "agent"`
    );

    // Check if Docker is available
    const dockerCheck = await window.electronAPI.exec("docker --version");
    if (dockerCheck.code === 0) {
      setOutput((prev) => [...prev, `Docker 已就绪: ${dockerCheck.stdout.trim()}`]);
      // Build sandbox image
      setOutput((prev) => [...prev, "正在构建沙箱镜像 (this may take a while)..."]);
      const buildResult = await window.electronAPI.exec("openclaw sandbox build");
      if (buildResult.code === 0) {
        setOutput((prev) => [...prev, "✅ 沙箱镜像构建完成"]);
      } else {
        setOutput((prev) => [...prev, "⚠ 沙箱镜像构建失败，可稍后手动运行: openclaw sandbox build"]);
      }
    } else {
      // Check podman
      const podmanCheck = await window.electronAPI.exec("podman --version");
      if (podmanCheck.code === 0) {
        setOutput((prev) => [...prev, `Podman 已就绪: ${podmanCheck.stdout.trim()}`]);
      } else {
        setOutput((prev) => [...prev, "⚠ 未检测到 Docker 或 Podman，沙箱模式需要容器运行时"]);
        setOutput((prev) => [...prev, "  请安装 Docker Desktop 或 Podman 后再启用沙箱"]);
      }
    }
  }

  const isCustomPath = !!installConfig.installPath;
  const isSandbox = installConfig.sandboxMode !== "off";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">安装 OpenClaw CLI</h2>
        <p className="text-muted-foreground mt-1">
          {isCustomPath ? `安装到 ${installConfig.installPath}` : "Windows 下将通过管理员权限安装 OpenClaw 命令行并写入全局 PATH"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isCustomPath ? "自定义目录安装" : "全局命令行安装"}
          </CardTitle>
          <CardDescription className="flex items-center gap-2 flex-wrap">
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              {isCustomPath
                ? `npm install --prefix "${installConfig.installPath}" openclaw@latest`
                : "npm install -g openclaw@latest"}
            </code>
            {isSandbox && (
              <Badge variant="outline" className="text-[10px]">
                <Shield className="h-2.5 w-2.5 mr-1" />
                沙箱: {installConfig.sandboxMode}
              </Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
            Windows 会优先复用上一步安装好的 Scoop / Node / pnpm 环境，并根据网络区域自动复用镜像配置。
          </div>
          {!installing && !done && (
            <Button onClick={installCLI} className="w-full" size="lg">
              <Package className="mr-2 h-4 w-4" />
              安装 OpenClaw CLI
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
