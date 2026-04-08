const { app, BrowserWindow, ipcMain, dialog, clipboard, Tray, Menu, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");

// Debug: write all errors to a log file
const debugLog = path.join(require("os").homedir(), "openclaw-installer-debug.log");
fs.writeFileSync(debugLog, `[${new Date().toISOString()}] App starting\n`);
function logDebug(msg) {
  try { fs.appendFileSync(debugLog, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}
process.on("uncaughtException", (err) => { logDebug(`UNCAUGHT: ${err.stack || err}`); });
process.on("unhandledRejection", (err) => { logDebug(`UNHANDLED: ${err}`); });
const os = require("os");
const { spawn, execSync } = require("child_process");
const archiver = require("archiver");
const AdmZip = require("adm-zip");
const { Worker } = require("worker_threads");
const database = require("./database");
const wechatPay = require("./wechatPay");

let mainWindow;
let tray = null;
let trayAnimTimer = null;
let trayFrameIndex = 0;
let isQuitting = false;

// ─── Tray Icon Frames (rotating blue cube) ──────────────────────────────────
const TRAY_FRAME_COUNT = 12;
const TRAY_ANIM_INTERVAL = 150; // ms per frame

function getTrayFrames() {
  const frames = [];
  for (let i = 0; i < TRAY_FRAME_COUNT; i++) {
    const p = path.join(__dirname, "..", "assets", `tray-${i}.png`);
    if (fs.existsSync(p)) {
      frames.push(nativeImage.createFromPath(p));
    }
  }
  return frames;
}

function startTrayAnimation() {
  const frames = getTrayFrames();
  if (!frames.length || !tray) return;
  stopTrayAnimation();
  trayFrameIndex = 0;
  trayAnimTimer = setInterval(() => {
    if (!tray) { stopTrayAnimation(); return; }
    tray.setImage(frames[trayFrameIndex]);
    trayFrameIndex = (trayFrameIndex + 1) % frames.length;
  }, TRAY_ANIM_INTERVAL);
}

function stopTrayAnimation() {
  if (trayAnimTimer) {
    clearInterval(trayAnimTimer);
    trayAnimTimer = null;
  }
}

// ─── System Tray ────────────────────────────────────────────────────────────
function createTray() {
  logDebug("createTray() called");
  const iconPath = path.join(__dirname, "..", "assets", "tray-icon.png");
  logDebug(`icon path: ${iconPath}, exists: ${fs.existsSync(iconPath)}`);
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  const sz = icon.getSize();
  logDebug(`icon size: ${sz.width}x${sz.height}, empty: ${icon.isEmpty()}`);

  tray = new Tray(icon);
  tray.setToolTip("OpenClaw Gateway");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "唤醒窗口",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "联系作者 / 赞助",
      click: () => {
        shell.openExternal("http://120.27.16.1/zan.html");
      },
    },
    { type: "separator" },
    {
      label: "退出软件",
      click: () => {
        isQuitting = true;
        stopTrayAnimation();
        // Stop gateway before quitting
        if (gateway.child) {
          try {
            if (process.platform === "win32" && gateway.pid) {
              execSync(`taskkill /pid ${gateway.pid} /T /F`, { timeout: 10000 });
            } else {
              gateway.child.kill("SIGTERM");
            }
          } catch { /* ignore */ }
        }
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Double-click tray icon to show window
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Start the rotation animation
  startTrayAnimation();
  logDebug("Tray created and animation started");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, "../assets/icon.png"),
    backgroundColor: "#09090b",
  });

  // Minimize to tray instead of closing
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  if (relaunchAsAdministrator()) {
    logDebug("Relaunching app as administrator");
    app.quit();
    return;
  }
  logDebug("App ready");
  createWindow();
  logDebug("Window created");
  try {
    createTray();
    logDebug("Tray created OK");
  } catch (err) {
    logDebug(`Tray creation FAILED: ${err.stack || err}`);
  }
});

app.on("window-all-closed", () => {
  // Don't quit — we stay in the tray
});

app.on("before-quit", () => {
  isQuitting = true;
});

// Window controls
ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on("window:close", () => mainWindow?.close());

// Minimize to system tray
ipcMain.on("window:toTray", () => {
  logDebug(`window:toTray received, mainWindow exists: ${!!mainWindow}`);
  if (mainWindow) {
    mainWindow.hide();
    logDebug("Window hidden");
  }
});

// ─── Sandbox Portable Runtime ────────────────────────────────────────────────
// Downloads a portable Node.js zip directly (no Scoop dependency), extracts to
// ~/.openclaw/sandbox/, then uses it to install OpenClaw CLI. This replaces the
// fragile Scoop-based approach with a single reliable download + extract flow.

const NODE_VERSION = "v22.14.0";
const SANDBOX_BASE = path.join(os.homedir(), ".openclaw", "sandbox");

function getSandboxPaths() {
  const arch = process.arch === "ia32" ? "x86" : "x64";
  const nodeDirName = `node-${NODE_VERSION}-win-${arch}`;
  return {
    base: SANDBOX_BASE,
    nodeDir: path.join(SANDBOX_BASE, nodeDirName),
    nodeExe: path.join(SANDBOX_BASE, nodeDirName, "node.exe"),
    npmCmd: path.join(SANDBOX_BASE, nodeDirName, "npm.cmd"),
    npxCmd: path.join(SANDBOX_BASE, nodeDirName, "npx.cmd"),
    globalDir: path.join(SANDBOX_BASE, "global"),
    openclawBin: path.join(SANDBOX_BASE, "global", "node_modules", ".bin"),
    zipName: `${nodeDirName}.zip`,
  };
}

function getNodeDownloadUrls(profile) {
  const arch = process.arch === "ia32" ? "x86" : "x64";
  const filename = `node-${NODE_VERSION}-win-${arch}.zip`;
  const urls = [];
  if (profile && profile.region === "cn") {
    urls.push(`https://cdn.npmmirror.com/binaries/node/${NODE_VERSION}/${filename}`);
    urls.push(`https://npmmirror.com/mirrors/node/${NODE_VERSION}/${filename}`);
  }
  urls.push(`https://nodejs.org/dist/${NODE_VERSION}/${filename}`);
  return urls;
}

function getTailscaleDownloadUrls(profile) {
  const arch = process.arch === "ia32" ? "x86" : "amd64";
  const urls = [];
  // Tailscale MSI direct download
  urls.push(`https://pkgs.tailscale.com/stable/tailscale-setup-latest-${arch}.msi`);
  return urls;
}

// Download a file with progress callback, supports HTTPS redirects
function downloadFileWithProgress(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl, redirectCount) => {
      if (redirectCount > 5) { reject(new Error("Too many redirects")); return; }
      const client = requestUrl.startsWith("https") ? require("https") : require("http");
      const req = client.get(requestUrl, { timeout: 60000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          doRequest(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} from ${requestUrl}`));
          return;
        }
        const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
        let downloadedBytes = 0;
        const file = fs.createWriteStream(destPath);
        res.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          if (onProgress) onProgress(downloadedBytes, totalBytes);
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve({ size: downloadedBytes })));
        file.on("error", (err) => { fs.unlink(destPath, () => {}); reject(err); });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(new Error("Download timeout")); });
    };
    doRequest(url, 0);
  });
}

// Download with fallback URLs
async function downloadWithFallback(urls, destPath, onProgress, onLog) {
  let lastError = null;
  for (const url of urls) {
    try {
      if (onLog) onLog(`下载: ${url}`);
      await downloadFileWithProgress(url, destPath, onProgress);
      return;
    } catch (err) {
      lastError = err;
      if (onLog) onLog(`下载失败: ${url} - ${err.message}`);
    }
  }
  throw lastError || new Error("所有下载地址均失败");
}

// Extract zip using adm-zip in a worker thread.
// adm-zip.extractAllTo() is synchronous — running it on the main thread blocks
// the event loop and prevents IPC messages (progress updates) from being sent.
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    // Resolve adm-zip path in main-thread context so the worker can require it
    // by absolute path (avoids module resolution issues in eval workers).
    const admZipPath = require.resolve("adm-zip");
    const workerScript = `
const { workerData, parentPort } = require('worker_threads');
const AdmZip = require(${JSON.stringify(admZipPath)});
const fs = require('fs');
try {
  fs.mkdirSync(workerData.destDir, { recursive: true });
  const zip = new AdmZip(workerData.zipPath);
  zip.extractAllTo(workerData.destDir, true);
  parentPort.postMessage({ ok: true });
} catch (e) {
  parentPort.postMessage({ ok: false, error: e.message });
}
`;
    const worker = new Worker(workerScript, {
      eval: true,
      workerData: { zipPath, destDir },
    });
    worker.on("message", (msg) => {
      if (msg.ok) resolve();
      else reject(new Error("adm-zip extraction failed: " + msg.error));
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Extraction worker exited with code ${code}`));
    });
  });
}

// Check sandbox runtime status
function getSandboxStatus() {
  const paths = getSandboxPaths();
  const nodeInstalled = fs.existsSync(paths.nodeExe);
  const npmInstalled = fs.existsSync(paths.npmCmd);
  // Check if openclaw is installed in the sandbox global dir
  const openclawCmd = path.join(paths.globalDir, "openclaw.cmd");
  const openclawBin = path.join(paths.openclawBin, "openclaw.cmd");
  const openclawInstalled = fs.existsSync(openclawCmd) || fs.existsSync(openclawBin);

  let nodeVersion = null;
  if (nodeInstalled) {
    try {
      nodeVersion = execSync(`"${paths.nodeExe}" --version`, { encoding: "utf-8", timeout: 5000 }).trim();
    } catch {}
  }

  let openclawVersion = null;
  if (openclawInstalled) {
    try {
      const env = { ...process.env, PATH: `${paths.openclawBin};${path.dirname(paths.nodeExe)};${process.env.PATH}` };
      openclawVersion = execSync(`"${paths.nodeExe}" "${path.join(paths.globalDir, "node_modules", "openclaw", "dist", "cli.mjs")}" --version`, {
        encoding: "utf-8", timeout: 10000, env,
      }).trim();
    } catch {
      // Fallback: try directly
      try {
        const env = getSandboxEnv();
        openclawVersion = execSync("openclaw --version", { encoding: "utf-8", timeout: 10000, env }).trim();
      } catch {}
    }
  }

  return {
    sandboxDir: paths.base,
    nodeInstalled,
    npmInstalled,
    openclawInstalled,
    nodeVersion,
    openclawVersion,
    paths,
  };
}

// Build env with sandbox paths on PATH
function getSandboxEnv() {
  const paths = getSandboxPaths();
  const env = { ...process.env };
  const extraDirs = [
    path.dirname(paths.nodeExe),
    paths.openclawBin,
    path.join(paths.globalDir, "node_modules", ".bin"),
    path.join(env.APPDATA || "", "npm"),
    path.join(env.LOCALAPPDATA || "", "pnpm"),
  ].filter(Boolean);
  const sep = ";";
  for (const dir of extraDirs) {
    if (dir && env.PATH && !env.PATH.includes(dir)) {
      env.PATH = dir + sep + env.PATH;
    }
  }
  return env;
}

