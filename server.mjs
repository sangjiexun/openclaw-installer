/**
 * Lightweight dev server that provides system environment detection,
 * one-click install, and uninstall APIs.
 * Run alongside vite dev: node server.mjs
 */
import { createServer } from "node:http";
import { execSync, spawn } from "node:child_process";
import { existsSync, statSync, rmSync, mkdirSync } from "node:fs";
import { homedir, platform, arch, cpus, totalmem, tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";

const PORT = 3456;
const HOME = homedir();
const OPENCLAW_DIR = join(HOME, ".openclaw");

function tryExec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 10000 }).trim();
  } catch {
    return null;
  }
}

function checkPort(host, port) {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(2000, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

function parseSemver(v) {
  if (!v) return null;
  const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function isAtLeast(ver, min) {
  if (!ver) return false;
  if (ver.major !== min.major) return ver.major > min.major;
  if (ver.minor !== min.minor) return ver.minor > min.minor;
  return ver.patch >= min.patch;
}

const MIN_NODE = { major: 22, minor: 14, patch: 0 };
const REC_NODE = { major: 24, minor: 0, patch: 0 };

// ─── Environment Check ───────────────────────────────────────────────

async function runChecks() {
  const nodeVersion = tryExec("node -v");
  const nodeSemver = parseSemver(nodeVersion);
  const nodeOk = isAtLeast(nodeSemver, MIN_NODE);
  const nodeRec = isAtLeast(nodeSemver, REC_NODE);
  const nodeExecPath = tryExec("which node") || process.execPath;

  const npmVersion = tryExec("npm -v");
  const pnpmVersion = tryExec("pnpm -v");
  const bunVersion = tryExec("bun -v");
  const dockerVersion = tryExec("docker -v");
  const gitVersion = tryExec("git --version");

  const configDirExists = existsSync(OPENCLAW_DIR);
  const configFileExists = existsSync(join(OPENCLAW_DIR, "openclaw.json"));
  const credsDirExists = existsSync(join(OPENCLAW_DIR, "credentials"));
  const workspaceDirExists = existsSync(join(OPENCLAW_DIR, "workspace"));

  let configFilePerms = null;
  if (configFileExists) {
    try {
      const st = statSync(join(OPENCLAW_DIR, "openclaw.json"));
      configFilePerms = (st.mode & 0o777).toString(8);
    } catch { /* ignore */ }
  }

  const gatewayUp = await checkPort("127.0.0.1", 18789);
  const ollamaUp = await checkPort("127.0.0.1", 11434);

  // Check if openclaw is installed
  const openclawVersion = tryExec("openclaw --version");
  const openclawInstalled = !!openclawVersion;
  const openclawGlobalPath = tryExec("which openclaw") || tryExec("npm list -g openclaw --depth=0 2>/dev/null");

  // Docker-specific checks
  const dockerRunning = dockerVersion ? !!tryExec("docker info 2>/dev/null | head -1") : false;
  const dockerOpenclawContainer = dockerVersion
    ? tryExec("docker ps -a --filter name=openclaw --format '{{.Names}} {{.Status}}'")
    : null;

  const envVars = {
    gateway: [
      { name: "OPENCLAW_GATEWAY_TOKEN", set: !!process.env.OPENCLAW_GATEWAY_TOKEN, desc: "Gateway auth token" },
      { name: "OPENCLAW_GATEWAY_PASSWORD", set: !!process.env.OPENCLAW_GATEWAY_PASSWORD, desc: "Gateway auth password" },
      { name: "OPENCLAW_STATE_DIR", set: !!process.env.OPENCLAW_STATE_DIR, value: process.env.OPENCLAW_STATE_DIR || null, desc: "State directory override" },
      { name: "OPENCLAW_CONFIG_PATH", set: !!process.env.OPENCLAW_CONFIG_PATH, value: process.env.OPENCLAW_CONFIG_PATH || null, desc: "Config file path override" },
      { name: "OPENCLAW_HOME", set: !!process.env.OPENCLAW_HOME, value: process.env.OPENCLAW_HOME || null, desc: "Home directory override" },
      { name: "OPENCLAW_LOAD_SHELL_ENV", set: !!process.env.OPENCLAW_LOAD_SHELL_ENV, desc: "Import keys from login shell" },
    ],
    providers: [
      { name: "OPENAI_API_KEY", set: !!process.env.OPENAI_API_KEY, desc: "OpenAI API key" },
      { name: "ANTHROPIC_API_KEY", set: !!process.env.ANTHROPIC_API_KEY, desc: "Anthropic API key" },
      { name: "GEMINI_API_KEY", set: !!process.env.GEMINI_API_KEY, desc: "Google Gemini API key" },
      { name: "OPENROUTER_API_KEY", set: !!process.env.OPENROUTER_API_KEY, desc: "OpenRouter API key" },
      { name: "GOOGLE_API_KEY", set: !!process.env.GOOGLE_API_KEY, desc: "Google API key" },
    ],
    channels: [
      { name: "TELEGRAM_BOT_TOKEN", set: !!process.env.TELEGRAM_BOT_TOKEN, desc: "Telegram bot token" },
      { name: "DISCORD_BOT_TOKEN", set: !!process.env.DISCORD_BOT_TOKEN, desc: "Discord bot token" },
      { name: "SLACK_BOT_TOKEN", set: !!process.env.SLACK_BOT_TOKEN, desc: "Slack bot token" },
      { name: "SLACK_APP_TOKEN", set: !!process.env.SLACK_APP_TOKEN, desc: "Slack app token" },
    ],
    tools: [
      { name: "BRAVE_API_KEY", set: !!process.env.BRAVE_API_KEY, desc: "Brave Search API key" },
      { name: "ELEVENLABS_API_KEY", set: !!process.env.ELEVENLABS_API_KEY, desc: "ElevenLabs TTS key" },
      { name: "DEEPGRAM_API_KEY", set: !!process.env.DEEPGRAM_API_KEY, desc: "Deepgram STT key" },
    ],
  };

  const tips = [];
  if (!nodeRec && nodeOk) tips.push("nodeUpgrade");
  if (!nodeOk) tips.push("nodeUpgrade");
  if (!process.env.OPENCLAW_GATEWAY_TOKEN && !process.env.OPENCLAW_GATEWAY_PASSWORD) tips.push("gatewayToken");
  const hasAnyProvider = envVars.providers.some((v) => v.set);
  if (!hasAnyProvider) tips.push("providerKey");
  tips.push("runDoctor");
  if (configFileExists && configFilePerms && configFilePerms !== "600") tips.push("configPermissions");
  if (!process.env.OPENCLAW_LOAD_SHELL_ENV) tips.push("shellEnv");
  if (!ollamaUp) tips.push("ollamaLocal");
  if (!dockerVersion) tips.push("dockerSandbox");

  return {
    runtime: {
      nodeVersion: nodeVersion?.replace("v", "") || null,
      nodeOk,
      nodeRecommended: nodeRec,
      nodeExecPath,
      platform: platform(),
      arch: arch(),
      cpus: cpus().length,
      totalMemory: Math.round(totalmem() / 1024 / 1024 / 1024 * 10) / 10,
      pathEnv: process.env.PATH || "(not set)",
    },
    deps: {
      npm: npmVersion,
      pnpm: pnpmVersion,
      bun: bunVersion,
      docker: dockerVersion?.replace(/^Docker version\s*/i, "").replace(/,.*/, "") || null,
      git: gitVersion?.replace(/^git version\s*/i, "") || null,
    },
    install: {
      openclawInstalled,
      openclawVersion: openclawVersion || null,
      openclawPath: openclawGlobalPath || null,
      dockerRunning,
      dockerContainer: dockerOpenclawContainer || null,
    },
    config: {
      stateDir: { path: OPENCLAW_DIR, exists: configDirExists },
      configFile: { path: join(OPENCLAW_DIR, "openclaw.json"), exists: configFileExists, permissions: configFilePerms },
      credentials: { path: join(OPENCLAW_DIR, "credentials"), exists: credsDirExists },
      workspace: { path: join(OPENCLAW_DIR, "workspace"), exists: workspaceDirExists },
    },
    network: {
      gatewayPort: { port: 18789, listening: gatewayUp },
      ollamaService: { port: 11434, listening: ollamaUp },
    },
    envVars,
    tips,
  };
}

// ─── Run a shell command and stream output ───────────────────────────

function runCommand(cmd, args = [], cwd = undefined) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, {
      shell: true,
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
      timeout: 600_000,
    });
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on("error", (err) => {
      resolve({ ok: false, code: -1, stdout, stderr: err.message });
    });
  });
}

// Run a command and stream output line-by-line via a callback
function runCommandStreaming(cmd, args = [], cwd = undefined, onData = () => {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, {
      shell: true,
      cwd,
      env: { ...process.env, FORCE_COLOR: "0", VAGRANT_NO_COLOR: "1" },
      timeout: 600_000,
    });
    child.stdout?.on("data", (d) => {
      const chunk = d.toString();
      stdout += chunk;
      onData(chunk, "stdout");
    });
    child.stderr?.on("data", (d) => {
      const chunk = d.toString();
      stderr += chunk;
      onData(chunk, "stderr");
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on("error", (err) => {
      resolve({ ok: false, code: -1, stdout, stderr: err.message });
    });
  });
}

// ─── Docker mirror registries ────────────────────────────────────────

// China Docker Hub mirror for base images in Dockerfile
const CHINA_DOCKER_MIRROR = "docker.m.daocloud.io";

