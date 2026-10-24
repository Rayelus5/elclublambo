import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/donations/donate-button", () => ({ DonateButton: () => <button>Donar a ElClub.</button> }));

import { LockPage } from "@/components/channels/lock-page";
import type { LockState } from "@/lib/channels/lock";

const state: LockState = {
  scope: "view",
  minShareBps: 100,
  minNetUsdc: 100_000_000n,
  myShareBps: 20,
  myNet: 20_000_000n,
  chainId: 59141,
  name: "Alpha",
  kind: "text",
  parentId: null,
  requirements: [{ channelId: "c1", scope: "view", minShareBps: 100, minNetUsdc: 100_000_000n }],
};

describe("LockPage", () => {
  it("shows the name, the requirement, the situation and the guide link, the donate button, and no messages", () => {
    render(<LockPage state={state} chainName="Linea Sepolia" />);
    expect(screen.getByRole("heading", { level: 1, name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByText("Necesitas 1 % de la DAO o 100 USDC aportados")).toBeInTheDocument();
    expect(screen.getByText("Tu situación: 0,2 % · 20 USDC aportados en Linea Sepolia")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Donar a ElClub." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/guia/candados");
    expect(screen.queryByRole("log")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("lists every requirement of nested gates", () => {
    const nested: LockState = {
      ...state,
      requirements: [
        { channelId: "c0", scope: "view", minShareBps: 500, minNetUsdc: null },
        { channelId: "c1", scope: "view", minShareBps: null, minNetUsdc: 50_000_000n },
      ],
    };
    render(<LockPage state={nested} chainName="Linea" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Necesitas 5 % de la DAO")).toBeInTheDocument();
    expect(screen.getByText("Necesitas 50 USDC aportados")).toBeInTheDocument();
    expect(screen.getByText(/todos los requisitos/i)).toBeInTheDocument();
  });
});
