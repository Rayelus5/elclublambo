import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NetworkPicker } from "@/components/economy/network-picker";
import type { ChainId } from "@/lib/economy/networks";

const CHAINS: readonly ChainId[] = [84532, 421614];

function Harness({ onChange }: { onChange?: (c: ChainId) => void }) {
  const [value, setValue] = useState<ChainId>(84532);
  return (
    <NetworkPicker
      value={value}
      chains={CHAINS}
      label="Red"
      onChange={(c) => {
        setValue(c);
        onChange?.(c);
      }}
    />
  );
}

describe("NetworkPicker", () => {
  it("is a labelled radiogroup with one named option per chain and the value checked", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Red" });
    expect(group).toBeInTheDocument();
    const base = screen.getByRole("radio", { name: "Base Sepolia" });
    const arb = screen.getByRole("radio", { name: "Arbitrum Sepolia" });
    expect(base).toHaveAttribute("aria-checked", "true");
    expect(arb).toHaveAttribute("aria-checked", "false");
    expect(base).toHaveAttribute("tabindex", "0");
    expect(arb).toHaveAttribute("tabindex", "-1");
  });

  it("arrow keys move the selection, wrapping around, and click selects", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    screen.getByRole("radio", { name: "Base Sepolia" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(421614);
    expect(screen.getByRole("radio", { name: "Arbitrum Sepolia" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Arbitrum Sepolia" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith(84532);
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(421614);
    await user.click(screen.getByRole("radio", { name: "Base Sepolia" }));
    expect(onChange).toHaveBeenLastCalledWith(84532);
  });

  it("shows each network's logo as decoration next to its name", () => {
    const { container } = render(<Harness />);
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(2);
    imgs.forEach((i) => expect(i.getAttribute("alt")).toBe(""));
  });
});
