import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReactionBar } from "@/components/chat/reaction-bar";
import type { ReactionChip } from "@/lib/chat/model";

const chip = (emoji: string) => screen.getByRole("button", { name: new RegExp(emoji) });
const count = (emoji: string) => chip(emoji).querySelector("[data-reaction-count]")!;

function bar(reactions: ReactionChip[]) {
  return <ReactionBar reactions={reactions} canReact onToggle={vi.fn()} />;
}

describe("ReactionBar animation", () => {
  it("does not animate the reactions a message already had", () => {
    render(bar([{ emoji: "🔥", count: 2, reactedByMe: false }]));
    expect(chip("🔥")).not.toHaveClass("animate-reaction-in");
    expect(count("🔥")).not.toHaveClass("animate-reaction-pop");
  });

  it("pops in a reaction added after mount", () => {
    const { rerender } = render(bar([{ emoji: "🔥", count: 1, reactedByMe: false }]));
    rerender(bar([{ emoji: "🔥", count: 1, reactedByMe: false }, { emoji: "🚀", count: 1, reactedByMe: true }]));
    expect(chip("🚀")).toHaveClass("animate-reaction-in");
    expect(chip("🔥")).not.toHaveClass("animate-reaction-in");
  });

  it("pops in the first reaction of a message that had none", () => {
    const { rerender } = render(bar([]));
    rerender(bar([{ emoji: "🔥", count: 1, reactedByMe: true }]));
    expect(chip("🔥")).toHaveClass("animate-reaction-in");
  });

  it("bumps the count when it changes, up or down, keeping the button (and its focus)", () => {
    const { rerender } = render(bar([{ emoji: "🔥", count: 1, reactedByMe: false }]));
    const button = chip("🔥");
    button.focus();
    rerender(bar([{ emoji: "🔥", count: 2, reactedByMe: true }]));
    expect(count("🔥")).toHaveClass("animate-reaction-pop");
    expect(chip("🔥")).toBe(button);
    expect(document.activeElement).toBe(button);

    const before = count("🔥");
    rerender(bar([{ emoji: "🔥", count: 1, reactedByMe: false }]));
    // A new element, so the animation plays again.
    expect(count("🔥")).not.toBe(before);
    expect(count("🔥")).toHaveClass("animate-reaction-pop");
  });
});
