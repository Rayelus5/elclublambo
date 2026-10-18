import type { CSSProperties } from "react";
import { identicon } from "@/lib/members/identicon";
import { avatarUrl, type MemberIdentity } from "@/lib/members/name";
import { cn } from "@/lib/utils";

export type AvatarSize = 24 | 32 | 64 | 96;

/** Decorative: the member's name always sits next to it, so alt is empty / the svg is aria-hidden. */
export function MemberAvatar({ member, size, className }: { member: MemberIdentity; size: AvatarSize; className?: string }) {
  const box = cn("block shrink-0 rounded-control border border-border-strong bg-surface-2", className);
  const dim: CSSProperties = { width: size, height: size };
  const url = avatarUrl(member.avatarPath);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- public Supabase storage URL, already sized by the uploader
    return <img src={url} alt="" width={size} height={size} loading="lazy" className={cn(box, "object-cover")} style={dim} />;
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
