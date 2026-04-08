import { createContext, useContext } from "react";

/** Shape of a single payment plan in banben.json */
export interface PayPlan {
  name: string;
  price: number;
  unit: string;
  description: string;
  enabled: boolean;
}

/** Shape of the full remote config (banben.json) */
export interface RemoteConfig {
  version: string;
  plans: {
    monthly: PayPlan;
    install: PayPlan;
  };
  updatedAt: string;
}

/** Default values (used before first fetch or on error) */
export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  version: "1.0.2",
  plans: {
    monthly: { name: "月度订阅", price: 49, unit: "月", description: "OpenClaw VIP 月度会员", enabled: true },
    install: { name: "上门安装", price: 499, unit: "次", description: "OpenClaw 上门安装服务", enabled: false },
  },
  updatedAt: "",
};

const CONFIG_URL = "http://120.27.16.1/banben.json";
const POLL_INTERVAL = 30 * 60 * 1000; // 30 minutes

/** Fetch config from bundled local assets/banben.json via Electron IPC */
export async function fetchLocalConfig(): Promise<RemoteConfig | null> {
  try {
    if (typeof window !== "undefined" && window.electronAPI?.readLocalConfig) {
      return await window.electronAPI.readLocalConfig();
    }
    return null;
  } catch {
    return null;
  }
}

/** Fetch latest remote config; returns null on failure */
export async function fetchRemoteConfig(): Promise<RemoteConfig | null> {
  try {
    const res = await fetch(`${CONFIG_URL}?t=${Date.now()}`);
    if (!res.ok) return null;
    const data = await res.json();
    // Basic validation
    if (data && data.version && data.plans) return data as RemoteConfig;
    return null;
  } catch {
    return null;
  }
}

/** Start a 30-minute polling loop; returns a cleanup function */
export function startConfigPolling(onUpdate: (cfg: RemoteConfig) => void): () => void {
  const timer = setInterval(async () => {
    const cfg = await fetchRemoteConfig();
    if (cfg) onUpdate(cfg);
  }, POLL_INTERVAL);
  return () => clearInterval(timer);
}

// ─── React Context ──────────────────────────────────────────────────────────

export const RemoteConfigContext = createContext<RemoteConfig>(DEFAULT_REMOTE_CONFIG);

export function useRemoteConfig() {
  return useContext(RemoteConfigContext);
}