// The main one-click install function
async function sandboxOneClickInstall(options = {}) {
  const { installTailscale = false } = options;
  const profile = await detectMirrorProfile();
  const paths = getSandboxPaths();
  const emit = (msg) => mainWindow?.webContents.send("sandbox:output", msg);
  const emitProgress = (phase, current, total, detail) => {
    mainWindow?.webContents.send("sandbox:progress", { phase, current, total, detail });
  };

  const results = { phases: [], profile, ok: false };

  try {
    // ── Phase 1: Detect environment ──
    emit("[1/5] 检测系统环境...");
    emitProgress("detect", 0, 1, "检测中...");
    const info = {
      platform: process.platform,
      arch: process.arch,
      region: profile.region,
      ip: profile.ip,
    };
    emit(`  系统: Windows ${process.arch}`);
    emit(`  区域: ${profile.label}`);
    if (profile.ip) emit(`  公网IP: ${profile.ip}`);

    // Check if already fully installed
    const existingStatus = getSandboxStatus();
    if (existingStatus.nodeInstalled && existingStatus.openclawInstalled) {
      emit("  ✓ 沙箱运行时已完整安装，跳过下载");
      emit(`  Node.js: ${existingStatus.nodeVersion}`);
      emit(`  OpenClaw: ${existingStatus.openclawVersion || "已安装"}`);
      emitProgress("detect", 1, 1, "已安装");
      results.phases.push({ name: "detect", ok: true, skipped: true });

      // Still ensure PATH is updated
      await ensureSandboxPath(paths);
      results.ok = true;
      emit("");
      emit("✅ 一键安装完成（使用已有沙箱环境）");
      return results;
    }

    // Also check system-wide Node.js and openclaw
    const systemNode = await findSystemCommand("node");
    const systemOpenClaw = await findSystemCommand("openclaw");
    if (systemNode && systemOpenClaw) {
      emit("  ✓ 系统已安装 Node.js 和 OpenClaw，无需沙箱");
      emitProgress("detect", 1, 1, "系统已就绪");
      results.phases.push({ name: "detect", ok: true, skipped: true });
      results.ok = true;
      emit("");
      emit("✅ 一键安装完成（使用系统环境）");
      return results;
    }

    emitProgress("detect", 1, 1, "完成");
    results.phases.push({ name: "detect", ok: true });

    // ── Phase 2: Download Node.js portable ──
    emit("");
    emit("[2/5] 下载 Node.js 便携版运行时...");
    const zipPath = path.join(app.getPath("temp"), paths.zipName);

    if (existingStatus.nodeInstalled) {
      emit(`  ✓ Node.js 已存在: ${existingStatus.nodeVersion}，跳过下载`);
      emitProgress("download", 1, 1, "已存在");
      results.phases.push({ name: "download", ok: true, skipped: true });
    } else {
      const urls = getNodeDownloadUrls(profile);
      try {
        await downloadWithFallback(urls, zipPath, (downloaded, total) => {
          const mb = (downloaded / 1048576).toFixed(1);
          const totalMb = total > 0 ? (total / 1048576).toFixed(1) : "?";
          const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
          emitProgress("download", downloaded, total, `${mb}MB / ${totalMb}MB (${pct}%)`);
        }, emit);
        emit(`  ✓ 下载完成: ${paths.zipName}`);
        results.phases.push({ name: "download", ok: true });
      } catch (err) {
        emit(`  ✗ 下载失败: ${err.message}`);
        emitProgress("download", 0, 1, "失败");
        results.phases.push({ name: "download", ok: false, error: err.message });
        throw err;
      }

      // ── Phase 3: Extract ──
      emit("");
      emit("[3/5] 解压运行时到沙箱目录...");
      emitProgress("extract", 0, 1, "解压中...");
      try {
        fs.mkdirSync(paths.base, { recursive: true });
        await extractZip(zipPath, paths.base);
        // Verify extraction
        if (!fs.existsSync(paths.nodeExe)) {
          throw new Error(`解压后未找到 node.exe: ${paths.nodeExe}`);
        }
        emit(`  ✓ 已解压到: ${paths.nodeDir}`);
        const ver = execSync(`"${paths.nodeExe}" --version`, { encoding: "utf-8", timeout: 5000 }).trim();
        emit(`  Node.js 版本: ${ver}`);
        emitProgress("extract", 1, 1, "完成");
        results.phases.push({ name: "extract", ok: true });
      } catch (err) {
        emit(`  ✗ 解压失败: ${err.message}`);
        emitProgress("extract", 0, 1, "失败");
        results.phases.push({ name: "extract", ok: false, error: err.message });
        throw err;
      } finally {
        // Clean up zip
        try { fs.unlinkSync(zipPath); } catch {}
      }
    }

    // ── Phase 4: Install OpenClaw CLI ──
    emit("");
    emit("[4/5] 安装 OpenClaw CLI...");
    emitProgress("install", 0, 1, "安装中...");
    try {
      fs.mkdirSync(paths.globalDir, { recursive: true });
      const npmRegistry = profile.region === "cn"
        ? "https://mirrors.cloud.tencent.com/npm/"
        : "https://registry.npmjs.org/";

      // Configure npm to use sandbox global dir and mirror
      // Strip inherited npm_config_* env vars from Electron to avoid warnings
      const cleanEnv = { ...process.env };
      for (const key of Object.keys(cleanEnv)) {
        if (/^npm_config_/i.test(key) || /^npm_package_/i.test(key)) {
          delete cleanEnv[key];
        }
      }
      const npmEnv = {
        ...cleanEnv,
        PATH: `${path.dirname(paths.nodeExe)};${process.env.PATH}`,
        npm_config_prefix: paths.globalDir,
        npm_config_registry: npmRegistry,
        npm_config_cache: path.join(paths.base, "npm-cache"),
      };

      emit(`  npm 镜像: ${npmRegistry}`);
      emit(`  安装目录: ${paths.globalDir}`);

      // Run npm install -g openclaw@latest
      const installResult = await new Promise((resolve) => {
        const child = spawn(paths.npmCmd, ["install", "-g", "openclaw@latest"], {
          env: npmEnv,
          cwd: paths.base,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => {
          const text = d.toString();
          stdout += text;
          text.split(/\r?\n/).filter(Boolean).forEach((line) => emit(`  ${line}`));
        });
        child.stderr.on("data", (d) => {
          const text = d.toString();
          stderr += text;
          // npm often writes progress to stderr, show it
          text.split(/\r?\n/).filter(Boolean).forEach((line) => emit(`  ${line}`));
        });
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
      });

      if (installResult.code !== 0) {
        throw new Error(`npm install 退出码: ${installResult.code}`);
      }

      emit("  ✓ OpenClaw CLI 安装成功");
      emitProgress("install", 1, 1, "完成");
      results.phases.push({ name: "install", ok: true });
    } catch (err) {
      emit(`  ✗ OpenClaw 安装失败: ${err.message}`);
      emitProgress("install", 0, 1, "失败");
      results.phases.push({ name: "install", ok: false, error: err.message });
      throw err;
    }

    // ── Phase 5: Configure PATH and verify ──
    emit("");
    emit("[5/5] 配置环境变量并验证...");
    emitProgress("configure", 0, 1, "配置中...");
    try {
      await ensureSandboxPath(paths);
      emit("  ✓ 已将沙箱路径写入用户 PATH");

      // Verify openclaw works
      const env = getSandboxEnv();
      const verResult = execSync("openclaw --version", { encoding: "utf-8", timeout: 15000, env }).trim();
      emit(`  OpenClaw 版本: ${verResult}`);

      emitProgress("configure", 1, 1, "完成");
      results.phases.push({ name: "configure", ok: true });
    } catch (err) {
      emit(`  ⚠ 环境配置警告: ${err.message}`);
      emitProgress("configure", 1, 1, "部分完成");
      results.phases.push({ name: "configure", ok: true, warning: err.message });
    }

    // Optional: Install Tailscale
    if (installTailscale) {
      emit("");
      emit("[附加] 下载并安装 Tailscale...");
      try {
        const msiPath = path.join(app.getPath("temp"), "tailscale-setup.msi");
        const tailscaleUrls = getTailscaleDownloadUrls(profile);
        await downloadWithFallback(tailscaleUrls, msiPath, null, emit);
        emit("  正在静默安装 Tailscale...");
        execSync(`msiexec /i "${msiPath}" /quiet /norestart`, { timeout: 120000 });
        emit("  ✓ Tailscale 已安装");
        try { fs.unlinkSync(msiPath); } catch {}
      } catch (err) {
        emit(`  ⚠ Tailscale 安装失败 (可选): ${err.message}`);
        emit("  您可以稍后手动安装 Tailscale: https://tailscale.com/download");
      }
    }

    results.ok = true;
    emit("");
    emit("✅ 一键安装全部完成！");
    return results;
  } catch (err) {
    emit("");
    emit(`❌ 安装失败: ${err.message}`);
    results.ok = false;
    results.error = err.message;
    return results;
  }
}

// Helper: find a command on system PATH
async function findSystemCommand(cmd) {
  try {
    const isWin = process.platform === "win32";
    const whichCmd = isWin
      ? `Get-Command ${cmd} -ErrorAction Stop | Select-Object -ExpandProperty Source`
      : `which ${cmd}`;
    const shell = isWin ? "powershell.exe" : "/bin/bash";
    const shellArgs = isWin ? ["-NoProfile", "-Command", whichCmd] : ["-c", whichCmd];
    const result = execSync([shell, ...shellArgs].join(" "), {
      encoding: "utf-8", timeout: 10000, env: getEnvWithNpmBin(),
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

// Ensure sandbox bin dirs are in user PATH
async function ensureSandboxPath(paths) {
  const dirsToAdd = [
    path.dirname(paths.nodeExe),
    paths.openclawBin,
    path.join(paths.globalDir, "node_modules", ".bin"),
  ];

  try {
    const userPath = execSync(
      'powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'PATH\', \'User\')"',
      { encoding: "utf-8", timeout: 10000 }
    ).trim();

    let newPath = userPath;
    for (const dir of dirsToAdd) {
      if (dir && !newPath.split(";").some((p) => p.replace(/[\\/]+$/, "").toLowerCase() === dir.toLowerCase())) {
        newPath = newPath ? `${newPath};${dir}` : dir;
      }
    }
    if (newPath !== userPath) {
      execSync(
        `powershell.exe -NoProfile -Command "[Environment]::SetEnvironmentVariable('PATH', '${newPath.replace(/'/g, "''")}', 'User')"`,
        { timeout: 10000 }
      );
    }
    // Update current process PATH
    for (const dir of dirsToAdd) {
      if (dir && process.env.PATH && !process.env.PATH.includes(dir)) {
        process.env.PATH = `${dir};${process.env.PATH}`;
      }
    }
  } catch (err) {
    logDebug(`ensureSandboxPath failed: ${err.message}`);
  }
}

// ─── Windows Service (Task Scheduler) ────────────────────────────────────────
// Register/unregister the gateway as a Windows scheduled task for auto-start

function getServiceTaskName() {
  return "OpenClawGateway";
}

async function registerGatewayService(config = {}) {
  const { port = "18789", bind = "loopback" } = config;
  const taskName = getServiceTaskName();
  const paths = getSandboxPaths();
  const env = getSandboxEnv();

  // Find openclaw command
  let openclawExe = "openclaw";
  const resolved = await resolveOpenClawPath();
  if (resolved) {
    openclawExe = resolved.cmd;
  }

  const gatewayCmd = `${openclawExe} gateway run --bind ${bind} --port ${port} --force --allow-unconfigured`;

  // Create a wrapper script that sets up PATH and runs the gateway
  const wrapperScript = path.join(SANDBOX_BASE, "gateway-service.cmd");
  const pathDirs = [
    path.dirname(paths.nodeExe),
    paths.openclawBin,
    path.join(env.APPDATA || "", "npm"),
    path.join(env.LOCALAPPDATA || "", "pnpm"),
  ].filter((d) => d && fs.existsSync(d));

  const scriptContent = `@echo off\r\nset PATH=${pathDirs.join(";")};%PATH%\r\n${gatewayCmd}\r\n`;
  fs.mkdirSync(path.dirname(wrapperScript), { recursive: true });
  fs.writeFileSync(wrapperScript, scriptContent, "utf8");

  // Register with Task Scheduler (runs at logon, /RL LIMITED = no admin needed)
  try {
    execSync(
      `schtasks /Create /TN "${taskName}" /TR "'${wrapperScript.replace(/'/g, "''")}'" /SC ONLOGON /RL LIMITED /F`,
      { encoding: "utf-8", timeout: 15000, shell: "powershell.exe" }
    );
    return { ok: true, taskName, wrapperScript };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function unregisterGatewayService() {
  const taskName = getServiceTaskName();
  try {
    execSync(`schtasks /Delete /TN "${taskName}" /F`, { encoding: "utf-8", timeout: 10000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getGatewayServiceStatus() {
  const taskName = getServiceTaskName();
  try {
    const output = execSync(`schtasks /Query /TN "${taskName}" /FO CSV /NH`, {
      encoding: "utf-8", timeout: 10000,
    }).trim();
    // CSV: "TaskName","Next Run Time","Status"
    const registered = output.includes(taskName);
    const running = output.toLowerCase().includes("running");
    return { registered, running, raw: output };
  } catch {
    return { registered: false, running: false };
  }
}

// Discover the npm global prefix (cached)
let _npmGlobalPrefix = null;
function getNpmGlobalPrefix() {
  if (_npmGlobalPrefix) return _npmGlobalPrefix;
  try {
    const { execSync } = require("child_process");
    _npmGlobalPrefix = execSync("npm prefix -g", { encoding: "utf-8", timeout: 10000 }).trim();
  } catch {
    // Fallback to well-known paths
    _npmGlobalPrefix = process.platform === "win32"
      ? path.join(process.env.APPDATA || "", "npm")
      : "/usr/local";
  }
  return _npmGlobalPrefix;
}

// Build an env with npm global bin on PATH so openclaw is found
function getEnvWithNpmBin() {
  const env = { ...process.env };
  const isWin = process.platform === "win32";
  const prefix = getNpmGlobalPrefix();
  // On Windows npm puts .cmd shims directly in the prefix; on Unix they're in prefix/bin
  const binDir = isWin ? prefix : path.join(prefix, "bin");
  const sep = isWin ? ";" : ":";
  const extraDirs = [];
  if (isWin) {
    // Sandbox portable runtime paths (highest priority)
    const sbPaths = getSandboxPaths();
    extraDirs.push(path.dirname(sbPaths.nodeExe));
    extraDirs.push(sbPaths.openclawBin);
    extraDirs.push(path.join(sbPaths.globalDir, "node_modules", ".bin"));
    // Legacy Scoop paths
    extraDirs.push(path.join(env.USERPROFILE || "", "scoop", "shims"));
    extraDirs.push(path.join(env.ProgramData || "C:\\ProgramData", "scoop", "shims"));
    extraDirs.push(path.join(env.LOCALAPPDATA || "", "pnpm"));
    extraDirs.push(path.join(env.APPDATA || "", "npm"));
  }
  if (env.PATH && !env.PATH.includes(binDir)) {
    env.PATH = binDir + sep + env.PATH;
  }
  for (const dir of extraDirs) {
    if (dir && fs.existsSync(dir) && env.PATH && !env.PATH.includes(dir)) {
      env.PATH = dir + sep + env.PATH;
    }
  }
  return env;
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function isWindowsElevated() {
  if (process.platform !== "win32") return true;
  try {
    const result = execSync(
      `powershell.exe -NoProfile -Command "[bool](([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"`,
      { encoding: "utf-8", timeout: 10000 },
    ).trim();
    return result.toLowerCase() === "true";
  } catch {
    return false;
  }
}

function relaunchAsAdministrator() {
  if (process.platform !== "win32" || !app.isPackaged || isWindowsElevated()) return false;
  try {
    const exePath = process.execPath;
    const args = process.argv.slice(1).map((arg) => `'${escapePowerShellSingleQuoted(arg)}'`).join(",");
    const command = [
      `$exe='${escapePowerShellSingleQuoted(exePath)}'`,
      `$args=@(${args})`,
      "Start-Process -FilePath $exe -Verb RunAs -ArgumentList $args",
    ].join("; ");
    spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return true;
  } catch (err) {
    logDebug(`Failed to relaunch elevated: ${err.stack || err}`);
    return false;
  }
}

async function fetchJson(url) {
  const client = url.startsWith("https:") ? require("https") : require("http");
  return new Promise((resolve, reject) => {
    const req = client.get(url, { timeout: 5000 }, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode || 0}`));
        return;
      }
      let data = "";
      res.on("data", (chunk) => { data += chunk.toString(); });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
  });
}

async function detectMirrorProfile() {
  const fallback = {
    region: "global",
    countryCode: "",
    ip: "",
    npmRegistry: "https://registry.npmjs.org/",
    scoopRepo: "https://github.com/ScoopInstaller/Scoop",
    scoopBucketRepo: "https://github.com/ScoopInstaller/Bucket",
    installScriptUrl: "https://raw.githubusercontent.com/ScoopInstaller/Install/master/install.ps1",
    label: "默认官方源",
  };

  try {
    const data = await Promise.any([
      fetchJson("http://ip-api.com/json/?fields=status,countryCode,country,query,isp,org"),
      fetchJson("https://ipwho.is/"),
      fetchJson("https://ipapi.co/json/"),
    ]);
    const countryCode = data.countryCode || data.country_code || "";
    const ip = data.query || data.ip || "";
    if (countryCode === "CN") {
      return {
        region: "cn",
        countryCode,
        ip,
        npmRegistry: "https://mirrors.cloud.tencent.com/npm/",
        scoopRepo: "https://mirror.ghproxy.com/https://github.com/ScoopInstaller/Scoop",
        scoopBucketRepo: "https://mirror.ghproxy.com/https://github.com/ScoopInstaller/Bucket",
        installScriptUrl: "https://mirror.ghproxy.com/https://raw.githubusercontent.com/ScoopInstaller/Install/master/install.ps1",
        label: "中国大陆，腾讯云 npm 镜像 + GitHub 加速",
      };
    }
    return { ...fallback, countryCode, ip, label: countryCode ? `官方源 (${countryCode})` : fallback.label };
  } catch {
    return fallback;
  }
}

async function runElevatedPowerShellScript(scriptBody) {
  const tmpDir = app.getPath("temp");
  const scriptPath = path.join(tmpDir, `openclaw-installer-${Date.now()}.ps1`);
  const logPath = path.join(tmpDir, `openclaw-installer-${Date.now()}.log`);
  fs.writeFileSync(scriptPath, scriptBody, "utf8");

  try {
    if (isWindowsElevated()) {
      return await new Promise((resolve) => {
        const child = spawn(
          "powershell.exe",
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-LogPath", logPath],
          {
            env: getEnvWithNpmBin(),
            cwd: process.env.USERPROFILE || process.env.HOME,
          },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data) => { stdout += data.toString(); });
        child.stderr.on("data", (data) => { stderr += data.toString(); });
        child.on("close", (code) => {
          let logText = "";
          try {
            if (fs.existsSync(logPath)) logText = fs.readFileSync(logPath, "utf8");
          } catch {}
          resolve({ code, stdout: [stdout, logText].filter(Boolean).join("\n"), stderr });
        });
        child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
      });
    }

    const command = [
      "$ErrorActionPreference='Stop'",
      `$script='${escapePowerShellSingleQuoted(scriptPath)}'`,
      `$log='${escapePowerShellSingleQuoted(logPath)}'`,
      "$argsList=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$script,'-LogPath',$log)",
      "$proc=Start-Process powershell -Verb RunAs -ArgumentList $argsList -Wait -PassThru",
      "if (Test-Path $log) { Get-Content $log -Raw }",
      "exit $proc.ExitCode",
    ].join("; ");

    const result = await new Promise((resolve) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
        env: getEnvWithNpmBin(),
        cwd: process.env.USERPROFILE || process.env.HOME,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data) => { stdout += data.toString(); });
      child.stderr.on("data", (data) => { stderr += data.toString(); });
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
    });
    return result;
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
  }
}

function buildWindowsToolchainScript(profile) {
  const npmRegistry = escapePowerShellSingleQuoted(profile.npmRegistry);
  const scoopRepo = escapePowerShellSingleQuoted(profile.scoopRepo);
  const scoopBucketRepo = escapePowerShellSingleQuoted(profile.scoopBucketRepo);
  const installScriptUrl = escapePowerShellSingleQuoted(profile.installScriptUrl);
  return String.raw`
param([string]$LogPath)
$ErrorActionPreference = 'Stop'
function Write-Log([string]$msg) {
  $line = "[$([DateTime]::Now.ToString('u'))] $msg"
  Write-Host $line
  if ($LogPath) { Add-Content -Path $LogPath -Value $line -Encoding UTF8 }
}

function Invoke-DownloadWithFallback([string[]]$Urls, [string]$OutFile) {
  $lastError = $null
  foreach ($url in $Urls) {
    if ([string]::IsNullOrWhiteSpace($url)) { continue }
    try {
      Write-Log "下载文件: $url"
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $OutFile
      return
    } catch {
      $lastError = $_
      Write-Log "下载失败: $url => $($_.Exception.Message)"
    }
  }
  if ($lastError) { throw $lastError }
  throw '未提供可用下载地址'
}

function Invoke-LoggedCommand([string]$title, [scriptblock]$command) {
  Write-Log $title
  $output = & $command 2>&1
  foreach ($line in @($output)) {
    if ($null -ne $line) {
      $text = "$line".Trim()
      if ($text) { Write-Log $text }
    }
  }
  if ($LASTEXITCODE -ne 0) {
    throw "$title 失败，退出码: $LASTEXITCODE"
  }
}

try {
  Write-Log '开始安装 Windows 基础环境'
  Write-Log '已请求管理员权限运行'
  Set-ExecutionPolicy Bypass -Scope Process -Force
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $env:SCOOP = Join-Path $env:USERPROFILE 'scoop'
  $env:SCOOP_GLOBAL = Join-Path $env:ProgramData 'scoop'
  [Environment]::SetEnvironmentVariable('SCOOP', $env:SCOOP, 'User')
  [Environment]::SetEnvironmentVariable('SCOOP_GLOBAL', $env:SCOOP_GLOBAL, 'Machine')

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  foreach ($dir in @("$env:SCOOP\shims", "$env:APPDATA\npm", "$env:LOCALAPPDATA\pnpm")) {
    if (-not [string]::IsNullOrWhiteSpace($dir) -and $userPath -notlike "*$dir*") {
      $userPath = if ($userPath) { "$userPath;$dir" } else { $dir }
    }
  }
  [Environment]::SetEnvironmentVariable('Path', $userPath, 'User')

  $installScript = Join-Path $env:TEMP 'install-scoop.ps1'
  Write-Log '正在准备 Scoop 安装脚本'
  Invoke-DownloadWithFallback @(
    '${installScriptUrl}',
    'https://raw.githubusercontent.com/ScoopInstaller/Install/master/install.ps1'
  ) -OutFile $installScript

  if (-not (Test-Path "$env:SCOOP\shims\scoop.cmd")) {
    Invoke-LoggedCommand '开始安装 Scoop' {
      powershell -NoProfile -ExecutionPolicy Bypass -File $installScript -RunAsAdmin -ScoopDir $env:SCOOP -ScoopGlobalDir $env:SCOOP_GLOBAL
    }
  } else {
    Write-Log 'Scoop 已安装，跳过'
  }

  $env:PATH = "$env:SCOOP\shims;$env:APPDATA\npm;$env:LOCALAPPDATA\pnpm;" + $env:PATH
  $env:SCOOP_REPO='${scoopRepo}'
  $env:SCOOP_BUCKET_REPO='${scoopBucketRepo}'
  $scoopCmd = Join-Path $env:SCOOP 'shims\scoop.cmd'
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  $pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  $npmCmd = if ($npmCommand) { $npmCommand.Source } else { $null }
  $pnpmCmd = if ($pnpmCommand) { $pnpmCommand.Source } else { $null }

  if (-not (Test-Path $scoopCmd)) {
    throw "Scoop 安装后未找到命令: $scoopCmd"
  }

  Invoke-LoggedCommand '配置 Scoop 镜像源' {
    & $scoopCmd config SCOOP_REPO $env:SCOOP_REPO
  }
  Invoke-LoggedCommand '设置 Scoop 分支' {
    & $scoopCmd config SCOOP_BRANCH master
  }
  try {
    Invoke-LoggedCommand '移除默认 main bucket' {
      & $scoopCmd bucket rm main
    }
  } catch {
    Write-Log 'main bucket 不存在或移除失败，继续执行'
  }
  Invoke-LoggedCommand '添加镜像 main bucket' {
    & $scoopCmd bucket add main $env:SCOOP_BUCKET_REPO
  }

  Invoke-LoggedCommand '安装 Git / Node.js LTS / pnpm / Tailscale' {
    & $scoopCmd install git nodejs-lts pnpm tailscale
  }

  if (-not $npmCmd) {
    $npmCmd = Join-Path $env:SCOOP 'apps\nodejs-lts\current\npm.cmd'
  }

  if (-not $pnpmCmd) {
    $pnpmCmd = Join-Path $env:APPDATA 'npm\pnpm.cmd'
  }

  if (-not (Test-Path $npmCmd)) {
    throw "未找到 npm 命令: $npmCmd"
  }

  if (-not (Test-Path $pnpmCmd)) {
    throw "未找到 pnpm 命令: $pnpmCmd"
  }

  Invoke-LoggedCommand '设置 npm 镜像' {
    & $npmCmd config set registry '${npmRegistry}'
  }
  Invoke-LoggedCommand '设置 pnpm 镜像' {
    & $pnpmCmd config set registry '${npmRegistry}'
  }

  Write-Log '基础环境安装完成'
  Invoke-LoggedCommand '验证 Scoop 版本' {
    & $scoopCmd --version
  }
  Invoke-LoggedCommand '验证 Git 版本' {
    & git --version
  }
  Invoke-LoggedCommand '验证 Node.js 版本' {
    & node --version
  }
  Invoke-LoggedCommand '验证 pnpm 版本' {
    & $pnpmCmd --version
  }
  Invoke-LoggedCommand '验证 Tailscale 版本' {
    & tailscale version
  }
} catch {
  Write-Log "安装失败: $($_.Exception.Message)"
  if ($_.ScriptStackTrace) {
    Write-Log "堆栈: $($_.ScriptStackTrace)"
  }
  exit 1
}
`;
}

function buildWindowsOpenClawScript(profile, installPath) {
  const npmRegistry = escapePowerShellSingleQuoted(profile.npmRegistry);
  const customPrefix = installPath ? escapePowerShellSingleQuoted(installPath) : "";
  return String.raw`
param([string]$LogPath)
$ErrorActionPreference = 'Stop'
function Write-Log([string]$msg) {
  $line = "[$([DateTime]::Now.ToString('u'))] $msg"
  Write-Host $line
  if ($LogPath) { Add-Content -Path $LogPath -Value $line -Encoding UTF8 }
}

Write-Log '开始安装 OpenClaw CLI'
Set-ExecutionPolicy Bypass -Scope Process -Force
$env:PATH = "$env:USERPROFILE\scoop\shims;C:\ProgramData\Scoop\shims;$env:APPDATA\npm;$env:LOCALAPPDATA\pnpm;" + $env:PATH

Write-Log '设置 npm / pnpm 镜像'
& npm config set registry '${npmRegistry}'
& pnpm config set registry '${npmRegistry}'

if ('${customPrefix}') {
  Write-Log '使用自定义 npm 前缀安装 OpenClaw'
  & npm config set prefix '${customPrefix}'
  & npm install -g openclaw@latest --prefix '${customPrefix}'
} else {
  Write-Log '全局安装 OpenClaw CLI'
  & npm install -g openclaw@latest
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
foreach ($dir in @("$env:APPDATA\npm", "$env:LOCALAPPDATA\pnpm"${installPath ? `, '${customPrefix}'` : ""})) {
  if (-not [string]::IsNullOrWhiteSpace($dir) -and $userPath -notlike "*$dir*") {
    $userPath = if ($userPath) { "$userPath;$dir" } else { $dir }
  }
}
[Environment]::SetEnvironmentVariable('Path', $userPath, 'User')

Write-Log 'OpenClaw CLI 安装完成'
& openclaw --version
`;
}

// Execute shell command and stream output
ipcMain.handle("shell:exec", async (_event, command, optCwd) => {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "powershell.exe" : "/bin/bash";
    const shellArgs = isWin ? ["-NoProfile", "-Command", command] : ["-c", command];

    const child = spawn(shell, shellArgs, {
      env: getEnvWithNpmBin(),
      cwd: optCwd || process.env.HOME || process.env.USERPROFILE,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      mainWindow?.webContents.send("shell:output", text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      mainWindow?.webContents.send("shell:output", text);
    });

    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on("error", (err) => {
      resolve({ code: -1, stdout, stderr: err.message });
    });
  });
});

ipcMain.handle("windows:installToolchain", async () => {
  if (process.platform !== "win32") {
    return { ok: false, reason: "仅支持 Windows" };
  }
  const profile = await detectMirrorProfile();
  const result = await runElevatedPowerShellScript(buildWindowsToolchainScript(profile));
  return {
    ok: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    profile,
  };
});

ipcMain.handle("windows:installOpenClaw", async (_event, { installPath }) => {
  if (process.platform !== "win32") {
    return { ok: false, reason: "仅支持 Windows" };
  }
  const profile = await detectMirrorProfile();
  const result = await runElevatedPowerShellScript(buildWindowsOpenClawScript(profile, installPath));
  return {
    ok: result.code === 0,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    profile,
  };
});

// ─── Sandbox One-Click Install IPC ──────────────────────────────────────────
ipcMain.handle("sandbox:oneClickInstall", async (_event, options) => {
  return await sandboxOneClickInstall(options || {});
});

ipcMain.handle("sandbox:status", async () => {
  return getSandboxStatus();
});

// ─── Gateway Service IPC ────────────────────────────────────────────────────
ipcMain.handle("service:register", async (_event, config) => {
  return await registerGatewayService(config);
});

ipcMain.handle("service:unregister", async () => {
  return await unregisterGatewayService();
});

ipcMain.handle("service:status", async () => {
  return getGatewayServiceStatus();
});

// ─── Gateway Service Manager ────────────────────────────────────────────────
// Manages the gateway as a service-level process with health monitoring,
// auto-restart, suspend/resume, and performance optimization.
const gateway = {
  child: null,
  status: "stopped", // stopped | starting | running | suspended | error
  pid: null,
  startTime: null,
  restartCount: 0,
  maxRestarts: 10,
  restartDelay: 3000,      // base delay, grows with backoff
  healthTimer: null,
  autoRestart: true,
  config: { cmd: null, cwd: null, port: null, bind: null },
};

function emitGateway(msg) {
  mainWindow?.webContents.send("gateway:output", msg);
}
function emitStatus() {
  mainWindow?.webContents.send("gateway:status", getGatewayStatus());
}

function getGatewayStatus() {
  const info = {
    status: gateway.status,
    pid: gateway.pid,
    uptime: gateway.startTime ? Math.floor((Date.now() - gateway.startTime) / 1000) : 0,
    restartCount: gateway.restartCount,
    autoRestart: gateway.autoRestart,
    memory: null,
  };
  // Read process memory on Windows
  if (gateway.pid && gateway.status === "running") {
    try {
      const mem = execSync(
        `powershell.exe -NoProfile -Command "(Get-Process -Id ${gateway.pid} -ErrorAction SilentlyContinue).WorkingSet64"`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (mem) info.memory = parseInt(mem, 10);
    } catch { /* ignore */ }
  }
  return info;
}

// Health check: HTTP ping the gateway
function startHealthCheck() {
  stopHealthCheck();
  const port = gateway.config.port || "18789";
  gateway.healthTimer = setInterval(async () => {
    if (gateway.status !== "running") return;
    try {
      const http = require("http");
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 5000 }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      });
    } catch {
      // Health check failed — the process might still be alive but unresponsive
      if (gateway.child && !gateway.child.killed) {
        emitGateway("[健康检查] 网关未响应，等待下次检查...");
      }
    }
  }, 15000);
}

function stopHealthCheck() {
  if (gateway.healthTimer) {
    clearInterval(gateway.healthTimer);
    gateway.healthTimer = null;
  }
}

// Optimize process performance on Windows: set priority to AboveNormal
function optimizeProcess(pid) {
  if (process.platform !== "win32" || !pid) return;
  try {
    execSync(
      `powershell.exe -NoProfile -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | ForEach-Object { $_.PriorityClass = 'AboveNormal' }"`,
      { timeout: 5000 }
    );
    emitGateway("[性能优化] 进程优先级已设置为 AboveNormal");
  } catch { /* ignore */ }
}

// Suspend process on Windows using NtSuspendProcess
function suspendProcess(pid) {
  if (process.platform !== "win32" || !pid) return false;
  try {
    execSync(
      `powershell.exe -NoProfile -Command "$sig='[DllImport(\\\"ntdll.dll\\\")] public static extern uint NtSuspendProcess(IntPtr hProcess);'; $t=Add-Type -MemberDefinition $sig -Name NtDll -PassThru; $p=Get-Process -Id ${pid}; $t::NtSuspendProcess($p.Handle)"`,
      { timeout: 10000 }
    );
    return true;
  } catch { return false; }
}

// Resume process on Windows using NtResumeProcess
function resumeProcess(pid) {
  if (process.platform !== "win32" || !pid) return false;
  try {
    execSync(
      `powershell.exe -NoProfile -Command "$sig='[DllImport(\\\"ntdll.dll\\\")] public static extern uint NtResumeProcess(IntPtr hProcess);'; $t=Add-Type -MemberDefinition $sig -Name NtDll -PassThru; $p=Get-Process -Id ${pid}; $t::NtResumeProcess($p.Handle)"`,
      { timeout: 10000 }
    );
    return true;
  } catch { return false; }
}

// Core: spawn the gateway process
function spawnGateway() {
  const { cmd, cwd: workDir } = gateway.config;
  const port = gateway.config.port || "18789";
  const bind = gateway.config.bind || "loopback";
  const fullCmd = `${cmd} gateway run --bind ${bind} --port ${port} --force --allow-unconfigured`;

  const isWin = process.platform === "win32";
  const env = getEnvWithNpmBin();
  const shell = isWin ? "powershell.exe" : "/bin/bash";
  const shellArgs = isWin ? ["-NoProfile", "-Command", fullCmd] : ["-c", fullCmd];

  gateway.status = "starting";
  emitStatus();
  emitGateway(`> ${fullCmd}`);

  const child = spawn(shell, shellArgs, { env, cwd: workDir });
  gateway.child = child;
  gateway.pid = child.pid || null;

  child.stdout.on("data", (data) => emitGateway(data.toString()));
  child.stderr.on("data", (data) => emitGateway(data.toString()));

  child.on("spawn", () => {
    gateway.status = "running";
    gateway.startTime = Date.now();
    gateway.pid = child.pid;
    emitGateway(`[服务] 网关已启动 (PID: ${child.pid})`);
    emitStatus();
    // Performance optimization
    optimizeProcess(child.pid);
    // Start health monitoring
    startHealthCheck();
  });

  child.on("close", (code) => {
    const wasRunning = gateway.status === "running" || gateway.status === "starting";
    emitGateway(`[服务] 进程已退出 (code=${code})`);
    stopHealthCheck();

    if (gateway.child === child) {
      gateway.child = null;
      gateway.pid = null;
    }

    // Auto-restart logic (only if was running and not manually stopped)
    // Don't auto-restart on config errors (code=1 usually means a config/setup issue, not a transient crash)
    if (wasRunning && gateway.autoRestart && gateway.status !== "stopped" && code !== 1) {
      if (gateway.restartCount < gateway.maxRestarts) {
        gateway.restartCount++;
        const delay = Math.min(gateway.restartDelay * Math.pow(1.5, gateway.restartCount - 1), 30000);
        gateway.status = "starting";
        emitStatus();
        emitGateway(`[服务] ${delay / 1000}秒后自动重启... (第 ${gateway.restartCount} 次)`);
        setTimeout(() => {
          if (gateway.status === "starting") {
            spawnGateway();
          }
        }, delay);
        return;
      } else {
        emitGateway(`[服务] 已达最大重启次数 (${gateway.maxRestarts})，停止自动重启`);
      }
    }

    gateway.status = "stopped";
    emitStatus();
  });

  child.on("error", (err) => {
    emitGateway(`[服务] 启动失败: ${err.message}`);
    gateway.status = "error";
    gateway.child = null;
    gateway.pid = null;
    emitStatus();
  });
}

// IPC: Start gateway service
ipcMain.handle("gateway:start", async (_event, config) => {
  if (gateway.status === "running" || gateway.status === "starting") {
    return { ok: false, reason: "网关已在运行中" };
  }
  if (gateway.status === "suspended") {
    // Resume from suspend
    if (gateway.pid && resumeProcess(gateway.pid)) {
      gateway.status = "running";
      emitGateway("[服务] 网关已恢复运行");
      emitStatus();
      startHealthCheck();
      return { ok: true, pid: gateway.pid };
    }
  }
  // Fresh start
  gateway.config = config; // { cmd, cwd, port, bind }
  gateway.restartCount = 0;
  gateway.autoRestart = true;
  spawnGateway();
  return { ok: true, pid: gateway.pid };
});

// IPC: Stop gateway service
ipcMain.handle("gateway:stop", async () => {
  gateway.autoRestart = false;
  gateway.status = "stopped";
  stopHealthCheck();
  if (gateway.child) {
    try {
      // On Windows, kill the whole process tree
      if (process.platform === "win32" && gateway.pid) {
        execSync(`taskkill /pid ${gateway.pid} /T /F`, { timeout: 10000 });
      } else {
        gateway.child.kill("SIGTERM");
      }
    } catch { /* ignore */ }
    gateway.child = null;
    gateway.pid = null;
  }
  emitGateway("[服务] 网关已停止");
  emitStatus();
  return { ok: true };
});

// IPC: Suspend (pause) gateway service
ipcMain.handle("gateway:suspend", async () => {
  if (gateway.status !== "running" || !gateway.pid) {
    return { ok: false, reason: "网关未在运行" };
  }
  stopHealthCheck();
  if (suspendProcess(gateway.pid)) {
    gateway.status = "suspended";
    gateway.autoRestart = false;
    emitGateway("[服务] 网关已挂起");
    emitStatus();
    return { ok: true };
  }
  return { ok: false, reason: "挂起失败" };
});

// IPC: Resume gateway service
ipcMain.handle("gateway:resume", async () => {
  if (gateway.status !== "suspended" || !gateway.pid) {
    return { ok: false, reason: "网关未处于挂起状态" };
  }
  if (resumeProcess(gateway.pid)) {
    gateway.status = "running";
    gateway.autoRestart = true;
    emitGateway("[服务] 网关已恢复运行");
    emitStatus();
    startHealthCheck();
    return { ok: true };
  }
  return { ok: false, reason: "恢复失败" };
});

// IPC: Get gateway status
ipcMain.handle("gateway:getStatus", async () => {
  return getGatewayStatus();
});

// IPC: Pre-start system diagnostics
ipcMain.handle("gateway:systemCheck", async () => {
  const checks = [];
  const isWin = process.platform === "win32";
  const env = getEnvWithNpmBin();

  // 1. Node.js version
  try {
    const nodeVer = process.versions.node;
    const major = parseInt(nodeVer.split(".")[0], 10);
    checks.push({
      name: "Node.js 版本",
      status: major >= 22 ? "pass" : major >= 18 ? "warn" : "fail",
      detail: `v${nodeVer}` + (major < 22 ? " (建议 22+)" : ""),
    });
  } catch {
    checks.push({ name: "Node.js 版本", status: "fail", detail: "无法检测" });
  }

  // 2. Available memory
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const freeGB = (freeMem / 1073741824).toFixed(1);
    const totalGB = (totalMem / 1073741824).toFixed(1);
    checks.push({
      name: "系统内存",
      status: freeMem > 2 * 1073741824 ? "pass" : freeMem > 1073741824 ? "warn" : "fail",
      detail: `可用 ${freeGB} GB / 总共 ${totalGB} GB`,
    });
  } catch {
    checks.push({ name: "系统内存", status: "warn", detail: "无法检测" });
  }

  // 3. CPU cores
  try {
    const cpus = os.cpus();
    checks.push({
      name: "CPU 核心数",
      status: cpus.length >= 4 ? "pass" : cpus.length >= 2 ? "warn" : "fail",
      detail: `${cpus.length} 核 (${cpus[0]?.model || "unknown"})`,
    });
  } catch {
    checks.push({ name: "CPU 核心数", status: "warn", detail: "无法检测" });
  }

  // 4. Port availability
  try {
    const port = 18789;
    const available = await new Promise((resolve) => {
      const net = require("net");
      const server = net.createServer();
      server.listen(port, "127.0.0.1", () => { server.close(() => resolve(true)); });
      server.on("error", () => resolve(false));
    });
    checks.push({
      name: `端口 ${port}`,
      status: available ? "pass" : "warn",
      detail: available ? "可用" : "已被占用 (将使用 --force 覆盖)",
    });
  } catch {
    checks.push({ name: "端口 18789", status: "warn", detail: "无法检测" });
  }

  // 5. Disk space (Windows)
  if (isWin) {
    try {
      const diskInfo = execSync(
        'powershell.exe -NoProfile -Command "(Get-PSDrive C).Free"',
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      const freeBytes = parseInt(diskInfo, 10);
      const freeGB = (freeBytes / 1073741824).toFixed(1);
      checks.push({
        name: "磁盘空间 (C:)",
        status: freeBytes > 5 * 1073741824 ? "pass" : freeBytes > 1073741824 ? "warn" : "fail",
        detail: `可用 ${freeGB} GB`,
      });
    } catch {
      checks.push({ name: "磁盘空间", status: "warn", detail: "无法检测" });
    }
  }

  // 6. OpenClaw installation
  try {
    const ocResult = await resolveOpenClawPath();
    if (ocResult) {
      checks.push({
        name: "OpenClaw 安装",
        status: "pass",
        detail: `${ocResult.source} (${ocResult.cmd})`,
      });
    } else {
      checks.push({ name: "OpenClaw 安装", status: "fail", detail: "未找到 openclaw" });
    }
  } catch {
    checks.push({ name: "OpenClaw 安装", status: "warn", detail: "无法检测" });
  }

  // 7. Network connectivity (try multiple domains for China/global reach)
  try {
    const dns = require("dns");
    const tryResolve = (host) => new Promise((resolve, reject) => {
      dns.resolve(host, (err) => err ? reject(err) : resolve(host));
    });
    const host = await Promise.any([
      tryResolve("www.baidu.com"),
      tryResolve("dns.alidns.com"),
      tryResolve("one.one.one.one"),
    ]).catch(() => null);
    if (host) {
      checks.push({ name: "网络连接", status: "pass", detail: `DNS 解析正常 (${host})` });
    } else {
      checks.push({ name: "网络连接", status: "warn", detail: "DNS 解析失败 (可能需要代理)" });
    }
  } catch {
    checks.push({ name: "网络连接", status: "warn", detail: "DNS 解析失败 (可能需要代理)" });
  }

  return checks;
});

// Clipboard copy
ipcMain.handle("clipboard:copy", async (_event, text) => {
  clipboard.writeText(text);
  return { ok: true };
});

// Legacy shell:spawn — redirect to gateway:start for backward compatibility
ipcMain.handle("shell:spawn", async (_event, options) => {
  const { command, cwd: optCwd } = typeof options === "string" ? { command: options, cwd: undefined } : options;
  const isWin = process.platform === "win32";
  const env = getEnvWithNpmBin();
  const workDir = optCwd || (isWin ? process.env.USERPROFILE : process.env.HOME);
  const shell = isWin ? "powershell.exe" : "/bin/bash";
  const shellArgs = isWin ? ["-NoProfile", "-Command", command] : ["-c", command];
  const child = spawn(shell, shellArgs, { env, cwd: workDir });
  child.stdout.on("data", (d) => mainWindow?.webContents.send("gateway:output", d.toString()));
  child.stderr.on("data", (d) => mainWindow?.webContents.send("gateway:output", d.toString()));
  return { pid: child.pid || 0 };
});

// Open a new terminal window with a command
ipcMain.handle("shell:openTerminal", async (_event, command) => {
  const isWin = process.platform === "win32";
  const env = getEnvWithNpmBin();
  if (isWin) {
    // Open a new PowerShell window (pnpm works better in PowerShell than cmd.exe)
    spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process powershell -ArgumentList '-NoExit','-NoProfile','-Command','${command.replace(/'/g, "''")}'`], {
      env, detached: true, stdio: "ignore",
    }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", ["-a", "Terminal", command], { env, detached: true, stdio: "ignore" }).unref();
  } else {
    const term = ["x-terminal-emulator", "gnome-terminal", "xterm"];
    for (const t of term) {
      try {
        spawn(t, ["-e", command], { env, detached: true, stdio: "ignore" }).unref();
        break;
      } catch { /* try next */ }
    }
  }
  return { ok: true };
});

// Persist openclaw bin dir in both User and System PATH
// If customPath is provided, also adds the custom prefix's bin dir
ipcMain.handle("shell:addToPath", async (_event, customPath) => {
  const isWin = process.platform === "win32";
  const { execSync } = require("child_process");

  // Collect all dirs that need to be in PATH
  const dirsToAdd = new Set();
  // 1. npm global prefix bin
  const npmPrefix = getNpmGlobalPrefix();
  dirsToAdd.add(isWin ? npmPrefix : path.join(npmPrefix, "bin"));
  // 2. Custom install path bin (--prefix installs put bins in node_modules/.bin)
  if (customPath) {
    const customBin = path.join(customPath, "node_modules", ".bin");
    if (fs.existsSync(customBin)) dirsToAdd.add(customBin);
    dirsToAdd.add(customPath);
  }

  const results = [];

  if (isWin) {
    // ─── Write to User PATH ───
    for (const binDir of dirsToAdd) {
      try {
        const userPath = execSync(
          `powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('PATH', 'User')"`,
          { encoding: "utf-8", timeout: 10000 }
        ).trim();
        if (!userPath.split(";").some((p) => p.replace(/[\\/]+$/, "").toLowerCase() === binDir.toLowerCase())) {
          const newPath = userPath ? `${userPath};${binDir}` : binDir;
          execSync(
            `powershell.exe -NoProfile -Command "[Environment]::SetEnvironmentVariable('PATH', '${newPath.replace(/'/g, "''")}', 'User')"`,
            { timeout: 10000 }
          );
          process.env.PATH = `${binDir};${process.env.PATH}`;
          results.push({ scope: "user", dir: binDir, added: true });
        } else {
          results.push({ scope: "user", dir: binDir, added: false });
        }
      } catch (e) {
        results.push({ scope: "user", dir: binDir, added: false, error: e.message });
      }
    }

    // ─── Write to System PATH (needs admin, may fail gracefully) ───
    for (const binDir of dirsToAdd) {
      try {
        const sysPath = execSync(
          `powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('PATH', 'Machine')"`,
          { encoding: "utf-8", timeout: 10000 }
        ).trim();
        if (!sysPath.split(";").some((p) => p.replace(/[\\/]+$/, "").toLowerCase() === binDir.toLowerCase())) {
          // Use PowerShell Start-Process -Verb RunAs for elevation
          execSync(
            `powershell.exe -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command',\\"[Environment]::SetEnvironmentVariable(''PATH'', ''${sysPath};${binDir}'', ''Machine'')\\" " `,
            { timeout: 30000 }
          );
          results.push({ scope: "system", dir: binDir, added: true });
        } else {
          results.push({ scope: "system", dir: binDir, added: false });
        }
      } catch (e) {
        results.push({ scope: "system", dir: binDir, added: false, error: e.message });
      }
    }
  } else {
    // ─── Unix: append to ~/.profile ───
    const profilePath = path.join(process.env.HOME, ".profile");
    for (const binDir of dirsToAdd) {
      try {
        const content = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, "utf-8") : "";
        if (!content.includes(binDir)) {
          fs.appendFileSync(profilePath, `\nexport PATH="${binDir}:$PATH"\n`);
          process.env.PATH = `${binDir}:${process.env.PATH}`;
          results.push({ scope: "user", dir: binDir, added: true });
        } else {
          results.push({ scope: "user", dir: binDir, added: false });
        }
      } catch (e) {
        results.push({ scope: "user", dir: binDir, added: false, error: e.message });
      }
    }
  }

  return { results };
});

// Check if a command exists
ipcMain.handle("shell:which", async (_event, cmd) => {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const checkCmd = isWin ? `Get-Command ${cmd} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source` : `which ${cmd}`;
    const shell = isWin ? "powershell.exe" : "/bin/bash";
    const shellArgs = isWin ? ["-NoProfile", "-Command", checkCmd] : ["-c", checkCmd];

    const child = spawn(shell, shellArgs, { env: getEnvWithNpmBin() });
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.on("close", (code) => resolve(code === 0 ? output.trim() : null));
    child.on("error", () => resolve(null));
  });
});

// Resolve how to invoke openclaw: global binary, npx, or pnpm workspace
// Returns { cmd: "<prefix>", cwd: "<dir>" } — caller runs `${cmd} gateway run ...`
let _resolvedOpenClaw = null;
async function resolveOpenClawPath() {
  if (_resolvedOpenClaw) return _resolvedOpenClaw;

  const { execSync } = require("child_process");
  const env = getEnvWithNpmBin();
  const isWin = process.platform === "win32";
  const home = process.env.HOME || process.env.USERPROFILE;

  // 1. Try global openclaw
  try {
    const whichCmd = isWin
      ? 'powershell.exe -NoProfile -Command "Get-Command openclaw -ErrorAction Stop | Select-Object -ExpandProperty Source"'
      : "which openclaw";
    const globalPath = execSync(whichCmd, { env, encoding: "utf-8", timeout: 10000 }).trim();
    if (globalPath) {
      _resolvedOpenClaw = { cmd: "openclaw", cwd: home, source: "global", path: globalPath };
      return _resolvedOpenClaw;
    }
  } catch { /* not global */ }

  // 2. Try well-known workspace locations with npx/pnpm
  const candidateDirs = [
    path.join(home, "Desktop", "openclaw-win"),
    path.join(home, "Desktop", "openclaw"),
    path.join(home, "openclaw"),
    path.join(home, "projects", "openclaw"),
  ];
  for (const dir of candidateDirs) {
    const pkgPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.name === "openclaw" || pkg.name === "@openclaw/cli") {
        // Check if pnpm is available (preferred for workspace)
        const hasPnpmLock = fs.existsSync(path.join(dir, "pnpm-lock.yaml"));
        if (hasPnpmLock) {
          _resolvedOpenClaw = { cmd: "pnpm openclaw", cwd: dir, source: "pnpm-workspace", path: dir };
        } else {
          _resolvedOpenClaw = { cmd: "npx openclaw", cwd: dir, source: "npx-workspace", path: dir };
        }
        return _resolvedOpenClaw;
      }
    } catch { /* skip */ }
  }

  // 3. Try npx openclaw (downloads if needed)
  _resolvedOpenClaw = { cmd: "npx openclaw", cwd: home, source: "npx-remote", path: null };
  return _resolvedOpenClaw;
}
ipcMain.handle("shell:resolveOpenClaw", () => resolveOpenClawPath());

// Get system info
ipcMain.handle("system:info", async () => {
  return {
    platform: process.platform,
    arch: process.arch,
    home: process.env.HOME || process.env.USERPROFILE,
    nodeVersion: process.versions.node,
  };
});

// Resolve the openclaw state directory
function getStateDir() {
  return (
    process.env.OPENCLAW_STATE_DIR ||
    path.join(process.env.HOME || process.env.USERPROFILE, ".openclaw")
  );
}

// List all agents under ~/.openclaw/agents/
ipcMain.handle("agents:list", async () => {
  const stateDir = getStateDir();
  const agentsDir = path.join(stateDir, "agents");
  const workspaceDir = path.join(stateDir, "workspace");
  const skillsDir = path.join(stateDir, "skills");
  const configPath = path.join(stateDir, "openclaw.json");

  const agents = [];

  // Enumerate agent sub-directories
  if (fs.existsSync(agentsDir)) {
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const agentId = entry.name;
      const agentPath = path.join(agentsDir, agentId);
      const agentSubDir = path.join(agentPath, "agent");
      const sessionsDir = path.join(agentPath, "sessions");

      // Count sessions
      let sessionCount = 0;
      if (fs.existsSync(sessionsDir)) {
        sessionCount = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl")).length;
      }

      // Check for agent config files
      const hasAuthProfiles = fs.existsSync(path.join(agentSubDir, "auth-profiles.json"));
      const hasModels = fs.existsSync(path.join(agentSubDir, "models.json"));

      agents.push({
        id: agentId,
        path: agentPath,
        sessionCount,
        hasAuthProfiles,
        hasModels,
      });
    }
  }

  // Check workspace for memory files
  const workspaceFiles = [];
  if (fs.existsSync(workspaceDir)) {
    const memoryFiles = ["MEMORY.md", "memory.md", "AGENTS.md", "SOUL.md", "USER.md", "IDENTITY.md", "TOOLS.md"];
    for (const mf of memoryFiles) {
      if (fs.existsSync(path.join(workspaceDir, mf))) {
        workspaceFiles.push(mf);
      }
    }
    // Check memory/ subdir
    const memDir = path.join(workspaceDir, "memory");
    if (fs.existsSync(memDir)) {
      const memEntries = fs.readdirSync(memDir).filter((f) => f.endsWith(".md"));
      workspaceFiles.push(...memEntries.map((f) => `memory/${f}`));
    }
  }

  // Check user-level skills
  const userSkills = [];
  if (fs.existsSync(skillsDir)) {
    const skillEntries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const se of skillEntries) {
      if (se.isDirectory() && fs.existsSync(path.join(skillsDir, se.name, "SKILL.md"))) {
        userSkills.push(se.name);
      }
    }
  }

  return {
    stateDir,
    agents,
    workspaceFiles,
    userSkills,
    hasConfig: fs.existsSync(configPath),
    hasCredentials: fs.existsSync(path.join(stateDir, "credentials")),
  };
});

// Export selected agents + workspace + skills to a zip file
ipcMain.handle("agents:export", async (_event, { agentIds, includeWorkspace, includeSkills, includeConfig, outputPath }) => {
  const stateDir = getStateDir();

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve({ size: archive.pointer() }));
    archive.on("error", (err) => reject(err));
    archive.pipe(output);

    // Add agent directories
    for (const agentId of agentIds) {
      const agentPath = path.join(stateDir, "agents", agentId);
      if (fs.existsSync(agentPath)) {
        archive.directory(agentPath, `agents/${agentId}`);
      }
    }

    // Add workspace memory files
    if (includeWorkspace) {
      const workspaceDir = path.join(stateDir, "workspace");
      if (fs.existsSync(workspaceDir)) {
        const topFiles = ["MEMORY.md", "memory.md", "AGENTS.md", "SOUL.md", "USER.md", "IDENTITY.md", "TOOLS.md", "HEARTBEAT.md", "BOOTSTRAP.md"];
        for (const f of topFiles) {
          const fp = path.join(workspaceDir, f);
          if (fs.existsSync(fp)) {
            archive.file(fp, { name: `workspace/${f}` });
          }
        }
        const memDir = path.join(workspaceDir, "memory");
        if (fs.existsSync(memDir)) {
          archive.directory(memDir, "workspace/memory");
        }
        // Workspace-level skills
        const wsSkillsDir = path.join(workspaceDir, "skills");
        if (fs.existsSync(wsSkillsDir)) {
          archive.directory(wsSkillsDir, "workspace/skills");
        }
      }
    }

    // Add user-level skills
    if (includeSkills) {
      const skillsDir = path.join(stateDir, "skills");
      if (fs.existsSync(skillsDir)) {
        archive.directory(skillsDir, "skills");
      }
    }

    // Add config + credentials
    if (includeConfig) {
      const configPath = path.join(stateDir, "openclaw.json");
      if (fs.existsSync(configPath)) {
        archive.file(configPath, { name: "config/openclaw.json" });
      }
      const secretsPath = path.join(stateDir, "secrets.json");
      if (fs.existsSync(secretsPath)) {
        archive.file(secretsPath, { name: "config/secrets.json" });
      }
      const credsDir = path.join(stateDir, "credentials");
      if (fs.existsSync(credsDir)) {
        archive.directory(credsDir, "config/credentials");
      }
    }

    archive.finalize();
  });
});

