import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NetworkBadge } from "@/components/economy/network-badge";

describe("NetworkBadge", () => {
  it("flags the testnet", () => {
    render(<NetworkBadge chainId={59141} />);
    expect(screen.getByText("MODO PRUEBA · Linea Sepolia")).toBeInTheDocument();
  });

  it("shows the plain network name on mainnet", () => {
    render(<NetworkBadge chainId={59144} />);
    expect(screen.getByText("Linea")).toBeInTheDocument();
    expect(screen.queryByText(/MODO PRUEBA/)).toBeNull();
  });

  it("offers a compact variant for tight bars", () => {
    render(<NetworkBadge chainId={59141} compact />);
    expect(screen.getByLabelText("MODO PRUEBA · Linea Sepolia")).toBeInTheDocument();
    expect(screen.getByText("PRUEBA")).toBeInTheDocument();
  });
});
