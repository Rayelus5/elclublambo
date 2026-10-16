import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/login-panel", () => ({
  LoginPanel: ({ inviteCode }: { inviteCode?: string | null }) => <p>panel {inviteCode}</p>,
}));

import { LoginPanelLazy } from "@/components/auth/login-panel-lazy";

describe("LoginPanelLazy", () => {
  it("loads the wallet panel on the client and forwards props", async () => {
    render(<LoginPanelLazy inviteCode="abc" />);
    expect(await screen.findByText("panel abc")).toBeInTheDocument();
  });
});