// Show save dialog for choosing export zip path
ipcMain.handle("dialog:save", async (_event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options.title || "保存文件",
    defaultPath: options.defaultPath || "openclaw-backup.zip",
    filters: options.filters || [{ name: "ZIP 压缩包", extensions: ["zip"] }],
  });
  return result.canceled ? null : result.filePath;
});

// Show open dialog for choosing a folder
ipcMain.handle("dialog:openFolder", async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title || "选择文件夹",
    defaultPath: options.defaultPath,
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

// ─── Database IPC ───────────────────────────────────────────────────────────

// VIP
ipcMain.handle("db:vip:get", () => database.getVipState());
ipcMain.handle("db:vip:activate", (_event, { months, outTradeNo, amount }) =>
  database.activateVip(months, outTradeNo, amount)
);
ipcMain.handle("db:vip:reset", () => database.resetVip());

// Config (key-value)
ipcMain.handle("db:config:get", (_event, key) => database.getConfig(key));
ipcMain.handle("db:config:set", (_event, { key, value }) => database.setConfig(key, value));
ipcMain.handle("db:config:delete", (_event, key) => database.deleteConfig(key));
ipcMain.handle("db:config:getAll", () => database.getAllConfig());

// Orders
ipcMain.handle("db:order:save", (_event, { outTradeNo, amount, description }) =>
  database.saveOrder(outTradeNo, amount, description)
);
ipcMain.handle("db:order:updateStatus", (_event, { outTradeNo, status }) =>
  database.updateOrderStatus(outTradeNo, status)
);
ipcMain.handle("db:order:get", (_event, outTradeNo) => database.getOrder(outTradeNo));

// DB path (for debug)
ipcMain.handle("db:getPath", () => database.getDbPath());

// ─── Local banben.json config ────────────────────────────────────────────────
// Returns config from bundled assets/banben.json with version injected from package.json
ipcMain.handle("config:readLocal", () => {
  try {
    const banbenPath = path.join(__dirname, "..", "assets", "banben.json");
    const raw = fs.readFileSync(banbenPath, "utf8");
    const data = JSON.parse(raw);
    // Always use the real app version (from package.json) so version display is accurate
    data.version = app.getVersion();
    return data;
  } catch (err) {
    logDebug(`config:readLocal failed: ${err}`);
    return null;
  }
});

// ─── WeChat Pay IPC ─────────────────────────────────────────────────────────

// Create a Native Pay order (returns QR URL + trade number)
ipcMain.handle("pay:createOrder", async (_event, { amount, description }) => {
  try {
    const result = await wechatPay.createNativeOrder(amount, description);
    // Save order to local DB
    try { database.saveOrder(result.out_trade_no, amount, description); } catch {}
    return { success: true, data: result };
  } catch (err) {
    return { success: false, message: err.message || "创建订单失败" };
  }
});

// Query order payment status
ipcMain.handle("pay:checkStatus", async (_event, outTradeNo) => {
  try {
    const result = await wechatPay.queryOrderStatus(outTradeNo);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, message: err.message || "查询失败" };
  }
});

