#!/usr/bin/env node
/**
 * start.mjs — 前后端融合启动脚本
 *
 * 开发模式:  node start.mjs          → 并发启动 API(3456) + Vite UI(5173)
 * 生产模式:  node start.mjs --prod   → pnpm build，再由 API 单端口(3456)同时提供前端
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.argv.includes("--prod");

// ─── ANSI 颜色 ───────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  api:    "\x1b[36m",   // 青色  — API 进程
  ui:     "\x1b[35m",   // 紫色  — Vite UI 进程
  sys:    "\x1b[33m",   // 黄色  — 系统消息
  ok:     "\x1b[32m",   // 绿色  — 成功
  err:    "\x1b[31m",   // 红色  — 错误
};

function prefix(tag, color) {
  return `${color}${C.bold}[${tag}]${C.reset}`;
}

function printLines(tag, color, chunk) {
  for (const raw of chunk.toString().split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim()) process.stdout.write(`${prefix(tag, color)} ${line}\n`);
  }
}

function runProcess(tag, color, cmd, args) {
  const child = spawn(cmd, args, {
    shell: true,
    cwd: __dirname,
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  child.stdout?.on("data", (d) => printLines(tag, color, d));
  child.stderr?.on("data", (d) => printLines(tag, color, d));
  return child;
}

function banner() {
  console.log(`\n${C.bold}${C.sys}╔═══════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.sys}║      OpenClaw Installer — Launcher    ║${C.reset}`);
  console.log(`${C.bold}${C.sys}╚═══════════════════════════════════════╝${C.reset}\n`);
}

// ─── 生产模式 ─────────────────────────────────────────────────────────
if (isProd) {
  banner();
  console.log(`${C.sys}${C.bold}[start]${C.reset} 模式: ${C.bold}生产 (--prod)${C.reset}`);
  console.log(`${C.sys}${C.bold}[start]${C.reset} 构建前端... (pnpm run build)\n`);

  const build = spawn("pnpm", ["run", "build"], {
    shell: true,
    cwd: __dirname,
    stdio: "inherit",
  });

  build.on("close", (code) => {
    if (code !== 0) {
      console.error(`\n${C.err}${C.bold}[start]${C.reset} 前端构建失败 (exit ${code})`);
      process.exit(1);
    }

    console.log(`\n${C.ok}${C.bold}[start]${C.reset} 构建完成 ✓`);
    console.log(`${C.api}${C.bold}[start]${C.reset} 启动服务器 → ${C.bold}http://localhost:3456${C.reset}\n`);

    const api = runProcess("API", C.api, "node", ["server.mjs"]);

    const cleanup = () => { api.kill(); process.exit(0); };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    api.on("close", (c) => {
      if (c !== null && c !== 0) {
        console.error(`${C.err}${C.bold}[API]${C.reset} 进程退出 (code ${c})`);
        process.exit(c);
      }
    });
  });

// ─── 开发模式 ─────────────────────────────────────────────────────────
} else {
  banner();
  console.log(`${C.sys}${C.bold}[start]${C.reset} 模式: ${C.bold}开发 (dev)${C.reset}`);
  console.log(`${C.api}${C.bold}[start]${C.reset} API  → ${C.bold}http://localhost:3456${C.reset}`);
  console.log(`${C.ui}${C.bold}[start]${C.reset} UI   → ${C.bold}http://localhost:5173${C.reset}`);
  console.log(`${C.dim}         前端通过 vite proxy 将 /api/* 转发到后端${C.reset}\n`);

  const api = runProcess("API", C.api, "node", ["server.mjs"]);
  const ui  = runProcess("UI ", C.ui,  "pnpm", ["run", "dev"]);

  const cleanup = () => {
    api.kill();
    ui.kill();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  api.on("close", (code) => {
    if (code !== null && code !== 0) {
      printLines("start", C.err, `API 进程意外退出 (code ${code})，正在关闭 UI...`);
      ui.kill();
      process.exit(1);
    }
  });

  ui.on("close", (code) => {
    if (code !== null && code !== 0) {
      printLines("start", C.err, `Vite UI 进程意外退出 (code ${code})，正在关闭 API...`);
      api.kill();
      process.exit(1);
    }
  });
}
