import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssetLogo } from "@/components/economy/asset-logo";

describe("AssetLogo", () => {
  it("announces the token on its network and stacks both logos", () => {
    const { container } = render(<AssetLogo token="USDC" chainId={421614} />);
    expect(screen.getByRole("img", { name: "USDC en Arbitrum Sepolia" })).toBeInTheDocument();
    const srcs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(["/brand/tokens/usdc.svg", "/brand/networks/arbitrum.svg"]);
    container.querySelectorAll("img").forEach((i) => expect(i).toHaveAttribute("alt", ""));
  });

  it("uses the ETH logo", () => {
    const { container } = render(<AssetLogo token="ETH" chainId={8453} size={40} />);
    expect(screen.getByRole("img", { name: "ETH en Base" })).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", "/brand/tokens/eth.svg");
  });
});
