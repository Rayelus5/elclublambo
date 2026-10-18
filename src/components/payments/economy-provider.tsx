"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { EconomyConfig } from "@/lib/economy/config";

/** The economy config plus the session wallet and member id, which the server resolves (never read from the connected wallet). */
export type EconomyContextValue = EconomyConfig & { wallet: string; memberId: string };

const EconomyContext = createContext<EconomyContextValue | null>(null);

export function EconomyProvider({ config, wallet, memberId, children }: { config: EconomyConfig; wallet: string; memberId: string; children: ReactNode }) {
  return <EconomyContext value={{ ...config, wallet, memberId }}>{children}</EconomyContext>;
}

/** Same as useEconomy, but null outside a provider (components that also render without the economy). */
export function useOptionalEconomy(): EconomyContextValue | null {
  return useContext(EconomyContext);
}

export function useEconomy(): EconomyContextValue {
  const v = useContext(EconomyContext);
  if (!v) throw new Error("useEconomy debe usarse dentro de <EconomyProvider>");
  return v;
}