// ─── App Version & Auto-Update ───────────────────────────────────────────────

const VERSIONS_HTML_URL = "https://www.hunyuandata.cn/openclaw-versions.html";
const VERSION_JSON_URL  = "https://www.hunyuandata.cn/openclaw-version.json";

// Simple semver compare: returns 1 if a > b, -1 if a < b, 0 if equal
function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

// Fetch a URL with redirect support, returns { status, body }
function httpGetText(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const https = require("https");
    const http  = require("http");
    const client = url.startsWith("https://") ? https : http;
    const req = client.get(url, { timeout }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(httpGetText(res.headers.location, timeout));
      }
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

// Fetch the latest version info from hunyuandata.cn
// Tries JSON endpoint first, then parses the HTML versions page
async function fetchLatestVersionInfo() {
  // 1. Try machine-readable JSON
  try {
    const { status, body } = await httpGetText(VERSION_JSON_URL);
    if (status === 200) {
      const data = JSON.parse(body);
      if (data && data.version) return data;
    }
  } catch { /* fall through */ }

  // 2. Parse the HTML versions page — look for embedded JSON blob
  try {
    const { status, body } = await httpGetText(VERSIONS_HTML_URL);
    if (status === 200) {
      // <script id="version-data" type="application/json">{ ... }</script>
      const m = body.match(/<script[^>]+id=["']version-data["'][^>]*>([\s\S]*?)<\/script>/i);
      if (m) return JSON.parse(m[1].trim());
      // fallback: first semver-like string in the page
      const vm = body.match(/\b(\d+\.\d+\.\d+)\b/);
      if (vm) return { version: vm[1] };
    }
  } catch { /* fall through */ }

  return null;
}

ipcMain.handle("app:getVersion", () => app.getVersion());

ipcMain.handle("app:checkUpdate", async () => {
  try {
    const current = app.getVersion();
    const info = await fetchLatestVersionInfo();
    if (!info) return { ok: false, error: "无法获取版本信息，请检查网络连接" };

    const hasUpdate = compareVersions(info.version, current) > 0;
    return {
      ok: true,
      current,
      latest: info.version,
      hasUpdate,
      downloadUrl: info.downloadUrl || null,
      releaseNotes: info.releaseNotes || info.changelog || "",
      releaseDate:  info.releaseDate  || "",
      versionsUrl:  VERSIONS_HTML_URL,
    };
  } catch (err) {
    logDebug(`app:checkUpdate error: ${err}`);
    return { ok: false, error: err.message };
  }
});

// Download a zip from downloadUrl and extract it over the app resource directory.
// Progress events are sent as update:progress to the renderer.
ipcMain.handle("app:downloadUpdate", async (_event, downloadUrl) => {
  if (!downloadUrl) return { ok: false, error: "未提供下载地址" };

  const https = require("https");
  const http  = require("http");
  const tempZip = path.join(app.getPath("temp"), `openclaw-update-${Date.now()}.zip`);

  try {
    // ── Download ──────────────────────────────────────────────────────────
    await new Promise((resolve, reject) => {
      const client = downloadUrl.startsWith("https://") ? https : http;
      const file = fs.createWriteStream(tempZip);
      const req = client.get(downloadUrl, { timeout: 180000 }, (res) => {
        if (res.statusCode !== 200) {
          file.close(() => fs.unlink(tempZip, () => {}));
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          file.write(chunk);
          mainWindow?.webContents.send("update:progress", {
            downloaded, total,
            pct: total > 0 ? Math.round((downloaded / total) * 100) : -1,
          });
        });
        res.on("end", () => { file.end(); resolve(); });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("下载超时")); });
    });

    // ── Extract over app resource directory ───────────────────────────────
    // __dirname is electron/ — one level up is the app resource root (dist, electron, assets)
    const resourcesDir = path.join(__dirname, "..");
    await extractZip(tempZip, resourcesDir);

    return { ok: true };
  } catch (err) {
    logDebug(`app:downloadUpdate error: ${err}`);
    return { ok: false, error: err.message };
  } finally {
    try { fs.unlinkSync(tempZip); } catch {}
  }
});

ipcMain.handle("app:restartApp", () => {
  app.relaunch();
  app.exit(0);
});

// Open the versions page in the system browser
ipcMain.handle("app:openVersionsPage", () => {
  shell.openExternal(VERSIONS_HTML_URL);
  return { ok: true };
});

// ─── OpenClaw CLI Self-Update ────────────────────────────────────────────────

const OC_VERSIONS_URL = "https://www.hunyuandata.cn/openclaw-versions.html";
const OC_LATEST_ZIP   = "https://www.hunyuandata.cn/openclaw/latest/openclaw-latest-source.zip";

// Extract the latest openclaw version from the versions HTML page.
// Strategy: collect ALL version strings from source-zip download links (these
// are always in raw HTML as href attrs) then pick the highest by semver.
// Falls back to following the /latest/ redirect and parsing the redirect URL.
async function fetchOcLatestVersion() {
  try {
    // ── primary: scrape every versioned source-zip href and return the max ──
    const { status, body } = await httpGetText(OC_VERSIONS_URL, 15000);
    if (status === 200) {
      // matches: openclaw-2026.4.5-source.zip  OR  /2026.4.5/openclaw-...
      const re = /openclaw[/-]([\d]+\.[\d]+\.[\d]+(?:-[.\w]+)?)-source\.zip/g;
      const versions = [];
      let m;
      while ((m = re.exec(body)) !== null) versions.push(m[1]);
      // also try the /YYYY.M.D/ path segment style inside hrefs
      const re2 = /\/openclaw\/([\d]+\.[\d]+\.[\d]+(?:-[.\w]+)?)\//g;
      while ((m = re2.exec(body)) !== null) versions.push(m[1]);
      if (versions.length > 0) {
        // drop pre-release tags for comparison (keep originals); pick max stable first
        const stable = versions.filter((v) => !v.includes("-"));
        const pool = stable.length > 0 ? stable : versions;
        pool.sort((a, b) => compareVersions(b, a)); // descending
        return pool[0];
      }
    }

    // ── fallback: HEAD the /latest/ redirect, parse version from redirect URL ──
    const https = require("https");
    const latestVer = await new Promise((resolve) => {
      const req = https.request(
        new URL(OC_LATEST_ZIP),
        { method: "HEAD", timeout: 10000 },
        (res) => {
          const loc = res.headers.location || "";
          const fm = loc.match(/openclaw[/-]([\d]+\.[\d]+\.[\d]+(?:-[.\w]+)?)-source\.zip/);
          resolve(fm ? fm[1] : null);
          res.resume();
        }
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => { req.destroy(); resolve(null); });
      req.end();
    });
    return latestVer;
  } catch (err) {
    logDebug(`fetchOcLatestVersion error: ${err}`);
    return null;
  }
}

// Get the currently installed openclaw version string (e.g. "2026.3.13")
function getInstalledOcVersion() {
  try {
    const env = getSandboxEnv();
    const raw = execSync("openclaw --version", { encoding: "utf-8", timeout: 10000, env }).trim();
    // "2026.3.13 (61d171a)" → "2026.3.13"
    return raw.split(/\s+/)[0] || raw;
  } catch {
    return null;
  }
}

// Check if openclaw needs an update; returns { current, latest, hasUpdate }
ipcMain.handle("openclaw:checkUpdate", async () => {
  const info = await fetchOcLatestVersion(); // { version, url } or null
  const current = getInstalledOcVersion();
  if (!info) return { ok: false, error: "无法获取最新版本信息" };
  const hasUpdate = current ? compareVersions(info.version, current) > 0 : true;
  return { ok: true, current: current || "未安装", latest: info.version, hasUpdate };
});

// Detect the installed openclaw package directory (returns null if not found)
function findInstalledOcDir() {
  const sandboxPaths = getSandboxPaths();
  // 1. Sandbox global dir (preferred)
  const sandboxOcDir = path.join(sandboxPaths.globalDir, "node_modules", "openclaw");
  if (fs.existsSync(path.join(sandboxOcDir, "package.json"))) {
    return { dir: sandboxOcDir, type: "sandbox", npmExe: sandboxPaths.npmCmd, nodeExe: sandboxPaths.nodeExe };
  }
  // 2. System npm global prefix
  try {
    const prefix = execSync("npm config get prefix", { encoding: "utf-8", timeout: 8000, env: getSandboxEnv() }).trim();
    if (prefix) {
      const sysOcDir = path.join(prefix, "node_modules", "openclaw");
      if (fs.existsSync(path.join(sysOcDir, "package.json"))) {
        return { dir: sysOcDir, type: "system", npmExe: process.platform === "win32" ? "npm.cmd" : "npm", nodeExe: "node" };
      }
    }
  } catch {}
  return null;
}

// Install / update openclaw CLI from the latest source zip.
// Strategy: resolve versioned URL → download zip → extract → overwrite source + npm install + npm run build
// Progress is reported as "__PCT__:N:label" tokens the renderer can parse for the bar.
ipcMain.handle("openclaw:install", async () => {
  const emit = (msg) => mainWindow?.webContents.send("openclaw:updateOutput", msg);
  const pct  = (n, label) => mainWindow?.webContents.send("openclaw:updateOutput", `__PCT__:${n}:${label}`);

  const tempDir    = path.join(app.getPath("temp"), `oc-update-${Date.now()}`);
  const zipPath    = path.join(tempDir, "openclaw-latest.zip");
  const extractDir = path.join(tempDir, "extracted");

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    // ── 0. Resolve the versioned download URL ────────────────────────────
    pct(1, "获取最新版本...");
    emit("正在获取最新版本信息...");
    const info = await fetchOcLatestVersion();
    const zipUrl = info?.url || OC_LATEST_ZIP;
    if (info?.version) emit(`检测到最新版本: ${info.version}，来源: ${zipUrl}`);
    else emit(`使用默认下载地址: ${zipUrl}`);

    // ── 1. Download zip ──────────────────────────────────────────────────
    pct(2, "准备下载...");
    emit("正在下载最新源码包...");
    let lastDlPct = -1;
    await downloadFileWithProgress(zipUrl, zipPath, (downloaded, total) => {
      if (total > 0) {
        const dp = Math.round((downloaded / total) * 100);
        const barVal = Math.round(dp * 0.38); // 0-100% download → 2-40% bar
        if (dp !== lastDlPct && dp % 5 === 0) {
          lastDlPct = dp;
          pct(barVal, `下载 ${dp}%`);
          emit(`下载 ${dp}%  (${(downloaded / 1048576).toFixed(1)}MB / ${(total / 1048576).toFixed(1)}MB)`);
        }
      }
    });

    // ── 2. Extract zip (worker thread — keeps event loop free) ──────────
    pct(42, "解压中...");
    emit("下载完成，正在解压...");
    let extractPct = 42;
    const extractHb = setInterval(() => {
      if (extractPct < 49) { extractPct++; pct(extractPct, "解压中..."); }
    }, 3000);
    await extractZip(zipPath, extractDir);
    clearInterval(extractHb);
    pct(50, "解压完成");
    emit("解压完成");

    // ── 3. Find package.json root (zip may have one top-level subdir) ────
    pct(52, "查找包目录...");
    emit("解压完成，正在查找包目录...");
    let pkgDir = extractDir;
    const findPkgDir = (dir, depth = 0) => {
      if (fs.existsSync(path.join(dir, "package.json"))) return dir;
      if (depth >= 2) return null;
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) {
          const found = findPkgDir(full, depth + 1);
          if (found) return found;
        }
      }
      return null;
    };
    const found = findPkgDir(extractDir);
    if (!found) throw new Error("解压后未找到 package.json，zip 结构异常");
    pkgDir = found;
    emit(`包目录: ${path.basename(pkgDir)}`);

    // ── 4. Overwrite installed openclaw source files directly ────────────
    // Find where openclaw is already installed (sandbox or system npm global)
    const ocLocation = findInstalledOcDir();

    if (ocLocation) {
      // ── Fast path: directly copy new source → installed dir ─────────────
      pct(56, "覆盖源码文件...");
      emit(`覆盖安装到: ${ocLocation.dir}`);

      // Copy all new source files except node_modules
      const entries = fs.readdirSync(pkgDir);
      for (const entry of entries) {
        if (entry === "node_modules") continue;
        const src = path.join(pkgDir, entry);
        const dst = path.join(ocLocation.dir, entry);
        fs.cpSync(src, dst, { recursive: true, force: true });
      }
      pct(65, "依赖更新中...");
      emit("源码覆盖完成，正在更新依赖...");

      // Run npm install (no -g) in-place to install any new dependencies
      const sandboxPaths = getSandboxPaths();
      const usesSandbox  = fs.existsSync(sandboxPaths.npmCmd);
      const cleanEnv = { ...process.env };
      for (const key of Object.keys(cleanEnv)) {
        if (/^npm_config_/i.test(key) || /^npm_package_/i.test(key)) delete cleanEnv[key];
      }
      let npmExe, spawnEnv;
      if (usesSandbox) {
        const profile = await detectMirrorProfile();
        const npmRegistry = profile.region === "cn"
          ? "https://mirrors.cloud.tencent.com/npm/"
          : "https://registry.npmjs.org/";
        npmExe = sandboxPaths.npmCmd;
        spawnEnv = {
          ...cleanEnv,
          PATH: `${path.dirname(sandboxPaths.nodeExe)};${process.env.PATH}`,
          npm_config_registry: npmRegistry,
          npm_config_cache: path.join(sandboxPaths.base, "npm-cache"),
        };
      } else {
        npmExe = process.platform === "win32" ? "npm.cmd" : "npm";
        spawnEnv = { ...cleanEnv };
      }

      let depBarPct = 65;
      const depHb = setInterval(() => {
        if (depBarPct < 92) { depBarPct++; pct(depBarPct, "依赖更新中..."); }
      }, 3000);

      const [spawnExe, spawnArgs] = process.platform === "win32"
        ? ["cmd.exe", ["/c", npmExe, "install", "--no-audit", "--no-fund"]]
        : [npmExe, ["install", "--no-audit", "--no-fund"]];

      const exitCode = await new Promise((resolve) => {
        const child = spawn(spawnExe, spawnArgs, { env: spawnEnv, cwd: ocLocation.dir, shell: false });
        child.stdout.on("data", (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => emit(l)));
        child.stderr.on("data", (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => emit(l)));
        child.on("close", resolve);
        child.on("error", (err) => { emit(`错误: ${err.message}`); resolve(-1); });
      });
      clearInterval(depHb);

      if (exitCode !== 0) {
        return { ok: false, error: `依赖安装失败，退出码: ${exitCode}` };
      }

      // ── Run npm run build to rebuild openclaw's WebUI ────────────────────
      // Check if a build script exists before attempting
      let hasBuildScript = false;
      try {
        const pkgJson = JSON.parse(fs.readFileSync(path.join(ocLocation.dir, "package.json"), "utf8"));
        hasBuildScript = !!(pkgJson.scripts && pkgJson.scripts.build);
      } catch {}

      if (hasBuildScript) {
        pct(92, "构建 WebUI...");
        emit("正在重新构建 WebUI，请稍候...");
        let buildPct = 92;
        const buildHb = setInterval(() => {
          if (buildPct < 97) { buildPct++; pct(buildPct, "构建 WebUI..."); }
        }, 3000);

        const [buildExe, buildArgs] = process.platform === "win32"
          ? ["cmd.exe", ["/c", npmExe, "run", "build"]]
          : [npmExe, ["run", "build"]];

        const buildCode = await new Promise((resolve) => {
          const child = spawn(buildExe, buildArgs, { env: spawnEnv, cwd: ocLocation.dir, shell: false });
          child.stdout.on("data", (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => emit(l)));
          child.stderr.on("data", (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => emit(l)));
          child.on("close", resolve);
          child.on("error", (err) => { emit(`构建警告: ${err.message}`); resolve(0); });
        });
        clearInterval(buildHb);

        if (buildCode !== 0) {
          emit(`⚠️  WebUI 构建退出码 ${buildCode}，更新仍继续`);
        } else {
          emit("✅ WebUI 构建完成");
        }
      }
    } else {
      // ── Fallback: fresh npm install -g (first install or undetectable location) ─
      pct(56, "全量安装中...");
      emit("未找到现有安装，执行全量安装...");

      const sandboxPaths = getSandboxPaths();
      const usesSandbox  = fs.existsSync(sandboxPaths.npmCmd);
      const cleanEnv = { ...process.env };
      for (const key of Object.keys(cleanEnv)) {
        if (/^npm_config_/i.test(key) || /^npm_package_/i.test(key)) delete cleanEnv[key];
      }
      let npmExe, spawnEnv;
      if (usesSandbox) {
        const profile = await detectMirrorProfile();
        const npmRegistry = profile.region === "cn"
          ? "https://mirrors.cloud.tencent.com/npm/"
          : "https://registry.npmjs.org/";
        npmExe = sandboxPaths.npmCmd;
        spawnEnv = {
          ...cleanEnv,
          PATH: `${path.dirname(sandboxPaths.nodeExe)};${process.env.PATH}`,
          npm_config_prefix: sandboxPaths.globalDir,
          npm_config_registry: npmRegistry,
          npm_config_cache: path.join(sandboxPaths.base, "npm-cache"),
        };
      } else {
        npmExe = process.platform === "win32" ? "npm.cmd" : "npm";
        spawnEnv = { ...cleanEnv };
      }

      let npmBarPct = 56;
      const heartbeat = setInterval(() => {
        if (npmBarPct < 92) { npmBarPct++; pct(npmBarPct, "全量安装中..."); }
      }, 4000);

      const [spawnExe, spawnArgs] = process.platform === "win32"
        ? ["cmd.exe", ["/c", npmExe, "install", "-g", pkgDir]]
        : [npmExe, ["install", "-g", pkgDir]];

      const exitCode = await new Promise((resolve) => {
        const child = spawn(spawnExe, spawnArgs, { env: spawnEnv, cwd: pkgDir, shell: false });
        child.stdout.on("data", (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => emit(l)));
        child.stderr.on("data", (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => emit(l)));
        child.on("close", resolve);
        child.on("error", (err) => { emit(`错误: ${err.message}`); resolve(-1); });
      });
      clearInterval(heartbeat);

      if (exitCode !== 0) {
        return { ok: false, error: `安装失败，退出码: ${exitCode}` };
      }
    }

    pct(98, "完成");
    // Read version from the installed package.json — more reliable than running
    // openclaw --version which may point to a stale binary or cached path.
    let newVersion = null;
    try {
      const ocLoc = findInstalledOcDir();
      if (ocLoc) {
        const pkg = JSON.parse(fs.readFileSync(path.join(ocLoc.dir, "package.json"), "utf8"));
        newVersion = pkg.version || null;
      }
    } catch {}
    // Fallback: use the version we scraped when resolving the download URL
    if (!newVersion && info?.version) newVersion = info.version;
    // Last resort: run the binary
    if (!newVersion) newVersion = getInstalledOcVersion();
    emit(`✅ openclaw 已更新到 ${newVersion || "最新版本"}`);
    return { ok: true, version: newVersion };
  } catch (err) {
    logDebug(`openclaw:install error: ${err}`);
    return { ok: false, error: err.message };
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
});

