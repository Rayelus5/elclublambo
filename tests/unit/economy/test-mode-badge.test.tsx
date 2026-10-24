import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestModeBadge } from "@/components/economy/test-mode-badge";

afterEach(() => vi.unstubAllEnvs());

describe("TestModeBadge", () => {
  it("flags the testnet build", () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
    render(<TestModeBadge />);
    expect(screen.getByText("MODO PRUEBA")).toBeInTheDocument();
  });

  it("is compact on tight bars", () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
    render(<TestModeBadge compact />);
    expect(screen.getByLabelText("MODO PRUEBA")).toBeInTheDocument();
    expect(screen.getByText("PRUEBA")).toBeInTheDocument();
  });

  it("renders nothing on mainnet", () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    const { container } = render(<TestModeBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});
