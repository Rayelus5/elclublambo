"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const KEY = "elclub:rail-collapsed";

type RailState = { collapsed: boolean; setCollapsed: (v: boolean) => void };
const RailContext = createContext<RailState>({ collapsed: false, setCollapsed: () => {} });

export const useRail = () => useContext(RailContext);

// The folded state lives in localStorage (per browser); when storage is unavailable it is kept in memory for the visit.
const listeners = new Set<() => void>();
let memory: boolean | null = null;

function readCollapsed(): boolean {
  if (memory !== null) return memory;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
    memory = null;
  } catch {
    memory = v;
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/**
 * The forum's three-column grid. The right rail can be folded to a thin strip (remembered per browser), which gives
 * its width back to the content. The server renders it expanded.
 */
export function ShellGrid({ children }: { children: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  return (
    <RailContext.Provider value={{ collapsed, setCollapsed: writeCollapsed }}>
      <div
        className={cn(
          "grid min-h-dvh flex-1 grid-cols-1 grid-rows-[auto_1fr] md:grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[264px_minmax(0,1fr)]",
          collapsed ? "lg:grid-cols-[264px_minmax(0,1fr)_3rem]" : "lg:grid-cols-[264px_minmax(0,1fr)_320px]",
        )}
      >
        {children}
      </div>
    </RailContext.Provider>
  );
}
