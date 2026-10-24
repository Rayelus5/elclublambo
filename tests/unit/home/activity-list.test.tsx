import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityList } from "@/components/home/activity-list";
import type { ActivityItem } from "@/lib/home/queries";

const base = { at: "2026-10-18T10:00:00Z", targetLabel: null, channelId: null, messageId: null, targetWallet: null };

describe("ActivityList", () => {
  it("phrases each kind and links it to where it happened", () => {
    const items: ActivityItem[] = [
      { ...base, kind: "tip", actorLabel: "Anónimo", targetLabel: "@bob", token: "USDC", amount: 5_000_000n, channelId: "c1", messageId: "m1" },
      { ...base, kind: "donation", actorLabel: "@ana", token: "USDC", amount: 10_000_000n },
      { ...base, kind: "bounty", actorLabel: "@luis", token: "ETH", amount: 100_000_000_000_000_000n, channelId: "c2", messageId: "m2" },
      { ...base, kind: "tip", actorLabel: "@eva", targetLabel: "@bob", token: "ETH", amount: 1_000_000_000_000_000n, targetWallet: "0xabc" },
    ];
    render(<ActivityList items={items} />);
    expect(screen.getByRole("link", { name: /Anónimo dio 5 USDC a @bob/ })).toHaveAttribute("href", "/c/c1?m=m1");
    expect(screen.getByRole("link", { name: /@ana donó 10 USDC a ElClub\./ })).toHaveAttribute("href", "/donar");
    expect(screen.getByRole("link", { name: /@luis abrió un bounty de 0,1 ETH/ })).toHaveAttribute("href", "/c/c2?m=m2");
    expect(screen.getByRole("link", { name: /@eva dio 0,001 ETH a @bob/ })).toHaveAttribute("href", "/u/0xabc");
  });

  it("has an empty state", () => {
    render(<ActivityList items={[]} />);
    expect(screen.getByText("Todavía no hay actividad.")).toBeInTheDocument();
  });
});