function patchDockerfileForChina(content) {
  let patched = content;

  // 1. Remove syntax directive — avoids pulling docker/dockerfile:X.Y from Docker Hub
  patched = patched.replace(/^#\s*syntax\s*=.*$/m, "# syntax directive removed for China build");

  // 2. Strip @sha256:... digest pins everywhere
  patched = patched.replace(/@sha256:[a-f0-9]{64}/g, "");

  // 3. Replace base image references in ARG defaults with China mirror
  //    "node:24-bookworm" → "docker.m.daocloud.io/library/node:24-bookworm"
  const mirror = CHINA_DOCKER_MIRROR;
  patched = patched.replace(
    /="(node:\d+-bookworm(?:-slim)?)"/g,
    (_, img) => `="${mirror}/library/${img}"`
  );

  // 4. Replace any bare FROM node:XX-bookworm not using ARG variables
  patched = patched.replace(
    /FROM\s+(node:\d+-bookworm(?:-slim)?)/g,
    (_, img) => `FROM ${mirror}/library/${img}`
  );

  // 5. Also replace docker.io/library/ references in LABEL lines
  patched = patched.replace(
    /docker\.io\/library\/(node:\d+-bookworm(?:-slim)?)/g,
    (_, img) => `${mirror}/library/${img}`
  );

  return patched;
}

const DOCKER_MIRRORS = [
  { id: "dockerhub", label: "Docker Hub (Official)", prefix: "" },
  { id: "daocloud", label: "DaoCloud (China)", prefix: "docker.m.daocloud.io/" },
  { id: "aliyun", label: "Aliyun (China)", prefix: "registry.cn-hangzhou.aliyuncs.com/" },
  { id: "ustc", label: "USTC Mirror", prefix: "docker.mirrors.ustc.edu.cn/" },
  { id: "ghcr", label: "GitHub Container Registry", prefix: "ghcr.io/" },
  { id: "custom", label: "Custom Registry", prefix: "" },
];

function resolveDockerImage(image, mirror, customRegistry) {
  if (mirror === "custom" && customRegistry) {
    const reg = customRegistry.replace(/\/+$/, "");
    return `${reg}/${image}`;
  }
  const entry = DOCKER_MIRRORS.find((m) => m.id === mirror);
  if (!entry || !entry.prefix) return image;
  return `${entry.prefix}${image}`;
}

// ─── Install handlers ────────────────────────────────────────────────

async function handleInstall(method, options = {}) {
  switch (method) {
    case "npm": {
      const registry = options.npmRegistry || "";
      const args = ["install", "-g", "openclaw@latest"];
      if (registry) args.push("--registry", registry);
      const result = await runCommand("npm", args);
      if (!result.ok) return { ok: false, message: result.stderr || result.stdout };
      const onboard = await runCommand("openclaw", ["onboard", "--install-daemon", "--non-interactive"]);
      return { ok: true, message: result.stdout, onboard: onboard.stdout || onboard.stderr };
    }
    case "pnpm": {
      const registry = options.npmRegistry || "";
      const args = ["add", "-g", "openclaw@latest"];
      if (registry) args.push("--registry", registry);
      const result = await runCommand("pnpm", args);
      if (!result.ok) return { ok: false, message: result.stderr || result.stdout };
      const approve = await runCommand("pnpm", ["approve-builds", "-g"]);
      const onboard = await runCommand("openclaw", ["onboard", "--install-daemon", "--non-interactive"]);
      return { ok: true, message: result.stdout, approve: approve.stdout, onboard: onboard.stdout || onboard.stderr };
    }
    case "script-mac": {
      const result = await runCommand("bash", ["-c", "curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard"]);
      return { ok: result.ok, message: result.ok ? result.stdout : (result.stderr || result.stdout) };
    }
    case "script-win": {
      return { ok: false, message: "Windows installer must be run from PowerShell: iwr -useb https://openclaw.ai/install.ps1 | iex" };
    }
    case "docker": {
      const mode = options.dockerMode || "build"; // "build" | "pull"
      const mirror = options.dockerMirror || "dockerhub";
      const customRegistry = options.customRegistry || "";
      const customImage = options.dockerImage || "openclaw/openclaw:latest";
      const port = options.port || "18789";
      const containerName = options.containerName || "openclaw";

      if (mode === "build") {
        // Local build from project Dockerfile
        const projectRoot = join(import.meta.dirname || process.cwd(), "..");
        const dockerfilePath = join(projectRoot, "Dockerfile");
        if (!existsSync(dockerfilePath)) {
          return { ok: false, message: `Dockerfile not found at ${dockerfilePath}\nMake sure you are running from the install-ui directory inside the openclaw project.` };
        }
        const buildTag = options.buildTag || "openclaw:local";

        // Create a patched Dockerfile that removes the syntax directive
        // to avoid pulling docker/dockerfile:1.7 from Docker Hub (fails in China).
        // Also replace pinned base image digests with tag-only refs so Docker
        // can resolve them through local daemon mirrors.
        const { readFileSync, writeFileSync, unlinkSync } = await import("node:fs");
        const origContent = readFileSync(dockerfilePath, "utf-8");
        const patchedPath = join(projectRoot, "Dockerfile.local-build");
        const patched = patchDockerfileForChina(origContent);
        writeFileSync(patchedPath, patched);

        const build = await runCommand("docker", [
          "build",
          "-t", buildTag,
          "-f", patchedPath,
          "--network", "host",
          projectRoot,
        ]);

        // Clean up temp file
        try { unlinkSync(patchedPath); } catch { /* ignore */ }

        if (!build.ok) {
          const stderr = build.stderr || build.stdout;
          let hint = "";
          if (stderr.includes("context deadline exceeded") || stderr.includes("failed to resolve") || stderr.includes("timeout")) {
            hint = "\n\n--- Hint ---\n";
            hint += "Docker build still has network issues. Configure Docker daemon mirrors:\n";
            hint += "Edit ~/.docker/daemon.json:\n";
            hint += '{\n  "registry-mirrors": [\n';
            hint += '    "https://mirror.ccs.tencentyun.com",\n';
            hint += '    "https://docker.mirrors.ustc.edu.cn"\n';
            hint += "  ]\n}\n";
            hint += "Then restart Docker Desktop and retry.";
          }
          return { ok: false, message: `Docker build failed:\n${stderr}${hint}` };
        }
        await runCommand("docker", ["rm", "-f", containerName]);
        const run = await runCommand("docker", [
          "run", "-d", "--name", containerName,
          "--restart", "unless-stopped",
          "-v", `${OPENCLAW_DIR}:/home/node/.openclaw`,
          "-p", `${port}:18789`,
          buildTag,
        ]);
        return {
          ok: run.ok,
          message: run.ok
            ? `Mode: Local Build\nImage: ${buildTag}\nContainer: ${containerName}\nPort: ${port}\nID: ${run.stdout.slice(0, 12)}`
            : (run.stderr || run.stdout),
        };
      }

      // Pull mode
      const image = resolveDockerImage(customImage, mirror, customRegistry);
      const pull = await runCommand("docker", ["pull", image]);
      if (!pull.ok) {
        const stderr = pull.stderr || pull.stdout;
        const isTimeout = stderr.includes("context deadline exceeded") || stderr.includes("timeout");
        const isNetErr = stderr.includes("failed to resolve") || stderr.includes("connection refused") || stderr.includes("no such host");
        const isNotFound = stderr.includes("not found") || stderr.includes("manifest unknown") || stderr.includes("404");
        let hint = "\n\n--- Hint ---\n";
        if (isNotFound) {
          hint += "Image not found in the registry. Try:\n";
          hint += '1. Switch to "Local Build" mode — builds directly from the project Dockerfile\n';
          hint += "2. Check the image name is correct\n";
        } else if (isTimeout || isNetErr) {
          hint += "Network issue detected. Try:\n";
          hint += '1. Switch to "Local Build" mode (no network pull needed)\n';
          hint += "2. Select a mirror registry (Aliyun, Tencent, USTC)\n";
          hint += "3. Or configure Docker daemon mirrors in ~/.docker/daemon.json:\n";
          hint += '   { "registry-mirrors": ["https://mirror.ccs.tencentyun.com"] }\n';
          hint += "4. Then restart Docker and retry\n";
        }
        return { ok: false, message: stderr + hint };
      }
      await runCommand("docker", ["rm", "-f", containerName]);
      const run = await runCommand("docker", [
        "run", "-d", "--name", containerName,
        "--restart", "unless-stopped",
        "-v", `${OPENCLAW_DIR}:/home/node/.openclaw`,
        "-p", `${port}:18789`,
        image,
      ]);
      return {
        ok: run.ok,
        message: run.ok
          ? `Mode: Pull\nImage: ${image}\nContainer: ${containerName}\nPort: ${port}\nID: ${run.stdout.slice(0, 12)}`
          : (run.stderr || run.stdout),
      };
    }
    case "source": {
      return { ok: false, message: "Source install requires manual steps. Clone the repo and run: pnpm install && pnpm build && pnpm link --global" };
    }
    case "vagrant": {
      // Vagrant install is handled via SSE streaming endpoint
      return { ok: false, message: "Use the /api/install/vagrant/stream SSE endpoint for real-time progress." };
    }
    default:
      return { ok: false, message: `Unknown install method: ${method}` };
  }
}

// ─── Uninstall handlers ──────────────────────────────────────────────

async function handleUninstall(method, options = {}) {
  const steps = [];

  // 1. Stop gateway process
  const killGw = await runCommand("pkill", ["-9", "-f", "openclaw-gateway"]);
  steps.push({ step: "stop-gateway", ok: true, message: killGw.ok ? "Gateway stopped" : "No gateway process found" });

  // 2. Stop and remove Docker container
  const dockerRm = await runCommand("docker", ["rm", "-f", "openclaw"]);
  steps.push({ step: "docker-remove", ok: true, message: dockerRm.ok ? "Docker container removed" : "No Docker container found" });

  // 3. Remove Docker image
  if (method === "docker" || method === "all") {
    const dockerRmi = await runCommand("docker", ["rmi", "openclaw/openclaw:latest"]);
    steps.push({ step: "docker-image", ok: true, message: dockerRmi.ok ? "Docker image removed" : "No Docker image found" });
  }

  // 4. Uninstall npm global package
  if (method === "npm" || method === "all") {
    const npmUn = await runCommand("npm", ["uninstall", "-g", "openclaw"]);
    steps.push({ step: "npm-uninstall", ok: npmUn.ok, message: npmUn.ok ? "npm package removed" : (npmUn.stderr || "Failed") });
  }

  // 5. Uninstall pnpm global package
  if (method === "pnpm" || method === "all") {
    const pnpmUn = await runCommand("pnpm", ["remove", "-g", "openclaw"]);
    steps.push({ step: "pnpm-uninstall", ok: true, message: pnpmUn.ok ? "pnpm package removed" : "Not installed via pnpm" });
  }

  // 6. Remove state directory (only if explicitly requested)
  if (options.removeData) {
    try {
      if (existsSync(OPENCLAW_DIR)) {
        rmSync(OPENCLAW_DIR, { recursive: true, force: true });
        steps.push({ step: "remove-data", ok: true, message: `Removed ${OPENCLAW_DIR}` });
      } else {
        steps.push({ step: "remove-data", ok: true, message: "State directory not found" });
      }
    } catch (err) {
      steps.push({ step: "remove-data", ok: false, message: `Failed: ${err.message}` });
    }
  }

  // 7. Destroy Vagrant VMs
  if (method === "vagrant" || method === "all") {
    for (const vagrantOs of ["kali", "windows"]) {
      const vmDir = join(OPENCLAW_DIR, `vagrant-${vagrantOs}`);
      if (existsSync(join(vmDir, "Vagrantfile"))) {
        const destroy = await runCommand("vagrant", ["destroy", "-f"], vmDir);
        steps.push({ step: `vagrant-${vagrantOs}`, ok: true, message: destroy.ok ? `Vagrant ${vagrantOs} VM destroyed` : `No ${vagrantOs} VM found` });
        try { rmSync(vmDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  // 8. Remove launchd service (macOS)
  if (platform() === "darwin") {
    const label = tryExec("launchctl print gui/$(id -u) 2>/dev/null | grep openclaw | head -1");
    if (label) {
      await runCommand("launchctl", ["bootout", `gui/$(id -u)`, label.trim()]);
      steps.push({ step: "launchd", ok: true, message: "Removed launchd service" });
    }
  }

  // 8. Remove systemd service (Linux)
  if (platform() === "linux") {
    const svcExists = tryExec("systemctl --user is-enabled openclaw 2>/dev/null");
    if (svcExists) {
      await runCommand("systemctl", ["--user", "stop", "openclaw"]);
      await runCommand("systemctl", ["--user", "disable", "openclaw"]);
      steps.push({ step: "systemd", ok: true, message: "Removed systemd service" });
    }
  }

  return { ok: steps.every((s) => s.ok), steps };
}

// ─── Preflight check for install methods ─────────────────────────────

async function preflightCheck() {
  const plat = platform();
  const nodeVersion = tryExec("node -v");
  const nodeSemver = parseSemver(nodeVersion);
  const nodeOk = isAtLeast(nodeSemver, MIN_NODE);
  const npmVersion = tryExec("npm -v");
  const pnpmVersion = tryExec("pnpm -v");
  const dockerVersion = tryExec("docker -v");
  const dockerRunning = dockerVersion ? !!tryExec("docker info 2>/dev/null | head -1") : false;
  const gitVersion = tryExec("git --version");
  const curlVersion = tryExec("curl --version 2>/dev/null | head -1");
  const openclawInstalled = !!tryExec("openclaw --version");
  const vagrantVersion = tryExec("vagrant --version 2>/dev/null");
  const vboxVersion = tryExec("VBoxManage --version 2>/dev/null");

  // Detect available package managers for auto-install
  const brewAvailable = plat === "darwin" && !!tryExec("brew --version 2>/dev/null | head -1");
  const scoopAvailable = plat === "win32" && !!tryExec("scoop --version 2>/dev/null");
  const chocoAvailable = plat === "win32" && !!tryExec("choco --version 2>/dev/null");
  const aptAvailable = plat === "linux" && !!tryExec("apt-get --version 2>/dev/null | head -1");
  const dnfAvailable = plat === "linux" && !!tryExec("dnf --version 2>/dev/null | head -1");
  const pacmanAvailable = plat === "linux" && !!tryExec("pacman --version 2>/dev/null | head -1");

  const hasPackageManager = brewAvailable || scoopAvailable || chocoAvailable || aptAvailable || dnfAvailable || pacmanAvailable;
  const packageManagers = [];
  if (brewAvailable) packageManagers.push("brew");
  if (scoopAvailable) packageManagers.push("scoop");
  if (chocoAvailable) packageManagers.push("choco");
  if (aptAvailable) packageManagers.push("apt");
  if (dnfAvailable) packageManagers.push("dnf");
  if (pacmanAvailable) packageManagers.push("pacman");

  const vagrantMissing = !vagrantVersion;
  const vboxMissing = !vboxVersion;
  let vagrantReason = null;
  if (vagrantMissing && vboxMissing) {
    vagrantReason = hasPackageManager
      ? `Vagrant + VirtualBox not installed (auto-install available via ${packageManagers.join("/")})`
      : "Vagrant + VirtualBox not installed";
  } else if (vagrantMissing) {
    vagrantReason = hasPackageManager
      ? `Vagrant not installed (auto-install available via ${packageManagers.join("/")})`
      : "Vagrant not installed (https://www.vagrantup.com)";
  } else if (vboxMissing) {
    vagrantReason = hasPackageManager
      ? `VirtualBox not installed (auto-install available via ${packageManagers.join("/")})`
      : "VirtualBox not installed (https://www.virtualbox.org)";
  }

  const methods = [
    {
      id: "script",
      available: plat !== "win32" && !!curlVersion,
      reason: !curlVersion ? "curl not found" : plat === "win32" ? "Use PowerShell installer on Windows" : null,
    },
    {
      id: "npm",
      available: !!npmVersion && nodeOk,
      reason: !npmVersion ? "npm not installed" : !nodeOk ? `Node ≥22.14.0 required (found ${nodeVersion || "none"})` : null,
    },
    {
      id: "pnpm",
      available: !!pnpmVersion && nodeOk,
      reason: !pnpmVersion ? "pnpm not installed" : !nodeOk ? `Node ≥22.14.0 required (found ${nodeVersion || "none"})` : null,
    },
    {
      id: "docker",
      available: !!dockerVersion && dockerRunning,
      reason: !dockerVersion ? "Docker not installed" : !dockerRunning ? "Docker daemon not running" : null,
      extra: {
        dockerInstalled: !!dockerVersion,
        dockerRunning,
        canAutoInstall: !dockerVersion && (plat === "linux" || plat === "darwin"),
        hasCurl: !!curlVersion,
      },
    },
    {
      id: "vagrant",
      available: !!vagrantVersion && !!vboxVersion,
      reason: vagrantReason,
      extra: {
        vagrant: vagrantVersion?.replace(/^Vagrant\s*/i, "") || null,
        virtualbox: vboxVersion || null,
        canAutoInstall: hasPackageManager && (vagrantMissing || vboxMissing),
        packageManagers,
        missingVagrant: vagrantMissing,
        missingVbox: vboxMissing,
      },
    },
    {
      id: "source",
      available: !!gitVersion && !!pnpmVersion && nodeOk,
      reason: !gitVersion ? "git not installed" : !pnpmVersion ? "pnpm required for source builds" : !nodeOk ? "Node ≥22.14.0 required" : null,
    },
  ];

  return {
    platform: plat,
    arch: arch(),
    nodeOk,
    openclawInstalled,
    methods,
  };
}

// ─── Vagrant China mirror + SSE streaming ────────────────────────────

const VAGRANT_CHINA_MIRRORS = {
  "kalilinux/rolling": "https://mirrors.ustc.edu.cn/kali-images/kali-weekly/",
  "gusztavvargadr/windows-10": null, // no China mirror for Windows boxes
};

// Vagrant box download acceleration: set VAGRANT_SERVER_URL or use vagrant-mirror plugin
function buildVagrantEnv(useChinaMirror) {
  const env = { ...process.env, FORCE_COLOR: "0", VAGRANT_NO_COLOR: "1" };
  if (useChinaMirror) {
    // Use USTC or Tsinghua Vagrant cloud mirror
    env.VAGRANT_SERVER_URL = "https://mirrors.ustc.edu.cn/vagrant";
  }
  return env;
}

// ─── Universal SSE streaming install ─────────────────────────────────

async function handleStreamInstall(res, method, options = {}) {
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Helper: run a command with live streaming
  async function streamCommand(label, cmd, args, cwd = undefined, envOverride = undefined) {
    send("step", { step: label, status: "running", message: `Running: ${cmd} ${args.join(" ")}` });
    let percent = 0;
    const result = await new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(cmd, args, {
        shell: true,
        cwd,
        env: envOverride || { ...process.env, FORCE_COLOR: "0" },
        timeout: 1200_000,
      });
      child.stdout?.on("data", (d) => {
        const chunk = d.toString();
        stdout += chunk;
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // Docker build progress: #N [stage X/Y]
          const dockerStep = trimmed.match(/#\d+\s+\[.*?(\d+)\/(\d+)\]/);
          if (dockerStep) {
            percent = Math.min(95, Math.round((parseInt(dockerStep[1]) / parseInt(dockerStep[2])) * 100));
            send("progress", { percent, line: trimmed });
            continue;
          }
          // npm progress
          const npmProgress = trimmed.match(/(\d+)\s+packages?\s+in/i);
          if (npmProgress) {
            percent = 90;
            send("progress", { percent, line: trimmed });
          }
          // Vagrant progress
          const vagrantProgress = trimmed.match(/Progress:\s*(\d+)%/i);
          if (vagrantProgress) {
            percent = parseInt(vagrantProgress[1], 10);
            send("progress", { percent, line: trimmed });
            continue;
          }
          // Docker pull progress
          const pullProgress = trimmed.match(/(\w+):\s+(Downloading|Extracting)\s+\[.*?\]\s+([\d.]+[kMG]?B)/i);
          if (pullProgress) {
            send("log", { text: trimmed });
            continue;
          }
          // Generic step lines
          const stepLine = trimmed.match(/^==>.*?:\s*(.+)/);
          if (stepLine) {
            send("log", { text: stepLine[1] });
            continue;
          }
          send("log", { text: trimmed });
        }
      });
      child.stderr?.on("data", (d) => {
        const chunk = d.toString();
        stderr += chunk;
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // Docker build step progress from stderr
          const dockerStep = trimmed.match(/#\d+\s+\[.*?(\d+)\/(\d+)\]/);
          if (dockerStep) {
            percent = Math.min(95, Math.round((parseInt(dockerStep[1]) / parseInt(dockerStep[2])) * 100));
            send("progress", { percent, line: trimmed });
            continue;
          }
          send("log", { text: trimmed });
        }
      });
      child.on("close", (code) => resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() }));
      child.on("error", (err) => resolve({ ok: false, stdout, stderr: err.message }));
    });
    if (result.ok) {
      send("step", { step: label, status: "done", message: `${label} completed` });
    } else {
      send("step", { step: label, status: "error", message: result.stderr || result.stdout || "Failed" });
    }
    return result;
  }

  try {
    switch (method) {
      case "npm":
      case "pnpm": {
        const registry = options.npmRegistry || "";
        const pm = method;
        const installArgs = pm === "npm" ? ["install", "-g", "openclaw@latest"] : ["add", "-g", "openclaw@latest"];
        if (registry) installArgs.push("--registry", registry);

        send("progress", { percent: 5, line: `Installing via ${pm}...` });
        const install = await streamCommand(`${pm}-install`, pm, installArgs);
        if (!install.ok) { send("done", { ok: false, message: install.stderr || install.stdout }); break; }

        if (pm === "pnpm") {
          send("progress", { percent: 70, line: "Approving builds..." });
          await streamCommand("pnpm-approve", "pnpm", ["approve-builds", "-g"]);
        }

        send("progress", { percent: 85, line: "Running onboard..." });
        const onboard = await streamCommand("onboard", "openclaw", ["onboard", "--install-daemon", "--non-interactive"]);
        send("progress", { percent: 100, line: "Complete" });
        send("done", { ok: true, message: `Installed via ${pm}\n${onboard.stdout || ""}` });
        break;
      }

      case "script-mac":
      case "script-win": {
        if (method === "script-win") {
          send("done", { ok: false, message: "Windows installer must be run from PowerShell: iwr -useb https://openclaw.ai/install.ps1 | iex" });
          break;
        }
        send("progress", { percent: 5, line: "Downloading installer script..." });
        const result = await streamCommand("script", "bash", ["-c", "curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard"]);
        send("progress", { percent: 100, line: "Complete" });
        send("done", { ok: result.ok, message: result.ok ? result.stdout : (result.stderr || result.stdout) });
        break;
      }

      case "docker": {
        const mode = options.dockerMode || "build";
        const mirror = options.dockerMirror || "dockerhub";
        const customReg = options.customRegistry || "";
        const customImg = options.dockerImage || "openclaw/openclaw:latest";
        const port = options.port || "18789";
        const cName = options.containerName || "openclaw";

        if (mode === "build") {
          const projectRoot = join(import.meta.dirname || process.cwd(), "..");
          const dockerfilePath = join(projectRoot, "Dockerfile");
          if (!existsSync(dockerfilePath)) {
            send("done", { ok: false, message: `Dockerfile not found at ${dockerfilePath}` });
            break;
          }
          const bTag = options.buildTag || "openclaw:local";

          send("step", { step: "prepare", status: "running", message: "Patching Dockerfile for China build..." });
          const { readFileSync: rf, writeFileSync: wf, unlinkSync: ul } = await import("node:fs");
          const origContent = rf(dockerfilePath, "utf-8");
          const patchedPath = join(projectRoot, "Dockerfile.local-build");
          const patched = patchDockerfileForChina(origContent);
          wf(patchedPath, patched);
          send("log", { text: `🇨🇳 Base images redirected to ${CHINA_DOCKER_MIRROR}` });
          send("step", { step: "prepare", status: "done", message: "Dockerfile patched for China mirrors" });

          send("progress", { percent: 5, line: "Starting Docker build..." });
          const build = await streamCommand("docker-build", "docker", ["build", "-t", bTag, "-f", patchedPath, "--network", "host", projectRoot]);
          try { ul(patchedPath); } catch { /* ignore */ }

          if (!build.ok) {
            let hint = "";
            const err = build.stderr || build.stdout;
            if (err.includes("context deadline exceeded") || err.includes("failed to resolve")) {
              hint = "\n\nConfigure Docker daemon mirrors in ~/.docker/daemon.json and restart Docker.";
            }
            send("done", { ok: false, message: err + hint });
            break;
          }

          send("progress", { percent: 92, line: "Starting container..." });
          await streamCommand("docker-rm", "docker", ["rm", "-f", cName]);
          const run = await streamCommand("docker-run", "docker", [
            "run", "-d", "--name", cName, "--restart", "unless-stopped",
            "-v", `${OPENCLAW_DIR}:/home/node/.openclaw`, "-p", `${port}:18789`, bTag,
          ]);
          send("progress", { percent: 100, line: "Complete" });
          send("done", {
            ok: run.ok,
            message: run.ok ? `Image: ${bTag}\nContainer: ${cName}\nPort: ${port}\nID: ${run.stdout.slice(0, 12)}` : (run.stderr || run.stdout),
          });
        } else {
          // Pull mode - note: OpenClaw doesn't have pre-built images on public registries
          send("progress", { percent: 5, line: "Note: OpenClaw requires local build from source..." });
          const projectRoot = join(import.meta.dirname || process.cwd(), "..");
          const dockerfilePath = join(projectRoot, "Dockerfile");

          if (!existsSync(dockerfilePath)) {
            send("done", { ok: false, message: `OpenClaw Dockerfile not found at ${dockerfilePath}.\n\nPlease use one of:\n1. \"Local Build\" mode (requires openclaw source code)\n2. Install via npm/pnpm: npm install -g openclaw@latest\n3. Install from source` });
            break;
          }

          send("step", { step: "prepare", status: "running", message: "Patching Dockerfile for China build..." });
          const { readFileSync: rf, writeFileSync: wf, unlinkSync: ul } = await import("node:fs");
          const origContent = rf(dockerfilePath, "utf-8");
          const patchedPath = join(projectRoot, "Dockerfile.local-build");
          const patched = patchDockerfileForChina(origContent);
          wf(patchedPath, patched);
          send("log", { text: "🇨🇳 Base images redirected to DaoCloud mirror" });
          send("step", { step: "prepare", status: "done", message: "Dockerfile patched for China mirrors" });

          send("progress", { percent: 10, line: "Building Docker image locally (this may take 10-30 minutes)..." });
          const bTag = options.buildTag || "openclaw:local";
          const build = await streamCommand("docker-build", "docker", ["build", "-t", bTag, "-f", patchedPath, "--network", "host", projectRoot]);
          try { ul(patchedPath); } catch { /* ignore */ }

          if (!build.ok) {
            let hint = "";
            const err = build.stderr || build.stdout;
            if (err.includes("context deadline exceeded") || err.includes("failed to resolve")) {
              hint = "\n\nConfigure Docker daemon mirrors in ~/.docker/daemon.json and restart Docker.";
            }
            send("done", { ok: false, message: err + hint });
            break;
          }

          send("progress", { percent: 92, line: "Starting container..." });
          await streamCommand("docker-rm", "docker", ["rm", "-f", cName]);
          const run = await streamCommand("docker-run", "docker", [
            "run", "-d", "--name", cName, "--restart", "unless-stopped",
            "-v", `${OPENCLAW_DIR}:/home/node/.openclaw`, "-p", `${port}:18789`, bTag,
          ]);
          send("progress", { percent: 100, line: "Complete" });
          send("done", {
            ok: run.ok,
            message: run.ok ? `Image: ${bTag}\nContainer: ${cName}\nPort: ${port}\nID: ${run.stdout.slice(0, 12)}` : (run.stderr || run.stdout),
          });
        }
        break;
      }

      case "source": {
        const cloneDir = join(process.cwd(), "openclaw-source");
        const useChinaMirror = options.chinaMirror !== "false";

        send("progress", { percent: 5, line: "Cloning OpenClaw repository..." });

        if (existsSync(cloneDir)) {
          send("log", { text: "Repository already exists, pulling latest..." });
          const pull = await streamCommand("git-pull", "git", ["pull", "origin", "main"], cloneDir);
          if (!pull.ok) {
            send("done", { ok: false, message: `Failed to update repository: ${pull.stderr || pull.stdout}` });
            break;
          }
        } else {
          let cloneUrl = "https://github.com/openclaw/openclaw.git";
          if (useChinaMirror) {
            cloneUrl = "https://ghproxy.com/https://github.com/openclaw/openclaw.git";
            send("log", { text: "🇨🇳 Using China mirror for faster clone..." });
          }
          const clone = await streamCommand("git-clone", "git", ["clone", "--depth=1", cloneUrl, cloneDir]);
          if (!clone.ok) {
            send("done", { ok: false, message: `Failed to clone repository: ${clone.stderr || clone.stdout}` });
            break;
          }
        }

        send("progress", { percent: 30, line: "Installing dependencies..." });
        const install = await streamCommand("pnpm-install", "pnpm", ["install"], cloneDir);
        if (!install.ok) {
          send("done", { ok: false, message: `Failed to install dependencies: ${install.stderr || install.stdout}` });
          break;
        }

        send("progress", { percent: 60, line: "Building project..." });
        const build = await streamCommand("pnpm-build", "pnpm", ["build"], cloneDir);
        if (!build.ok) {
          send("done", { ok: false, message: `Failed to build project: ${build.stderr || build.stdout}` });
          break;
        }

        send("progress", { percent: 85, line: "Linking globally..." });
        const link = await streamCommand("pnpm-link", "pnpm", ["link", "--global", cloneDir], cloneDir);
        if (!link.ok) {
          send("done", { ok: false, message: `Failed to link globally: ${link.stderr || link.stdout}` });
          break;
        }

        send("progress", { percent: 95, line: "Running onboard..." });
        const onboard = await streamCommand("onboard", "openclaw", ["onboard", "--install-daemon", "--non-interactive", "--accept-risk"]);
        send("progress", { percent: 100, line: "Complete" });
        send("done", { ok: true, message: `Source install complete!\nRepository: ${cloneDir}\n\n${onboard.stdout || ""}` });
        break;
      }

      case "btpanel-docker": {
        // Install Docker via BT Panel script (China-optimized)
        send("step", { step: "btpanel", status: "running", message: "Installing Docker via BT Panel script..." });
        send("log", { text: "🇨🇳 Using bt.cn accelerated Docker installer" });
        send("progress", { percent: 5, line: "Downloading btClaw.sh..." });

        const dlCmd = 'if [ -f /usr/bin/curl ];then curl -sSO https://download.bt.cn/install/btClaw.sh;else wget -O btClaw.sh https://download.bt.cn/install/btClaw.sh;fi';
        const dl = await streamCommand("download-script", "bash", ["-c", dlCmd]);
        if (!dl.ok) {
          send("done", { ok: false, message: `Failed to download btClaw.sh:\n${dl.stderr || dl.stdout}` });
          break;
        }

        send("progress", { percent: 15, line: "Running btClaw.sh (this may take several minutes)..." });
        const install = await streamCommand("btpanel-install", "bash", ["btClaw.sh", "op260309docker"]);

        // Clean up
        await runCommand("rm", ["-f", "btClaw.sh"]);

        if (!install.ok) {
          send("done", { ok: false, message: `BT Panel Docker install failed:\n${install.stderr || install.stdout}` });
          break;
        }

        send("progress", { percent: 90, line: "Verifying Docker installation..." });
        // Verify docker is now available
        const dockerCheck = await runCommand("docker", ["--version"]);
        if (dockerCheck.ok) {
          send("log", { text: `✓ Docker installed: ${dockerCheck.stdout}` });
          send("progress", { percent: 100, line: "Docker installed successfully" });
          send("done", { ok: true, message: `Docker installed via BT Panel\n${dockerCheck.stdout}\n\nYou can now use the Docker install method to deploy OpenClaw.` });
        } else {
          send("log", { text: "Docker command not found after install — you may need to restart your shell or reboot." });
          send("done", { ok: false, message: "btClaw.sh completed but docker command not found.\nTry: source ~/.bashrc or restart your terminal, then retry." });
        }
        break;
      }

      default:
        send("done", { ok: false, message: `Unknown method: ${method}` });
    }
  } catch (err) {
    send("done", { ok: false, message: String(err) });
  }

  res.end();
}

async function handleVagrantStreamInstall(res, options = {}) {
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const vagrantOs = options.vagrantOs || "kali";
  const vmMemory = options.vmMemory || "4096";
  const vmCpus = options.vmCpus || "2";
  const vmPort = options.vmPort || "18789";
  const vmGui = options.vmGui === "true" ? "true" : "false";
  const syncDir = options.syncDir || OPENCLAW_DIR;
  const useChinaMirror = options.chinaMirror !== false && options.chinaMirror !== "false";

  // Step 1: Validate template
  send("step", { step: "prepare", status: "running", message: "Preparing Vagrantfile..." });
  const templateFile = join(import.meta.dirname || process.cwd(), "vagrant", `Vagrantfile.${vagrantOs}`);
  if (!existsSync(templateFile)) {
    send("step", { step: "prepare", status: "error", message: `Template not found: ${templateFile}` });
    send("done", { ok: false });
    res.end();
    return;
  }

  // Step 2: Create working directory and Vagrantfile
  const vmDir = join(OPENCLAW_DIR, `vagrant-${vagrantOs}`);
  const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
  mkdirSync(vmDir, { recursive: true });

  let vagrantfile = readFileSync(templateFile, "utf-8");

  // Inject China mirror box URL if available
  if (useChinaMirror) {
    // Add config.vm.box_url for accelerated download
    const boxUrlLine = vagrantOs === "kali"
      ? '  config.vm.box_url = "https://mirrors.ustc.edu.cn/vagrant/kalilinux/boxes/rolling"'
      : "";
    if (boxUrlLine) {
      vagrantfile = vagrantfile.replace(
        /(config\.vm\.box\s*=\s*"[^"]+")/, `$1\n${boxUrlLine}`
      );
    }
  }

  vagrantfile = vagrantfile
    .replace(/__MEMORY__/g, vmMemory)
    .replace(/__CPUS__/g, vmCpus)
    .replace(/__PORT__/g, vmPort)
    .replace(/__GUI__/g, vmGui)
    .replace(/__SYNC_DIR__/g, syncDir);
  writeFileSync(join(vmDir, "Vagrantfile"), vagrantfile);
  send("step", { step: "prepare", status: "done", message: `Vagrantfile created at ${vmDir}` });

  // Step 3: vagrant up with streaming
  send("step", { step: "vagrant-up", status: "running", message: "Starting vagrant up (this may take a while)..." });
  if (useChinaMirror) {
    send("log", { text: "🇨🇳 China mirror enabled (VAGRANT_SERVER_URL=https://mirrors.ustc.edu.cn/vagrant)" });
  }

  let progressPercent = 0;
  let lastProgressLine = "";

  const vagrantEnv = buildVagrantEnv(useChinaMirror);
  const result = await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("vagrant", ["up", "--provider", "virtualbox"], {
      shell: true,
      cwd: vmDir,
      env: vagrantEnv,
      timeout: 1200_000, // 20 min for large box downloads
    });

    child.stdout?.on("data", (d) => {
      const chunk = d.toString();
      stdout += chunk;
      // Parse vagrant progress lines
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Detect download progress: "    default: Progress: 45% (Rate: 2.1M/s, Estimated time remaining: 3:22)"
        const progressMatch = trimmed.match(/Progress:\s*(\d+)%/i);
        if (progressMatch) {
          progressPercent = parseInt(progressMatch[1], 10);
          lastProgressLine = trimmed;
          send("progress", { percent: progressPercent, line: trimmed });
          continue;
        }

        // Detect vagrant step lines: "==> default: Importing base box..."
        const stepMatch = trimmed.match(/^==>.*?:\s*(.+)/);
        if (stepMatch) {
          send("log", { text: stepMatch[1] });
          continue;
        }

        // Other output
        if (trimmed.length > 2) {
          send("log", { text: trimmed });
        }
      }
    });

    child.stderr?.on("data", (d) => {
      const chunk = d.toString();
      stderr += chunk;
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) send("log", { text: `⚠ ${trimmed}` });
      }
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on("error", (err) => {
      resolve({ ok: false, code: -1, stdout, stderr: err.message });
    });
  });

  if (result.ok) {
    send("step", { step: "vagrant-up", status: "done", message: "VM is running" });
    send("progress", { percent: 100, line: "Complete" });
    send("done", {
      ok: true,
      message: [
        `VM: openclaw-${vagrantOs}`,
        `OS: ${vagrantOs === "kali" ? "Kali Linux (Rolling)" : "Windows 10"}`,
        `Memory: ${vmMemory}MB, CPUs: ${vmCpus}`,
        `Gateway port: ${vmPort}`,
        `Vagrantfile: ${vmDir}/Vagrantfile`,
        "",
        vagrantOs === "kali" ? "SSH: vagrant ssh" : "RDP: vagrant rdp",
        `Directory: cd ${vmDir}`,
      ].join("\n"),
    });
  } else {
    const stderr = result.stderr || result.stdout;
    let hint = "";
    if (stderr.includes("VBoxManage") || stderr.includes("VirtualBox")) {
      hint = "\nVirtualBox error — make sure VirtualBox is installed and running.";
    }
    if (stderr.includes("SSL") || stderr.includes("certificate") || stderr.includes("timeout")) {
      hint = "\nNetwork/SSL error — try enabling China mirror or check your network.";
    }
    send("step", { step: "vagrant-up", status: "error", message: "vagrant up failed" + hint });
    send("done", { ok: false, message: stderr + hint });
  }

  res.end();
}

