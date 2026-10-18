"use client";

import { useState, type CSSProperties } from "react";
import { identicon } from "@/lib/members/identicon";
import { avatarUrl, type MemberIdentity } from "@/lib/members/name";
import { cn } from "@/lib/utils";

export type AvatarSize = 24 | 32 | 64 | 96;

/**
 * Default avatar for members without a custom picture: DiceBear "glass" seeded with the wallet address.
 * Note: served by api.dicebear.com, so the viewer's browser asks a third party for each wallet it displays.
 */
export function dicebearUrl(walletAddress: string): string {
  return `https://api.dicebear.com/10.x/glass/svg?seed=${encodeURIComponent(walletAddress.toLowerCase())}`;
}

/** Decorative: the member's name always sits next to it, so alt is empty / the svg is aria-hidden. */
export function MemberAvatar({ member, size, className }: { member: MemberIdentity; size: AvatarSize; className?: string }) {
  const custom = avatarUrl(member.avatarPath);
  const generated = member.walletAddress ? dicebearUrl(member.walletAddress) : null;
  // Remember which URLs failed, so a new avatar gets a fresh attempt: custom -> DiceBear -> local identicon.
  const [failed, setFailed] = useState<readonly string[]>([]);
  const url = [custom, generated].find((u): u is string => !!u && !failed.includes(u));
  const box = cn("block shrink-0 rounded-control border border-border-strong bg-surface-2", className);
  const dim: CSSProperties = { width: size, height: size };
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- public Supabase storage / DiceBear URL, already sized
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed((f) => [...f, url])}
        className={cn(box, "object-cover")}
        style={dim}
      />
    );
  }
  const { cells, hue } = identicon(member.walletAddress);
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 5 5"
      shapeRendering="crispEdges"
      className={cn(box, "p-[12%]")}
      style={{ ...dim, "--identicon-hue": hue } as CSSProperties}
    >
      {cells.map((on, i) =>
        on ? <rect key={i} x={i % 5} y={Math.floor(i / 5)} width={1} height={1} fill="hsl(var(--identicon-hue) 55% 55%)" /> : null,
      )}
    </svg>
  );
}
