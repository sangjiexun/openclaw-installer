export {};

interface AgentInfo {
  id: string;
  path: string;
  sessionCount: number;
  hasAuthProfiles: boolean;
  hasModels: boolean;
}

interface AgentsListResult {
  stateDir: string;
  agents: AgentInfo[];
  workspaceFiles: string[];
  userSkills: string[];
  hasConfig: boolean;
  hasCredentials: boolean;
}

interface ExportOptions {
  agentIds: string[];
  includeWorkspace: boolean;
  includeSkills: boolean;
  includeConfig: boolean;
  outputPath: string;
}

interface SystemCheckItem {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

interface GatewayStatus {
  status: "stopped" | "starting" | "running" | "suspended" | "error";
  pid: number | null;
  uptime: number;
  restartCount: number;
  autoRestart: boolean;
  memory: number | null;
}

interface SandboxStatus {
  sandboxDir: string;
  nodeInstalled: boolean;
  npmInstalled: boolean;
  openclawInstalled: boolean;
  nodeVersion: string | null;
  openclawVersion: string | null;
}

interface SandboxProgress {
  phase: string;
  current: number;
  total: number;
  detail: string;
}

interface SandboxInstallResult {
  ok: boolean;
  phases: { name: string; ok: boolean; skipped?: boolean; error?: string; warning?: string }[];
  profile?: { region: string; countryCode: string; ip: string; npmRegistry: string; label: string };
  error?: string;
}

interface ServiceStatus {
  registered: boolean;
  running: boolean;
  raw?: string;
}

declare global {
  interface Window {
    electronAPI: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      toTray: () => void;
      exec: (command: string, cwd?: string) => Promise<{ code: number; stdout: string; stderr: string }>;
      spawn: (options: string | { command: string; cwd?: string }) => Promise<{ pid: number }>;
      openTerminal: (command: string) => Promise<{ ok: boolean }>;
      addToPath: (customPath?: string) => Promise<{ results: { scope: string; dir: string; added: boolean; error?: string }[] }>;
      which: (cmd: string) => Promise<string | null>;
      resolveOpenClaw: () => Promise<{ cmd: string; cwd: string; source: string; path: string | null }>;
      installWindowsToolchain: () => Promise<{
        ok: boolean;
        code?: number;
        stdout?: string;
        stderr?: string;
        reason?: string;
        profile?: { region: string; countryCode: string; ip: string; npmRegistry: string; label: string };
      }>;
      installWindowsOpenClaw: (installPath?: string) => Promise<{
        ok: boolean;
        code?: number;
        stdout?: string;
        stderr?: string;
        reason?: string;
        profile?: { region: string; countryCode: string; ip: string; npmRegistry: string; label: string };
      }>;

      // Sandbox one-click install
      sandboxOneClickInstall: (options?: { installTailscale?: boolean }) => Promise<SandboxInstallResult>;
      sandboxStatus: () => Promise<SandboxStatus>;
      onSandboxOutput: (callback: (data: string) => void) => () => void;
      onSandboxProgress: (callback: (progress: SandboxProgress) => void) => () => void;

      // Gateway service (Task Scheduler)
      serviceRegister: (config?: { port?: string; bind?: string }) => Promise<{ ok: boolean; taskName?: string; error?: string }>;
      serviceUnregister: () => Promise<{ ok: boolean; error?: string }>;
      serviceStatus: () => Promise<ServiceStatus>;

      onShellOutput: (callback: (data: string) => void) => () => void;

      // Gateway service management
      gatewayStart: (config: { cmd: string; cwd: string; port: string; bind: string }) => Promise<{ ok: boolean; pid?: number; reason?: string }>;
      gatewayStop: () => Promise<{ ok: boolean }>;
      gatewaySuspend: () => Promise<{ ok: boolean; reason?: string }>;
      gatewayResume: () => Promise<{ ok: boolean; reason?: string }>;
      gatewayGetStatus: () => Promise<GatewayStatus>;
      gatewaySystemCheck: () => Promise<SystemCheckItem[]>;
      onGatewayOutput: (callback: (data: string) => void) => () => void;
      onGatewayStatus: (callback: (status: GatewayStatus) => void) => () => void;

      // Clipboard
      copyToClipboard: (text: string) => Promise<{ ok: boolean }>;

      getSystemInfo: () => Promise<{
        platform: string;
        arch: string;
        home: string;
        nodeVersion: string;
      }>;
      listAgents: () => Promise<AgentsListResult>;
      exportAgents: (options: ExportOptions) => Promise<{ size: number }>;
      showSaveDialog: (options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
      showFolderDialog: (options: { title?: string; defaultPath?: string }) => Promise<string | null>;

      // Database - VIP
      dbVipGet: () => Promise<{ active: boolean; expiresAt: string | null }>;
      dbVipActivate: (months: number, outTradeNo?: string, amount?: number) => Promise<{ active: boolean; expiresAt: string }>;
      dbVipReset: () => Promise<{ active: boolean; expiresAt: null }>;

      // Database - Config
      dbConfigGet: (key: string) => Promise<string | null>;
      dbConfigSet: (key: string, value: string) => Promise<void>;
      dbConfigDelete: (key: string) => Promise<void>;
      dbConfigGetAll: () => Promise<Record<string, string>>;

      // Database - Orders
      dbOrderSave: (outTradeNo: string, amount: number, description?: string) => Promise<void>;
      dbOrderUpdateStatus: (outTradeNo: string, status: string) => Promise<void>;
      dbOrderGet: (outTradeNo: string) => Promise<{ id: number; out_trade_no: string; amount: number; status: string; created_at: string; paid_at: string | null; description: string | null } | null>;

      // Database - Debug
      dbGetPath: () => Promise<string>;

      // Local config (reads bundled assets/banben.json)
      readLocalConfig: () => Promise<import('../lib/remoteConfig').RemoteConfig | null>;

      // App version & auto-update
      getAppVersion: () => Promise<string>;
      checkUpdate: () => Promise<{
        ok: boolean;
        error?: string;
        current?: string;
        latest?: string;
        hasUpdate?: boolean;
        downloadUrl?: string | null;
        releaseNotes?: string;
        releaseDate?: string;
        versionsUrl?: string;
      }>;
      downloadUpdate: (downloadUrl: string) => Promise<{ ok: boolean; error?: string }>;
      restartApp: () => Promise<void>;
      openVersionsPage: () => Promise<{ ok: boolean }>;
      onUpdateProgress: (callback: (data: { downloaded: number; total: number; pct: number }) => void) => () => void;

      // OpenClaw CLI self-update
      ocCheckUpdate: () => Promise<{ ok: boolean; current?: string; latest?: string; hasUpdate?: boolean; error?: string }>;
      ocInstall: () => Promise<{ ok: boolean; version?: string; error?: string }>;
      onOcUpdateOutput: (callback: (line: string) => void) => () => void;

      // WeChat (openclaw-weixin) channel
      weixinInstallPlugin: () => Promise<{ ok: boolean; error?: string }>;
      onWeixinOutput: (callback: (line: string) => void) => () => void;
      weixinGetQrcode: () => Promise<{ ok: boolean; url?: string; token?: string; error?: string }>;
      weixinPollStatus: (qrcode: string) => Promise<{ ok: boolean; status?: string; botToken?: string; ilinkBotId?: string; error?: string }>;

      // WeChat Pay (via Electron main process)
      payCreateOrder: (amount: number, description: string) => Promise<{
        success: boolean;
        data?: { code_url: string; out_trade_no: string };
        message?: string;
      }>;
      payCheckStatus: (outTradeNo: string) => Promise<{
        success: boolean;
        data?: { status: string; statusDesc: string; amount: number | null; successTime: string | null };
        message?: string;
      }>;
    };
  }
}