// ─── WeChat (openclaw-weixin) channel ────────────────────────────────────────

// Install @tencent-weixin/openclaw-weixin-cli plugin, stream output to renderer
ipcMain.handle("weixin:installPlugin", async () => {
  const emit = (msg) => mainWindow?.webContents.send("weixin:output", msg);
  const sandboxPaths = getSandboxPaths();
  const usesSandbox = fs.existsSync(sandboxPaths.npxCmd);

  const cleanEnv = { ...process.env };
  for (const key of Object.keys(cleanEnv)) {
    if (/^npm_config_/i.test(key) || /^npm_package_/i.test(key)) delete cleanEnv[key];
  }

  let npxExe, spawnEnv;
  if (usesSandbox) {
    emit("使用沙箱 npx");
    const profile = await detectMirrorProfile();
    const npmRegistry = profile.region === "cn"
      ? "https://mirrors.cloud.tencent.com/npm/"
      : "https://registry.npmjs.org/";
    npxExe = sandboxPaths.npxCmd;
    spawnEnv = {
      ...cleanEnv,
      PATH: `${path.dirname(sandboxPaths.nodeExe)};${process.env.PATH}`,
      npm_config_prefix: sandboxPaths.globalDir,
      npm_config_registry: npmRegistry,
      npm_config_cache: path.join(sandboxPaths.base, "npm-cache"),
    };
  } else {
    emit("使用系统 npx");
    npxExe = process.platform === "win32" ? "npx.cmd" : "npx";
    spawnEnv = { ...cleanEnv };
  }

  emit("正在安装微信插件 @tencent-weixin/openclaw-weixin-cli ...");
  const [spawnExe, spawnArgs] = process.platform === "win32"
    ? ["cmd.exe", ["/c", npxExe, "-y", "@tencent-weixin/openclaw-weixin-cli@latest", "install"]]
    : [npxExe, ["-y", "@tencent-weixin/openclaw-weixin-cli@latest", "install"]];

  const exitCode = await new Promise((resolve) => {
    const child = spawn(spawnExe, spawnArgs, { env: spawnEnv, shell: false });
    child.stdout.on("data", (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach(emit));
    child.stderr.on("data", (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach(emit));
    child.on("close", resolve);
    child.on("error", (err) => { emit(`错误: ${err.message}`); resolve(-1); });
  });

  if (exitCode !== 0) return { ok: false, error: `安装失败，退出码: ${exitCode}` };
  emit("✅ 微信插件安装完成");
  return { ok: true };
});

// Get a fresh WeChat QR code URL from Tencent's iLink API.
// Returns { ok, url (open in browser), token (for polling) }
ipcMain.handle("weixin:getQrcode", async () => {
  const https = require("https");
  return new Promise((resolve) => {
    const req = https.get(
      "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3",
      { headers: { "iLink-App-ClientVersion": "1" }, timeout: 30000 },
      (res) => {
        let body = "";
        res.on("data", (d) => { body += d; });
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (data.qrcode_img_content && data.qrcode) {
              resolve({ ok: true, url: data.qrcode_img_content, token: data.qrcode });
            } else {
              resolve({ ok: false, error: "接口未返回二维码信息: " + body.slice(0, 300) });
            }
          } catch (e) { resolve({ ok: false, error: "解析响应失败: " + e.message }); }
        });
      }
    );
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "请求超时" }); });
  });
});

// Poll whether the user has scanned the WeChat QR code.
// status: "wait" | "scaned" | "confirmed"
// When confirmed, botToken is set — Tencent-side login is done.
ipcMain.handle("weixin:pollStatus", async (_event, qrcode) => {
  const https = require("https");
  return new Promise((resolve) => {
    const url = `https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
    const req = https.get(url, { headers: { "iLink-App-ClientVersion": "1" }, timeout: 45000 }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          resolve({
            ok: true,
            status: data.status || "wait",
            botToken: data.bot_token || null,
            ilinkBotId: data.ilink_bot_id || null,
          });
        } catch (e) { resolve({ ok: false, error: "解析失败: " + e.message }); }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "请求超时" }); });
  });
});

// ─── Close DB on quit ────────────────────────────────────────────────────────
// Close DB on quit
app.on("will-quit", () => database.closeDb());