// ─── Auto-install dependencies (Vagrant, VirtualBox) ─────────────────

const DEP_INSTALL_COMMANDS = {
  brew: {
    vagrant: ["brew", ["install", "--cask", "vagrant"]],
    virtualbox: ["brew", ["install", "--cask", "virtualbox"]],
  },
  scoop: {
    vagrant: ["scoop", ["install", "vagrant"]],
    virtualbox: ["scoop", ["install", "virtualbox"]],
  },
  choco: {
    vagrant: ["choco", ["install", "vagrant", "-y"]],
    virtualbox: ["choco", ["install", "virtualbox", "-y"]],
  },
  apt: {
    vagrant: ["bash", ["-c", "sudo apt-get update -qq && sudo apt-get install -y vagrant"]],
    virtualbox: ["bash", ["-c", "sudo apt-get update -qq && sudo apt-get install -y virtualbox"]],
  },
  dnf: {
    vagrant: ["bash", ["-c", "sudo dnf install -y vagrant"]],
    virtualbox: ["bash", ["-c", "sudo dnf install -y VirtualBox"]],
  },
  pacman: {
    vagrant: ["bash", ["-c", "sudo pacman -S --noconfirm vagrant"]],
    virtualbox: ["bash", ["-c", "sudo pacman -S --noconfirm virtualbox virtualbox-host-modules-arch"]],
  },
};

