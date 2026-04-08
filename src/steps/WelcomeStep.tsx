import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TerminalOutput } from "@/components/TerminalOutput";
import {
  CheckCircle2, XCircle, Loader2, Trash2, AlertTriangle,
  Package, FolderOpen, Download, Brain, FileText, Key, Shield,
} from "lucide-react";

interface AgentInfo {
  id: string;
  path: string;
  sessionCount: number;
  hasAuthProfiles: boolean;
  hasModels: boolean;
}

interface WelcomeStepProps {
  onNext: () => void;
  installConfig: { installPath: string; sandboxMode: string; addToPath: boolean };
  setInstallConfig: (cfg: { installPath: string; sandboxMode: string; addToPath: boolean }) => void;
}

export function WelcomeStep({ onNext, installConfig, setInstallConfig }: WelcomeStepProps) {
  const [systemInfo, setSystemInfo] = useState<{
    platform: string; arch: string; home: string; nodeVersion: string;
  } | null>(null);
  const [checks, setChecks] = useState<{
    node: "checking" | "found" | "missing";
    npm: "checking" | "found" | "missing";
    openclaw: "checking" | "found" | "missing";
  }>({ node: "checking", npm: "checking", openclaw: "checking" });
  const [openclawVersion, setOpenclawVersion] = useState("");

  // Uninstall state
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallOutput, setUninstallOutput] = useState<string[]>([]);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [uninstalled, setUninstalled] = useState(false);

  // Agent export state
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [userSkills, setUserSkills] = useState<string[]>([]);
  const [hasConfig, setHasConfig] = useState(false);
  const [stateDir, setStateDir] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [includeWorkspace, setIncludeWorkspace] = useState(true);
  const [includeSkills, setIncludeSkills] = useState(true);
  const [includeConfig, setIncludeConfig] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);

  useEffect(() => {
    runChecks();
  }, []);

  async function runChecks() {
    const info = await window.electronAPI.getSystemInfo();
    setSystemInfo(info);

    const nodePath = await window.electronAPI.which("node");
    setChecks((prev) => ({ ...prev, node: nodePath ? "found" : "missing" }));

    const npmPath = await window.electronAPI.which("npm");
    setChecks((prev) => ({ ...prev, npm: npmPath ? "found" : "missing" }));

    const openclawPath = await window.electronAPI.which("openclaw");
    setChecks((prev) => ({ ...prev, openclaw: openclawPath ? "found" : "missing" }));

    if (openclawPath) {
      const result = await window.electronAPI.exec("openclaw --version");
      if (result.code === 0) {
        setOpenclawVersion(result.stdout.trim());
      }
      // Load agent data
      try {
        const data = await window.electronAPI.listAgents();
        setAgents(data.agents);
        setWorkspaceFiles(data.workspaceFiles);
        setUserSkills(data.userSkills);
        setHasConfig(data.hasConfig);
        setStateDir(data.stateDir);
        // Select all agents by default
        setSelectedAgents(new Set(data.agents.map((a: AgentInfo) => a.id)));
      } catch {
        // If listing fails, just continue
      }
    }
  }

  function toggleAgent(id: string) {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllAgents() {
    if (selectedAgents.size === agents.length) {
      setSelectedAgents(new Set());
    } else {
      setSelectedAgents(new Set(agents.map((a) => a.id)));
    }
  }

  async function handleExport() {
    const savePath = await window.electronAPI.showSaveDialog({
      title: "导出 OpenClaw 数据备份",
      defaultPath: `openclaw-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
    });
    if (!savePath) return;

    setExporting(true);
    setExportResult(null);
    try {
      const result = await window.electronAPI.exportAgents({
        agentIds: [...selectedAgents],
        includeWorkspace,
        includeSkills,
        includeConfig,
        outputPath: savePath,
      });
      const sizeMB = (result.size / 1024 / 1024).toFixed(2);
      setExportResult(`✅ 导出成功! 文件大小: ${sizeMB} MB\n路径: ${savePath}`);
    } catch (err) {
      setExportResult(`❌ 导出失败: ${err}`);
    }
    setExporting(false);
  }

  async function handleUninstall() {
    setUninstalling(true);
    setShowUninstallConfirm(false);
    setUninstallOutput(["正在停止网关服务..."]);

    await window.electronAPI.exec("openclaw gateway stop");
    setUninstallOutput((prev) => [...prev, "正在卸载 openclaw..."]);

    const unsub = window.electronAPI.onShellOutput((data) => {
      setUninstallOutput((prev) => [...prev, data.trim()].filter(Boolean));
    });

    const result = await window.electronAPI.exec("npm uninstall -g openclaw");
    unsub();

    if (result.code === 0) {
      setUninstallOutput((prev) => [...prev, "", "✅ OpenClaw 已成功卸载"]);
      setChecks((prev) => ({ ...prev, openclaw: "missing" }));
      setOpenclawVersion("");
      setUninstalled(true);
    } else {
      setUninstallOutput((prev) => [...prev, "", `❌ 卸载失败: ${result.stderr}`]);
    }
    setUninstalling(false);
  }

  async function handleBrowseInstallPath() {
    const folder = await window.electronAPI.showFolderDialog({
      title: "选择安装目录",
      defaultPath: installConfig.installPath || undefined,
    });
    if (folder) {
      setInstallConfig({ ...installConfig, installPath: folder });
    }
  }

  const StatusIcon = ({ status }: { status: "checking" | "found" | "missing" }) => {
    if (status === "checking") return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (status === "found") return <CheckCircle2 className="h-4 w-4 text-success" />;
    return <XCircle className="h-4 w-4 text-warning" />;
  };

  const hasExportableData = agents.length > 0 || workspaceFiles.length > 0 || userSkills.length > 0 || hasConfig;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">欢迎使用 OpenClaw</h2>
        <p className="text-muted-foreground mt-1">
          多通道 AI 网关 — 连接 WhatsApp、Telegram、Discord 等消息平台与 AI 模型
        </p>
      </div>

      {/* System checks */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">系统环境检测</CardTitle>
          <CardDescription>检查安装所需的依赖项</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <StatusIcon status={checks.node} />
              <span className="text-sm">Node.js</span>
            </div>
            {checks.node === "found" && systemInfo && (
              <Badge variant="success">v{systemInfo.nodeVersion}</Badge>
            )}
            {checks.node === "missing" && <Badge variant="outline">未安装</Badge>}
          </div>
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <StatusIcon status={checks.npm} />
              <span className="text-sm">npm</span>
            </div>
            {checks.npm === "found" && <Badge variant="success">已安装</Badge>}
            {checks.npm === "missing" && <Badge variant="outline">未安装</Badge>}
          </div>
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <StatusIcon status={checks.openclaw} />
              <span className="text-sm">OpenClaw CLI</span>
            </div>
            {checks.openclaw === "found" && (
              <Badge variant="success">已安装{openclawVersion ? ` (${openclawVersion})` : ""}</Badge>
            )}
            {checks.openclaw === "missing" && <Badge variant="outline">未安装</Badge>}
          </div>
          {systemInfo && (
            <div className="pt-2 border-t mt-2">
              <p className="text-xs text-muted-foreground">
                平台: {systemInfo.platform} ({systemInfo.arch}) · 用户目录: {systemInfo.home}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agent export — only when openclaw is found and there's data */}
      {checks.openclaw === "found" && hasExportableData && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              智能体数据导出
            </CardTitle>
            <CardDescription>
              勾选需要备份的智能体，打包配置、技能和记忆文件为 ZIP 压缩包
              {stateDir && <span className="block mt-0.5 text-[10px] opacity-60">数据目录: {stateDir}</span>}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Agent list */}
            {agents.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">智能体 ({agents.length})</span>
                  <button
                    className="text-xs text-blue-400 hover:underline"
                    onClick={toggleAllAgents}
                  >
                    {selectedAgents.size === agents.length ? "取消全选" : "全选"}
                  </button>
                </div>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {agents.map((agent) => (
                    <label
                      key={agent.id}
                      className="flex items-center gap-2.5 p-2 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedAgents.has(agent.id)}
                        onChange={() => toggleAgent(agent.id)}
                        className="rounded border-muted-foreground/30 accent-blue-500"
                      />
                      <Brain className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{agent.id}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {agent.sessionCount} 会话
                          {agent.hasAuthProfiles && " · 认证配置"}
                          {agent.hasModels && " · 模型配置"}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Additional data toggles */}
            <div className="border-t pt-3 space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground block mb-2">附加数据</span>
              <label className="flex items-center gap-2.5 p-2 rounded-md hover:bg-accent/50 cursor-pointer transition-colors">
                <input type="checkbox" checked={includeWorkspace} onChange={(e) => setIncludeWorkspace(e.target.checked)}
                  className="rounded border-muted-foreground/30 accent-blue-500" />
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <span className="text-sm">工作区记忆文件</span>
                  {workspaceFiles.length > 0 && (
                    <span className="text-xs text-muted-foreground ml-2">
                      {workspaceFiles.slice(0, 3).join(", ")}{workspaceFiles.length > 3 ? ` +${workspaceFiles.length - 3}` : ""}
                    </span>
                  )}
                </div>
              </label>
              <label className="flex items-center gap-2.5 p-2 rounded-md hover:bg-accent/50 cursor-pointer transition-colors">
                <input type="checkbox" checked={includeSkills} onChange={(e) => setIncludeSkills(e.target.checked)}
                  className="rounded border-muted-foreground/30 accent-blue-500" />
                <Brain className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <span className="text-sm">用户自定义技能</span>
                  {userSkills.length > 0 && (
                    <span className="text-xs text-muted-foreground ml-2">{userSkills.length} 个技能</span>
                  )}
                </div>
              </label>
              <label className="flex items-center gap-2.5 p-2 rounded-md hover:bg-accent/50 cursor-pointer transition-colors">
                <input type="checkbox" checked={includeConfig} onChange={(e) => setIncludeConfig(e.target.checked)}
                  className="rounded border-muted-foreground/30 accent-blue-500" />
                <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm">配置文件和凭证</span>
              </label>
            </div>

            {/* Export button */}
            <div className="pt-1">
              <Button
                onClick={handleExport}
                disabled={exporting || (selectedAgents.size === 0 && !includeWorkspace && !includeSkills && !includeConfig)}
                className="w-full"
                size="sm"
              >
                {exporting ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-2 h-3.5 w-3.5" />
                )}
                {exporting ? "正在打包导出..." : "选择位置并导出 ZIP"}
              </Button>
            </div>
            {exportResult && (
              <div className={`text-xs p-2 rounded-md ${exportResult.startsWith("✅") ? "bg-success/10 text-success" : "bg-red-400/10 text-red-400"}`}>
                {exportResult.split("\n").map((line, i) => <div key={i}>{line}</div>)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Existing install — uninstall option */}
      {checks.openclaw === "found" && (
        <Card className="border-warning/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              已安装 OpenClaw{openclawVersion ? ` ${openclawVersion}` : ""}
            </CardTitle>
            <CardDescription>可以继续重新配置，或卸载后重新安装到自定义位置</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!showUninstallConfirm && !uninstalling && uninstallOutput.length === 0 && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowUninstallConfirm(true)}
                  className="text-red-400 border-red-400/30 hover:bg-red-400/10">
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  卸载 OpenClaw
                </Button>
                <Button variant="secondary" size="sm" onClick={onNext}>
                  跳过，直接配置 →
                </Button>
              </div>
            )}
            {showUninstallConfirm && (
              <div className="rounded-md bg-red-400/10 border border-red-400/20 p-3 space-y-2">
                <p className="text-sm text-red-400">确定要卸载 OpenClaw 吗？建议先导出数据备份。</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline"
                    className="text-red-400 border-red-400/30 hover:bg-red-400/10"
                    onClick={handleUninstall}>
                    确认卸载
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setShowUninstallConfirm(false)}>
                    取消
                  </Button>
                </div>
              </div>
            )}
            {uninstalling && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在卸载...
              </div>
            )}
            {uninstallOutput.length > 0 && <TerminalOutput lines={uninstallOutput} />}
          </CardContent>
        </Card>
      )}

      {/* Installation options — shown when not installed or just uninstalled */}
      {(checks.openclaw === "missing" || uninstalled) && checks.node !== "checking" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              安装选项
            </CardTitle>
            <CardDescription>选择安装位置和运行模式</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">安装目录</label>
              <div className="flex gap-2">
                <Input
                  value={installConfig.installPath}
                  onChange={(e) => setInstallConfig({ ...installConfig, installPath: e.target.value })}
                  placeholder="留空使用默认全局安装"
                  className="flex-1"
                />
                <Button variant="outline" size="sm" onClick={handleBrowseInstallPath}>
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                留空 = npm 全局安装 (npm i -g openclaw)；指定路径 = 安装到自定义目录
              </p>
            </div>

            {/* Add to PATH checkbox */}
            <label className="flex items-center gap-2.5 p-2.5 rounded-md border border-border/50 hover:bg-accent/50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={installConfig.addToPath}
                onChange={(e) => setInstallConfig({ ...installConfig, addToPath: e.target.checked })}
                className="rounded border-muted-foreground/30 accent-blue-500"
              />
              <div className="flex-1">
                <span className="text-sm font-medium">添加到系统环境变量 (PATH)</span>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  将 openclaw 命令路径写入用户和系统 PATH，安装后可在任意终端直接使用 openclaw 命令
                </p>
              </div>
            </label>

            <div>
              <label className="text-sm font-medium mb-1.5 block">运行模式</label>
              <Select
                value={installConfig.sandboxMode}
                onChange={(value) => setInstallConfig({ ...installConfig, sandboxMode: value })}
                options={[
                  { value: "off", label: "标准模式 — 直接运行 (无隔离)" },
                  { value: "non-main", label: "混合沙箱 — 仅隔离子智能体" },
                  { value: "all", label: "完全沙箱 — Docker 容器隔离所有进程" },
                ]}
              />
              {installConfig.sandboxMode !== "off" && (
                <div className="mt-2 rounded-md bg-accent/50 p-2.5 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Shield className="h-3 w-3" />
                    沙箱隔离模式
                  </div>
                  <p className="text-muted-foreground">
                    {installConfig.sandboxMode === "non-main"
                      ? "主智能体正常运行，子智能体在 Docker 容器中执行命令，网络隔离、只读根文件系统、无特权。"
                      : "所有智能体均在 Docker 容器中运行，完全隔离的沙箱环境。需要已安装 Docker 或 Podman。"}
                  </p>
                  <p className="text-muted-foreground">
                    镜像: openclaw-sandbox (Debian Bookworm)，支持 bash/curl/git/python3/ripgrep。
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={onNext} size="lg">
          {checks.openclaw === "found" && !uninstalled
            ? "重新配置 →"
            : checks.node === "missing"
              ? "安装 Node.js →"
              : "开始安装 →"}
        </Button>
      </div>
    </div>
  );
}
