import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NetworkBadge } from "@/components/economy/network-badge";

describe("NetworkBadge", () => {
  it("flags the testnet", () => {
    render(<NetworkBadge chainId={84532} />);
    expect(screen.getByText("MODO PRUEBA · Base Sepolia")).toBeInTheDocument();
  });

  it("shows the plain network name on mainnet", () => {
    render(<NetworkBadge chainId={8453} />);
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.queryByText(/MODO PRUEBA/)).toBeNull();
  });

  it("offers a compact variant for tight bars", () => {
    render(<NetworkBadge chainId={84532} compact />);
    expect(screen.getByLabelText("MODO PRUEBA · Base Sepolia")).toBeInTheDocument();
    expect(screen.getByText("PRUEBA")).toBeInTheDocument();
  });
});
