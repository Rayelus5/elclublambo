"use client";

import { useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setChannelFollowAction } from "@/lib/notifications/actions";
import { rpcErrorMessage } from "@/lib/errors";

export type FollowLevel = "all" | "mentions" | "mute";

const LEVELS: Array<{ id: FollowLevel; label: string; short: string; Icon: typeof Bell }> = [
  { id: "all", label: "Todos los mensajes", short: "todos los mensajes", Icon: BellRing },
  { id: "mentions", label: "Solo menciones", short: "solo menciones", Icon: Bell },
  { id: "mute", label: "Silenciar", short: "silenciado", Icon: BellOff },
];

/**
 * Per-channel follow level. `level` is the effective one (own preference, else the channel default); `null` means it
 * could not be loaded, and an error is shown instead of a default that may not be the real setting.
 */
export function FollowMenu({ channelId, level }: { channelId: string; level: FollowLevel | null }) {
  const [current, setCurrent] = useState<FollowLevel | null>(level);
  const [error, setError] = useState<string | null>(null);

  if (current === null) {
    return (
      <p role="alert" className="text-sm text-danger">
        No se pudo cargar tu preferencia de avisos de este canal. Recarga la página para intentarlo de nuevo.
      </p>
    );
  }
  const active = LEVELS.find((l) => l.id === current) ?? LEVELS[1]!;

  const change = async (value: string) => {
    const next = LEVELS.find((l) => l.id === value)?.id;
    if (!next || next === current) return;
    const before = current;
    setCurrent(next);
    setError(null);
    const res = await setChannelFollowAction(channelId, next).catch(() => ({ error: "unknown" }) as { error?: string });
    if (res.error) {
      setCurrent(before);
      setError(rpcErrorMessage(res.error));
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="secondary" size="sm" aria-label={`Avisos del canal: ${active.short}`}>
            <active.Icon aria-hidden />
            {active.label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={current} onValueChange={(v) => void change(v)}>
            {LEVELS.map((l) => (
              <DropdownMenuRadioItem key={l.id} value={l.id}>
                {l.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
