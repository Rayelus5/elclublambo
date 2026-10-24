import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NetworkLogo } from "@/components/economy/network-logo";

describe("NetworkLogo", () => {
  it("names the network next to the logo", () => {
    const { container } = render(<NetworkLogo chainId={84532} withName />);
    expect(screen.getByText("Base Sepolia")).toBeInTheDocument();
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "/brand/networks/base.svg");
    expect(img).toHaveAttribute("alt", "");
    expect(img?.className).toContain("rounded-full");
  });

  it("labels the bare logo with the network name", () => {
    render(<NetworkLogo chainId={42161} />);
    expect(screen.getByAltText("Arbitrum")).toHaveAttribute("src", "/brand/networks/arbitrum.svg");
  });
});