async function handleInstallDeps(targets, pm) {
  if (!pm || !DEP_INSTALL_COMMANDS[pm]) {
    return { ok: false, steps: [{ target: "error", ok: false, message: `Unknown package manager: ${pm}` }] };
  }
  const commands = DEP_INSTALL_COMMANDS[pm];
  const steps = [];

  for (const target of targets) {
    if (!commands[target]) {
      steps.push({ target, ok: false, message: `No install command for ${target} via ${pm}` });
      continue;
    }
    const [cmd, args] = commands[target];
    const result = await runCommand(cmd, args);
    steps.push({
      target,
      ok: result.ok,
      message: result.ok
        ? `${target} installed via ${pm}`
        : (result.stderr || result.stdout || `Failed to install ${target}`),
    });
  }

  return { ok: steps.every((s) => s.ok), steps };
}

function parseEnvVars(raw) {
  const env = new Map();
  if (typeof raw !== "string") return env;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    // Avoid breaking scripts by embedding newlines.
    if (value.includes("\n") || value.includes("\r")) continue;
    env.set(key, value);
  }
  return env;
}

function escapeBashSingleQuoted(value) {
  // Wrap value in single quotes, escaping internal single quotes as:  'foo'\''bar'
  return `'${String(value).replace(/'/g, `'\''`)}'`;
}

