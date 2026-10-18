import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/payments/tip-dialog", () => ({ TipDialog: () => null }));

import { PostGateNotice } from "@/components/chat/post-gate-notice";
import type { LockState } from "@/lib/channels/lock";

const state: LockState = {
  scope: "post",
  minShareBps: 100,
  minNetUsdc: null,
  myShareBps: 0,
  myNet: 0n,
  chainId: 59141,
  name: "Alpha",
  kind: "text",
  parentId: null,
  requirements: [{ channelId: "c1", scope: "post", minShareBps: 100, minNetUsdc: null }],
};

describe("PostGateNotice", () => {
  it("replaces the composer with the requirement, the situation, donate and the guide link", () => {
    render(<PostGateNotice state={state} chainName="Linea Sepolia" />);
    expect(screen.getByText("Necesitas 1 % de la DAO")).toBeInTheDocument();
    expect(screen.getByText("Tu situación: 0 % · 0 USDC aportados en Linea Sepolia")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Donar a la DAO" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/guia/candados");
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
