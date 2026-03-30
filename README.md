# OpenClaw Installer UI

A modern, user-friendly web interface for installing and managing OpenClaw on your system.

[English](#english) | [中文](#中文)

## English

### Overview

OpenClaw Installer UI provides a graphical interface for:

- **Environment Detection**: Check if your system meets the requirements for running OpenClaw
- **One-Click Installation**: Install OpenClaw using various methods:
  - Installation Script (macOS/Linux)
  - npm/pnpm Global Install
  - Docker Container
  - Vagrant Virtual Machine
  - Build from Source
- **Package Builder**: Generate installer packages for different platforms
- **Provider Configuration**: Configure AI model providers
- **Model Management**: Manage and discover available AI models

### Features

- 🌐 **Bilingual Support**: Full Chinese and English interface
- 🇨🇳 **China-Optimized**: Includes mirrors and accelerators for users in China
- 📊 **Real-time Progress**: Live installation progress and logs
- 🔧 **Advanced Options**: Customizable installation settings
- 💻 **Cross-Platform**: Supports macOS, Linux, and Windows (via WSL/Vagrant)

### Quick Start

```bash
# Install dependencies
npm install

# Start the development server
npm run dev

# Build for production
npm run build
```

### Requirements

- Node.js 22.14.0 or higher (Node 24 recommended)
- npm, pnpm, or bun package manager
- For Docker installation: Docker Desktop
- For Vagrant installation: Vagrant + VirtualBox

### Project Structure

```
install-ui/
├── src/
│   ├── components/      # React components
│   ├── i18n/           # Internationalization
│   ├── api.ts          # API client
│   ├── store.ts        # State management
│   └── App.tsx         # Main application
├── server.mjs          # Backend API server
├── package.json
└── vite.config.ts
```

### API Endpoints

- `GET /api/install/preflight` - Check installation method availability
- `POST /api/install` - Install OpenClaw
- `POST /api/uninstall` - Uninstall OpenClaw
- `POST /api/packager/build` - Build installer packages
- `GET /api/env-check` - Environment detection

## 中文

### 简介

OpenClaw 安装器 UI 是一个现代化的 Web 界面，用于在您的系统上安装和管理 OpenClaw。

### 功能特点

- 🌐 **双语支持**：完整的中文和英文界面
- 🇨🇳 **中国优化**：包含中国镜像和加速器
- 📊 **实时进度**：实时显示安装进度和日志
- 🔧 **高级选项**：可自定义安装设置
- 💻 **跨平台**：支持 macOS、Linux 和 Windows（通过 WSL/Vagrant）

### 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 生产环境构建
npm run build
```

### 系统要求

- Node.js 22.14.0 或更高版本（推荐 Node 24）
- npm、pnpm 或 bun 包管理器
- Docker 安装需要：Docker Desktop
- Vagrant 安装需要：Vagrant + VirtualBox

### 安装方式

1. **安装脚本**：自动检测操作系统，按需安装 Node
2. **npm/pnpm 全局安装**：通过包管理器安装
3. **Docker 容器**：在隔离容器中运行
4. **Vagrant 虚拟机**：创建完整的虚拟机环境
5. **源码构建**：克隆并从源码构建

### 中国镜像加速

- Docker 镜像：DaoCloud、阿里云、USTC
- Git 克隆：ghproxy.com
- Vagrant Box：USTC 镜像

### 许可证

MIT License