function escapePowerShellSingleQuoted(value) {
  // PowerShell escapes single quote inside single-quoted string by doubling it.
  return `'${String(value).replace(/'/g, "''")}'`;
}

function envMapToBashAssignments(envMap) {
  const parts = [];
  for (const [k, v] of envMap.entries()) {
    parts.push(`${k}=${escapeBashSingleQuoted(v)}`);
  }
  return parts.join(" ");
}

function envMapToEnvFile(envMap) {
  let out = "";
  for (const [k, v] of envMap.entries()) {
    out += `${k}=${v}\n`;
  }
  return out;
}

function toWindowsPath(installDir) {
  if (typeof installDir !== "string") return "C:\\openclaw";
  const trimmed = installDir.trim();
  if (!trimmed.startsWith("/")) return trimmed.replaceAll("/", "\\");
  // Convert /opt/openclaw -> C:\opt\openclaw
  return `C:${trimmed.replaceAll("/", "\\")}`;
}

function ensureSseSend(res) {
  return (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

async function createTarGz(outPath, sourceRoot, sourceName) {
  return new Promise((resolve) => {
    const child = spawn("tar", ["-czf", outPath, "-C", sourceRoot, sourceName], {
      shell: false,
      stdio: "ignore",
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

function resolvePackagesDir() {
  // Primary output: install-ui/packages (current directory, no permission issues)
  // Fallback: ~/.openclaw/packages (for backward compatibility)
  const primary = join(import.meta.dirname || process.cwd(), "packages");
  const fallback = join(OPENCLAW_DIR, "packages");

  try {
    mkdirSync(primary, { recursive: true });
    return primary;
  } catch (err) {
    console.error(`Failed to create ${primary}: ${err.code} ${err.message}`);
  }

  try {
    mkdirSync(fallback, { recursive: true });
    return fallback;
  } catch (fallbackErr) {
    console.error(`Failed to create fallback ${fallback}: ${fallbackErr.code} ${fallbackErr.message}`);
    throw new Error(`Cannot create packages directory. Primary: ${primary} (${err?.message}), Fallback: ${fallback} (${fallbackErr.message})`);
  }
}

async function handlePackagerBuild(res, body = {}) {
  const send = ensureSseSend(res);
  try {
    send("step", { message: "Preparing build workspace..." });
    const targetsRaw = Array.isArray(body.targets) ? body.targets : [];
    const targets = Array.from(new Set(targetsRaw)).filter((t) => typeof t === "string");
    const envMap = parseEnvVars(body.envVars);
    const installDir = typeof body.installDir === "string" && body.installDir.trim().length > 0 ? body.installDir.trim() : "/opt/openclaw";
    const nodeVersion = typeof body.nodeVersion === "string" ? body.nodeVersion.trim() : "24";

    if (targets.length === 0) {
      send("done", { ok: false, message: "No targets selected." });
      res.end();
      return;
    }

    const bindMode = envMap.has("OPENCLAW_GATEWAY_TOKEN") || envMap.has("OPENCLAW_GATEWAY_PASSWORD") ? "lan" : "loopback";

    const { mkdirSync, writeFileSync, readFileSync, chmodSync } = await import("node:fs");

    const tmpRoot = join(tmpdir(), `openclaw-packager-${Date.now()}`);
    const pkgRoot = join(tmpRoot, "openclaw-installer");
    mkdirSync(pkgRoot, { recursive: true });

    const envFileContent = envMapToEnvFile(envMap);

    const writeExec = (path, content) => {
      writeFileSync(path, content, "utf-8");
      try {
        chmodSync(path, 0o755);
      } catch {
        /* ignore */
      }
    };

    send("progress", { percent: 10, line: `Generating installers for: ${targets.join(", ")}` });

    const projectInstallTemplatesDir = join(import.meta.dirname || process.cwd(), "vagrant");

    const vagrantSyncDir = "openclaw-state";
    const vagrantMemory = "4096";
    const vagrantCpus = "2";
    const vagrantGui = "false";
    const vagrantPort = "18789";

    // Create empty state dir marker for Vagrant synced folder.
    const ensureStateDir = () => {
      const p = join(pkgRoot, vagrantSyncDir);
      mkdirSync(p, { recursive: true });
      writeFileSync(join(p, ".keep"), "", "utf-8");
    };

    const dockerInstallScript = (prettyName) => `#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${installDir}"
PORT="18789"
BIND_MODE="${bindMode}"
OPENCLAW_IMAGE="openclaw/openclaw:latest"

echo "[OpenClaw Installer] ${prettyName}"
echo "Install dir: $INSTALL_DIR"

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

cat > "$INSTALL_DIR/openclaw.env" <<'EOF'
${envFileContent.trimEnd()}
EOF

if command -v docker >/dev/null 2>&1; then
  echo "Docker: already installed"
else
  echo "Installing Docker..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  else
    curl -fsSL https://get.docker.com | sh
  fi
fi

echo "Starting OpenClaw gateway container..."
docker rm -f openclaw >/dev/null 2>&1 || true

docker run -d --name openclaw --restart unless-stopped \\
  -p "$PORT:$PORT" \\
  -v "$INSTALL_DIR:/home/node/.openclaw" \\
  --env-file "$INSTALL_DIR/openclaw.env" \\
  "$OPENCLAW_IMAGE" \\
  node openclaw.mjs gateway --allow-unconfigured --bind "$BIND_MODE" --port "$PORT" >/dev/null

echo "Done."
echo "Gateway should be reachable on http://localhost:$PORT (bind=$BIND_MODE)"
`;

    const writeDockerBasedTarget = (targetId, prettyName) => {
      const dir = join(pkgRoot, targetId);
      mkdirSync(dir, { recursive: true });

      writeExec(join(dir, "install.sh"), dockerInstallScript(prettyName));
      writeFileSync(join(dir, "openclaw.env"), envFileContent, "utf-8");
      writeFileSync(
        join(dir, "README.txt"),
        `OpenClaw installer package for: ${prettyName}\n\n` +
          `1) Extract the archive\n` +
          `2) cd ${targetId}\n` +
          `3) chmod +x install.sh (if needed) && ./install.sh\n`,
        "utf-8",
      );
    };

    // Docker-based installers (host installs Docker, then runs the container)
    if (targets.includes("docker")) writeDockerBasedTarget("docker", "Docker target");
    if (targets.includes("redhat")) writeDockerBasedTarget("redhat", "Red Hat / CentOS target");
    if (targets.includes("uos")) writeDockerBasedTarget("uos", "统信 UOS target");
    if (targets.includes("ubuntukylin"))
      writeDockerBasedTarget("ubuntukylin", "优麒麟 Ubuntu Kylin target");

    // macOS installer (uses Homebrew or direct npm install)
    if (targets.includes("macos")) {
      const dir = join(pkgRoot, "macos");
      mkdirSync(dir, { recursive: true });

      const macosInstallScript = `#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${installDir}"
PORT="18789"
BIND_MODE="${bindMode}"

echo "[OpenClaw Installer] macOS"
echo "Install dir: $INSTALL_DIR"

# Detect chip type
if [ "$(uname -m)" = "arm64" ]; then
  CHIP="Apple Silicon"
else
  CHIP="Intel"
fi
echo "Chip: $CHIP"

# Check for Homebrew
if command -v brew >/dev/null 2>&1; then
  echo "Homebrew: found, installing via brew..."
  if brew list openclaw >/dev/null 2>&1; then
    echo "OpenClaw already installed via Homebrew, updating..."
    brew upgrade openclaw
  else
    echo "Installing OpenClaw via Homebrew..."
    brew install openclaw
  fi
else
  echo "Homebrew: not found, installing via npm..."
  # Ensure Node.js is installed (required for npm install)
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js not found. Please install Node.js first: https://nodejs.org/"
    exit 1
  fi
  
  # Check Node version
  NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -lt 22 ]; then
    echo "Node.js 22+ required. Current version: $(node -v)"
    echo "Please update Node.js: https://nodejs.org/"
    exit 1
  fi
  
  # Install via npm globally
  sudo npm install -g openclaw@latest
  
  # Approve builds if using pnpm
  if command -v pnpm >/dev/null 2>&1; then
    pnpm approve-builds -g 2>/dev/null || true
  fi
fi

mkdir -p "$INSTALL_DIR"
cat > "$INSTALL_DIR/openclaw.env" <<'EOF'
${envFileContent.trimEnd()}
EOF

echo "Running onboard..."
openclaw onboard --install-daemon --non-interactive --accept-risk 2>/dev/null || true

echo "Starting gateway..."
openclaw gateway --allow-unconfigured --bind "$BIND_MODE" --port "$PORT" &
sleep 2

echo "Done."
echo "Gateway should be reachable on http://localhost:$PORT (bind=$BIND_MODE)"
echo "Daemon installed and running."
`;

      writeExec(join(dir, "install.sh"), macosInstallScript);
      writeFileSync(join(dir, "openclaw.env"), envFileContent, "utf-8");
      writeFileSync(
        join(dir, "README.txt"),
        `OpenClaw installer package for macOS\n\n` +
          `1) Extract the archive\n` +
          `2) cd macos\n` +
          `3) chmod +x install.sh && ./install.sh\n\n` +
          `Requirements:\n` +
          `- Node.js 22+ (if not using Homebrew)\n` +
          `- Homebrew (optional, preferred method)\n` +
          `- sudo access (for npm global install)\n`,
        "utf-8",
      );
    }

    send("progress", { percent: 40, line: "Vagrant templates (Kali / Windows) packing..." });

    const generateVagrantKali = () => {
      ensureStateDir();
      const dir = join(pkgRoot, "vagrant-kali");
      mkdirSync(dir, { recursive: true });

      const templatePath = join(projectInstallTemplatesDir, "Vagrantfile.kali");
      if (!existsSync(templatePath)) {
        throw new Error(`Missing template: ${templatePath}`);
      }
      let vagrantfile = readFileSync(templatePath, "utf-8");

      vagrantfile = vagrantfile
        .replace(/__PORT__/g, vagrantPort)
        .replace(/__MEMORY__/g, vagrantMemory)
        .replace(/__CPUS__/g, vagrantCpus)
        .replace(/__GUI__/g, vagrantGui)
        .replace(/__SYNC_DIR__/g, vagrantSyncDir);

      vagrantfile = vagrantfile.replace(/setup_24\.x/g, `setup_${nodeVersion}.x`);

      const envAssignments = envMapToBashAssignments(envMap);
      if (envAssignments) {
        vagrantfile = vagrantfile.replace(
          /su - vagrant -c "openclaw onboard --install-daemon --non-interactive" \|\| true/g,
          `su - vagrant -c "env ${envAssignments} openclaw onboard --install-daemon --non-interactive" || true`,
        );
      }

      // Avoid any non-interactive risk prompt.
      vagrantfile = vagrantfile.replace(
        /openclaw onboard --install-daemon --non-interactive\b/g,
        "openclaw onboard --install-daemon --non-interactive --accept-risk",
      );

      writeFileSync(join(dir, "Vagrantfile"), vagrantfile, "utf-8");
      writeExec(
        join(dir, "run-vagrant.sh"),
        `#!/usr/bin/env bash
set -euo pipefail

# Get the directory where this script is located (works with bash, zsh, and via source)
_get_script_dir() {
  local source="\${BASH_SOURCE[0]:-\${0}}"
  while [ -L "$source" ]; do
    local dir="$(cd -P "$(dirname "$source")" && pwd)"
    source="$(readlink "$source")"
    [[ $source != /* ]] && source="$dir/$source"
  done
  cd -P "$(dirname "$source")" && pwd
}

DIR="$(_get_script_dir)"
cd "$DIR"

if ! command -v vagrant >/dev/null 2>&1; then
  echo "Missing vagrant on host. Please install Vagrant."
  exit 1
fi
if ! command -v VBoxManage >/dev/null 2>&1; then
  echo "Missing VirtualBox (VBoxManage) on host."
  exit 1
fi

vagrant up
`,
      );
      writeFileSync(
        join(dir, "README.txt"),
        `Vagrant Kali target.\n\n` +
          `This package includes a Vagrantfile that installs OpenClaw inside the VM.\n` +
          `Extract, then run: ./run-vagrant.sh\n`,
        "utf-8",
      );
    };

    const generateVagrantWindows = () => {
      const dir = join(pkgRoot, "vagrant-windows");
      mkdirSync(dir, { recursive: true });

      const templatePath = join(projectInstallTemplatesDir, "Vagrantfile.windows");
      if (!existsSync(templatePath)) {
        throw new Error(`Missing template: ${templatePath}`);
      }
      let vagrantfile = readFileSync(templatePath, "utf-8");

      vagrantfile = vagrantfile
        .replace(/__PORT__/g, vagrantPort)
        .replace(/__MEMORY__/g, vagrantMemory)
        .replace(/__CPUS__/g, vagrantCpus)
        .replace(/__GUI__/g, vagrantGui);

      // Node MSI names are pinned in the template (v24.0.0). Replace with the requested major baseline.
      vagrantfile = vagrantfile.replace(/v24\.0\.0/g, `v${nodeVersion}.0.0`);
      vagrantfile = vagrantfile.replace(/node-v24\.0\.0-x64\.msi/g, `node-v${nodeVersion}.0.0-x64.msi`);

      const windowsOpenclawHome = toWindowsPath(installDir);
      const envAssignmentsPsLines = [];
      for (const [k, v] of envMap.entries()) {
        envAssignmentsPsLines.push(`$env:${k}=${escapePowerShellSingleQuoted(v)}`);
      }

      const envAssignmentsPs = envAssignmentsPsLines.join("\n");

      // Inject env vars + OPENCLAW_HOME + onboard + bind lan in the provisioning script.
      const onboardingBlock = [
        `    # Configure built-in environment variables`,
        envAssignmentsPs ? envAssignmentsPs.split("\n").map((l) => `    ${l}`).join("\n") : `    # (No built-in env vars provided)`,
        `    $env:OPENCLAW_HOME=${escapePowerShellSingleQuoted(windowsOpenclawHome)}`,
        `    $env:OPENCLAW_STATE_DIR=Join-Path $env:OPENCLAW_HOME ".openclaw"`,
        `    $env:OPENCLAW_CONFIG_PATH=Join-Path $env:OPENCLAW_STATE_DIR "openclaw.json"`,
        ``,
        `    Write-Host "Running OpenClaw onboard..."`,
        `    openclaw onboard --install-daemon --non-interactive --accept-risk`,
        ``,
        `    Write-Host "Starting gateway (bind=lan, port=${vagrantPort})..."`,
        `    Start-Process -FilePath "openclaw" -ArgumentList @("gateway","--allow-unconfigured","--bind","lan","--port","${vagrantPort}","--force") -NoNewWindow -PassThru | Out-Null`,
      ].join("\n");

      vagrantfile = vagrantfile.replace(
        /npm install -g openclaw@latest\s*\n\n\s*Write-Host ""/,
        `npm install -g openclaw@latest\n\n${onboardingBlock}\n\n    Write-Host ""`,
      );

      writeFileSync(join(dir, "Vagrantfile"), vagrantfile, "utf-8");
      writeExec(
        join(dir, "run-vagrant.sh"),
        `#!/usr/bin/env bash
set -euo pipefail

# Get the directory where this script is located (works with bash, zsh, and via source)
_get_script_dir() {
  local source="\${BASH_SOURCE[0]:-\${0}}"
  while [ -L "$source" ]; do
    local dir="$(cd -P "$(dirname "$source")" && pwd)"
    source="$(readlink "$source")"
    [[ $source != /* ]] && source="$dir/$source"
  done
  cd -P "$(dirname "$source")" && pwd
}

DIR="$(_get_script_dir)"
cd "$DIR"

if ! command -v vagrant >/dev/null 2>&1; then
  echo "Missing vagrant on host. Please install Vagrant."
  exit 1
fi
if ! command -v VBoxManage >/dev/null 2>&1; then
  echo "Missing VirtualBox (VBoxManage) on host."
  exit 1
fi

vagrant up
`,
      );
      writeFileSync(
        join(dir, "README.txt"),
        `Vagrant Windows target (Windows 10 VM).\n\n` +
          `This package provisions a Windows 10 VM that installs OpenClaw and starts the gateway.\n` +
          `Extract, then run: ./run-vagrant.sh\n`,
        "utf-8",
      );
    };

    if (targets.includes("vagrant-kali")) {
      send("progress", { percent: 60, line: "Packaging Vagrant Kali VM..." });
      await generateVagrantKali();
    }
    if (targets.includes("vagrant-windows")) {
      send("progress", { percent: 70, line: "Packaging Vagrant Windows VM..." });
      await generateVagrantWindows();
    }

    send("progress", { percent: 75, line: "Packaging Windows host installers..." });

    const generateWindowsHost = (targetId, msiArch, prettyName) => {
      const dir = join(pkgRoot, targetId);
      mkdirSync(dir, { recursive: true });

      const windowsOpenclawHome = toWindowsPath(installDir);

      const envAssignmentsPsLines = [];
      for (const [k, v] of envMap.entries()) {
        envAssignmentsPsLines.push(`$env:${k}=${escapePowerShellSingleQuoted(v)}`);
      }
      const envAssignmentsPs = envAssignmentsPsLines.join("\n");

      const nodeMajor = nodeVersion;
      const nodeFull = `${nodeMajor}.0.0`;
      const nodeMsiUrl = `https://nodejs.org/dist/v${nodeFull}/node-v${nodeFull}-${msiArch}.msi`;

      const installScript = [
        `# OpenClaw Windows Installer (${prettyName})`,
        `$ErrorActionPreference = "Stop"`,
        `Set-Location $PSScriptRoot`,
        ``,
        `function Set-EnvFromBakedFile {`,
        `  # Baked env vars are directly embedded into this script.`,
        `}`,
        ``,
        `Write-Host "Install dir: ${windowsOpenclawHome}"`,
        `$env:OPENCLAW_HOME=${escapePowerShellSingleQuoted(windowsOpenclawHome)}`,
        `$env:OPENCLAW_STATE_DIR=Join-Path $env:OPENCLAW_HOME ".openclaw"`,
        `$env:OPENCLAW_CONFIG_PATH=Join-Path $env:OPENCLAW_STATE_DIR "openclaw.json"`,
        `New-Item -ItemType Directory -Path $env:OPENCLAW_HOME -Force | Out-Null`,
        `New-Item -ItemType Directory -Path $env:OPENCLAW_STATE_DIR -Force | Out-Null`,
        `$env:HOME=$env:OPENCLAW_HOME`,
        ``,
        envAssignmentsPs ? envAssignmentsPs : `# (No built-in env vars provided)`,
        ``,
        `Write-Host "Downloading Node.js MSI..."`,
        `$nodeInstaller=Join-Path $env:TEMP "node-openclaw-${targetId}.msi"`,
        `Invoke-WebRequest -Uri "${nodeMsiUrl}" -OutFile $nodeInstaller -UseBasicParsing`,
        `Start-Process msiexec.exe -ArgumentList "/i", $nodeInstaller, "/quiet", "/norestart" -Wait -NoNewWindow`,
        `Remove-Item $nodeInstaller -Force`,
        ``,
        `Write-Host "Installing OpenClaw..."`,
        `npm install -g openclaw@latest`,
        ``,
        `Write-Host "Running OpenClaw onboard (non-interactive)..."`,
        `openclaw onboard --install-daemon --non-interactive --accept-risk`,
        ``,
        `Write-Host "Starting gateway..."`,
        `powershell -ExecutionPolicy Bypass -NoProfile -File ".\\run-openclaw.ps1" | Out-Null`,
        ``,
        `Write-Host "Done. Gateway expected on http://localhost:18789 (check logs if needed)."`,
      ].join("\n");

      const runScript = [
        `# OpenClaw run script (${prettyName})`,
        `$ErrorActionPreference = "Stop"`,
        `Set-Location $PSScriptRoot`,
        ``,
        `$env:OPENCLAW_HOME=${escapePowerShellSingleQuoted(windowsOpenclawHome)}`,
        `$env:OPENCLAW_STATE_DIR=Join-Path $env:OPENCLAW_HOME ".openclaw"`,
        `$env:OPENCLAW_CONFIG_PATH=Join-Path $env:OPENCLAW_STATE_DIR "openclaw.json"`,
        `$env:HOME=$env:OPENCLAW_HOME`,
        `New-Item -ItemType Directory -Path $env:OPENCLAW_STATE_DIR -Force | Out-Null`,
        ``,
        envAssignmentsPs ? envAssignmentsPs : `# (No built-in env vars provided)`,
        ``,
        `Write-Host "Starting gateway (bind=${bindMode}, port=18789)..."`,
        `Start-Process -FilePath "openclaw" -ArgumentList @("gateway","--allow-unconfigured","--bind","${bindMode}","--port","18789","--force") -NoNewWindow -PassThru | Out-Null`,
      ].join("\n");

      writeFileSync(join(dir, "install.ps1"), installScript, "utf-8");
      writeFileSync(join(dir, "run-openclaw.ps1"), runScript, "utf-8");
      writeFileSync(
        join(dir, "README.txt"),
        `Windows host target: ${prettyName}\n\n` +
          `1) Extract the archive\n` +
          `2) In this folder, run: powershell -ExecutionPolicy Bypass -File .\\install.ps1\n`,
        "utf-8",
      );
    };

    if (targets.includes("windows-x64")) {
      generateWindowsHost("windows-x64", "x64", "Windows 10 x64");
    }
    if (targets.includes("windows-x86")) {
      generateWindowsHost("windows-x86", "x86", "Windows 10 x86");
    }

    send("progress", { percent: 90, line: "Archiving into a downloadable package..." });

    const packagesDir = resolvePackagesDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const targetsKey = targets.slice().sort().join("-");
    const outName = `openclaw-installer-${targetsKey}-${stamp}.tar.gz`;
    const outPath = join(packagesDir, outName);

    const tarOk = await createTarGz(outPath, tmpRoot, "openclaw-installer");
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    if (!tarOk) {
      send("done", { ok: false, message: "Failed to archive installer package." });
      res.end();
      return;
    }

    send("done", { ok: true, message: `Package created: ${outName}` });
    res.end();
  } catch (err) {
    send("done", { ok: false, message: err instanceof Error ? err.message : String(err) });
    res.end();
  }
}

// ─── HTTP Server ─────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const json = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  try {
    if (req.url === "/api/env-check" && req.method === "GET") {
      json(200, await runChecks());
      return;
    }

    if (req.url === "/api/install/preflight" && req.method === "GET") {
      json(200, await preflightCheck());
      return;
    }

    if (req.url === "/api/install" && req.method === "POST") {
      const body = await readBody(req);
      if (!body.method) { json(400, { error: "method required" }); return; }
      // Use SSE streaming for all methods
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      if (body.method === "vagrant") {
        await handleVagrantStreamInstall(res, body.options || {});
      } else {
        await handleStreamInstall(res, body.method, body.options || {});
      }
      return;
    }

    if (req.url === "/api/docker/mirrors" && req.method === "GET") {
      json(200, { mirrors: DOCKER_MIRRORS });
      return;
    }

    if (req.url === "/api/install/deps" && req.method === "POST") {
      const body = await readBody(req);
      const targets = body.targets || []; // ["vagrant", "virtualbox"]
      const pm = body.packageManager || null;
      json(200, await handleInstallDeps(targets, pm));
      return;
    }

    if (req.url === "/api/install/vagrant/stream" && req.method === "POST") {
      const body = await readBody(req);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      await handleVagrantStreamInstall(res, body.options || {});
      return;
    }

    if (req.url === "/api/uninstall" && req.method === "POST") {
      const body = await readBody(req);
      const method = body.method || "all";
      const removeData = body.removeData === true;
      json(200, await handleUninstall(method, { removeData }));
      return;
    }

    // ─── Packager: build installer packages ──────────────────────────
    if (req.url === "/api/packager/build" && req.method === "POST") {
      const body = await readBody(req);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      await handlePackagerBuild(res, body);
      return;
    }

    if (req.url?.startsWith("/api/packager/download/") && req.method === "GET") {
      const filename = req.url.split("/api/packager/download/")[1];
      const filePath = join(resolvePackagesDir(), decodeURIComponent(filename));
      if (!existsSync(filePath)) {
        json(404, { error: "Package not found" });
        return;
      }
      const { createReadStream, statSync: ss } = await import("node:fs");
      const stat = ss(filePath);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": stat.size,
        "Access-Control-Allow-Origin": "*",
      });
      createReadStream(filePath).pipe(res);
      return;
    }

    if (req.url === "/api/packager/list" && req.method === "GET") {
      const pkgDir = resolvePackagesDir();
      const packages = [];
      if (existsSync(pkgDir)) {
        const { readdirSync, statSync: ss } = await import("node:fs");
        for (const f of readdirSync(pkgDir)) {
          const fp = join(pkgDir, f);
          const st = ss(fp);
          packages.push({ name: f, size: st.size, created: st.mtime.toISOString() });
        }
      }
      json(200, { packages });
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    json(500, { error: String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`OpenClaw Install API running at http://localhost:${PORT}`);
  console.log(`  GET  /api/env-check        — environment detection`);
  console.log(`  GET  /api/install/preflight — install method availability`);
  console.log(`  POST /api/install           — install openclaw { method }`);
  console.log(`  POST /api/uninstall         — uninstall openclaw { method, removeData }`);
});
