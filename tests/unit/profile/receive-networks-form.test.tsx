import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setReceiveNetworksAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/profile/actions", () => ({ setReceiveNetworksAction }));

import { ReceiveNetworksForm } from "@/components/profile/receive-networks-form";

describe("ReceiveNetworksForm", () => {
  beforeEach(() => {
    setReceiveNetworksAction.mockReset();
    setReceiveNetworksAction.mockResolvedValue({ ok: true });
  });

  it("saves the remaining network after unchecking Base", async () => {
    const user = userEvent.setup();
    render(<ReceiveNetworksForm initial={["base", "arbitrum"]} />);
    await user.click(screen.getByRole("checkbox", { name: "Base" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(setReceiveNetworksAction).toHaveBeenCalledWith(["arbitrum"]));
  });

  it("disables the last checked network and explains why", () => {
    render(<ReceiveNetworksForm initial={["arbitrum"]} />);
    const last = screen.getByRole("checkbox", { name: "Arbitrum" }) as HTMLButtonElement;
    expect(last.disabled).toBe(true);
    const ids = last.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(ids.map((id) => document.getElementById(id)?.textContent).join(" ")).toContain("Tiene que quedar al menos una red.");
    expect((screen.getByRole("checkbox", { name: "Base" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("warns about exchanges and smart wallets", () => {
    render(<ReceiveNetworksForm initial={["base", "arbitrum"]} />);
    expect(screen.getByText(/exchange o una smart wallet, deja solo la red que admite/)).toBeTruthy();
  });
});
