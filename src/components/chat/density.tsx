"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { AlignJustify, Rows3 } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

export type ChatDensity = "standard" | "compact";

type DensityState = { density: ChatDensity; setDensity: (d: ChatDensity) => void };
const DensityContext = createContext<DensityState>({ density: "standard", setDensity: () => {} });

/** The member's chat density for every text channel (stored on the member: it follows them across devices). */
export function ChatDensityProvider({ initial, children }: { initial: ChatDensity; children: ReactNode }) {
  const [density, setLocal] = useState<ChatDensity>(initial);
  const setDensity = (next: ChatDensity) => {
    const previous = density;
    setLocal(next);
    void Promise.resolve(createBrowserClient().rpc("set_chat_density", { p_density: next }))
      .then(({ error }) => {
        if (error) setLocal(previous);
      })
      .catch(() => setLocal(previous));
  };
  return <DensityContext.Provider value={{ density, setDensity }}>{children}</DensityContext.Provider>;
}

export const useChatDensity = () => useContext(DensityContext);

const OPTIONS: { value: ChatDensity; label: string; Icon: typeof Rows3 }[] = [
  { value: "standard", label: "Estándar", Icon: Rows3 },
  { value: "compact", label: "Compacto", Icon: AlignJustify },
];

/** Standard / compact switch, the same in any text channel and in the profile settings. */
export function DensityToggle({ className, showLabels = true }: { className?: string; showLabels?: boolean }) {
  const { density, setDensity } = useChatDensity();
  return (
    <div role="radiogroup" aria-label="Densidad del chat" className={cn("inline-flex gap-1 rounded-control border border-border-strong p-1", className)}>
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={density === value}
          aria-label={showLabels ? undefined : label}
          title={label}
          onClick={() => setDensity(value)}
          className={cn(
            "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-control px-2 text-[13px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent",
            density === value ? "bg-accent-fill text-accent-fill-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          <Icon aria-hidden className="size-4" />
          {showLabels ? label : null}
        </button>
      ))}
    </div>
  );
}
