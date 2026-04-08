const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Window controls
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  toTray: () => ipcRenderer.send("window:toTray"),

  // Shell execution
  exec: (command, cwd) => ipcRenderer.invoke("shell:exec", command, cwd),
  spawn: (options) => ipcRenderer.invoke("shell:spawn", options),
  openTerminal: (command) => ipcRenderer.invoke("shell:openTerminal", command),
  addToPath: (customPath) => ipcRenderer.invoke("shell:addToPath", customPath),
  which: (cmd) => ipcRenderer.invoke("shell:which", cmd),
  resolveOpenClaw: () => ipcRenderer.invoke("shell:resolveOpenClaw"),
  installWindowsToolchain: () => ipcRenderer.invoke("windows:installToolchain"),
  installWindowsOpenClaw: (installPath) => ipcRenderer.invoke("windows:installOpenClaw", { installPath }),

  // Sandbox one-click install
  sandboxOneClickInstall: (options) => ipcRenderer.invoke("sandbox:oneClickInstall", options),
  sandboxStatus: () => ipcRenderer.invoke("sandbox:status"),
  onSandboxOutput: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("sandbox:output", listener);
    return () => ipcRenderer.removeListener("sandbox:output", listener);
  },
  onSandboxProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("sandbox:progress", listener);
    return () => ipcRenderer.removeListener("sandbox:progress", listener);
  },

  // Gateway service (Task Scheduler)
  serviceRegister: (config) => ipcRenderer.invoke("service:register", config),
  serviceUnregister: () => ipcRenderer.invoke("service:unregister"),
  serviceStatus: () => ipcRenderer.invoke("service:status"),

  onShellOutput: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("shell:output", listener);
    return () => ipcRenderer.removeListener("shell:output", listener);
  },

  // Gateway service management
  gatewayStart: (config) => ipcRenderer.invoke("gateway:start", config),
  gatewayStop: () => ipcRenderer.invoke("gateway:stop"),
  gatewaySuspend: () => ipcRenderer.invoke("gateway:suspend"),
  gatewayResume: () => ipcRenderer.invoke("gateway:resume"),
  gatewayGetStatus: () => ipcRenderer.invoke("gateway:getStatus"),
  gatewaySystemCheck: () => ipcRenderer.invoke("gateway:systemCheck"),
  onGatewayOutput: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("gateway:output", listener);
    return () => ipcRenderer.removeListener("gateway:output", listener);
  },
  onGatewayStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("gateway:status", listener);
    return () => ipcRenderer.removeListener("gateway:status", listener);
  },

  // Clipboard
  copyToClipboard: (text) => ipcRenderer.invoke("clipboard:copy", text),

  // System info
  getSystemInfo: () => ipcRenderer.invoke("system:info"),

  // Agent management
  listAgents: () => ipcRenderer.invoke("agents:list"),
  exportAgents: (options) => ipcRenderer.invoke("agents:export", options),

  // Dialogs
  showSaveDialog: (options) => ipcRenderer.invoke("dialog:save", options),
  showFolderDialog: (options) => ipcRenderer.invoke("dialog:openFolder", options),

  // Database - VIP
  dbVipGet: () => ipcRenderer.invoke("db:vip:get"),
  dbVipActivate: (months, outTradeNo, amount) =>
    ipcRenderer.invoke("db:vip:activate", { months, outTradeNo, amount }),
  dbVipReset: () => ipcRenderer.invoke("db:vip:reset"),

  // Database - Config (key-value)
  dbConfigGet: (key) => ipcRenderer.invoke("db:config:get", key),
  dbConfigSet: (key, value) => ipcRenderer.invoke("db:config:set", { key, value }),
  dbConfigDelete: (key) => ipcRenderer.invoke("db:config:delete", key),
  dbConfigGetAll: () => ipcRenderer.invoke("db:config:getAll"),

  // Database - Orders
  dbOrderSave: (outTradeNo, amount, description) =>
    ipcRenderer.invoke("db:order:save", { outTradeNo, amount, description }),
  dbOrderUpdateStatus: (outTradeNo, status) =>
    ipcRenderer.invoke("db:order:updateStatus", { outTradeNo, status }),
  dbOrderGet: (outTradeNo) => ipcRenderer.invoke("db:order:get", outTradeNo),

  // Database - Debug
  dbGetPath: () => ipcRenderer.invoke("db:getPath"),

  // Local config (banben.json bundled in assets)
  readLocalConfig: () => ipcRenderer.invoke("config:readLocal"),

  // App version & auto-update
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  checkUpdate: () => ipcRenderer.invoke("app:checkUpdate"),
  downloadUpdate: (downloadUrl) => ipcRenderer.invoke("app:downloadUpdate", downloadUrl),
  restartApp: () => ipcRenderer.invoke("app:restartApp"),
  openVersionsPage: () => ipcRenderer.invoke("app:openVersionsPage"),
  onUpdateProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("update:progress", listener);
    return () => ipcRenderer.removeListener("update:progress", listener);
  },

  // OpenClaw CLI self-update
  ocCheckUpdate: () => ipcRenderer.invoke("openclaw:checkUpdate"),
  ocInstall: () => ipcRenderer.invoke("openclaw:install"),
  onOcUpdateOutput: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on("openclaw:updateOutput", listener);
    return () => ipcRenderer.removeListener("openclaw:updateOutput", listener);
  },

  // WeChat (openclaw-weixin) channel
  weixinInstallPlugin: () => ipcRenderer.invoke("weixin:installPlugin"),
  onWeixinOutput: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on("weixin:output", listener);
    return () => ipcRenderer.removeListener("weixin:output", listener);
  },
  weixinGetQrcode: () => ipcRenderer.invoke("weixin:getQrcode"),
  weixinPollStatus: (qrcode) => ipcRenderer.invoke("weixin:pollStatus", qrcode),

  // WeChat Pay
  payCreateOrder: (amount, description) =>
    ipcRenderer.invoke("pay:createOrder", { amount, description }),
  payCheckStatus: (outTradeNo) =>
    ipcRenderer.invoke("pay:checkStatus", outTradeNo),
});
