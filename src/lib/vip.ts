import { createContext, useContext } from "react";

export interface VipState {
  active: boolean;
  expiresAt: string | null; // ISO date string
}

export interface VipContextValue {
  vip: VipState;
  activate: (months: number, outTradeNo?: string, amount?: number) => Promise<void>;
  resetVip: () => void;
  reloadVip: () => Promise<VipState>;
  isExpired: () => boolean;
  isExpiringSoon: () => boolean;
  daysRemaining: () => number;
  adminUnlocked: boolean;
  setAdminUnlocked: (v: boolean) => void;
}

export const VipContext = createContext<VipContextValue>({
  vip: { active: false, expiresAt: null },
  activate: async () => {},
  resetVip: () => {},
  reloadVip: async () => ({ active: false, expiresAt: null }),
  isExpired: () => false,
  isExpiringSoon: () => false,
  daysRemaining: () => 0,
  adminUnlocked: false,
  setAdminUnlocked: () => {},
});

export function useVip() {
  return useContext(VipContext);
}

// Load VIP state from SQLite via Electron IPC
export async function loadVipState(): Promise<VipState> {
  try {
    return await window.electronAPI.dbVipGet();
  } catch {
    return { active: false, expiresAt: null };
  }
}

// Activate VIP via SQLite
export async function activateVipDb(months: number, outTradeNo?: string, amount?: number): Promise<VipState> {
  return await window.electronAPI.dbVipActivate(months, outTradeNo, amount);
}

// Reset VIP via SQLite
export async function resetVipDb(): Promise<VipState> {
  return await window.electronAPI.dbVipReset();
}
