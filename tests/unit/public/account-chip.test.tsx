import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const disconnect = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("wagmi", () => ({ useDisconnect: () => ({ disconnect }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ auth: { signOut } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AccountChip } from "@/components/public/account-chip";

beforeEach(() => {
  vi.clearAllMocks();
  signOut.mockResolvedValue({ error: null });
});

describe("AccountChip", () => {
  it("«Desconectar» ends the session and disconnects the wallet, so the header offers «Conectar wallet» again", async () => {
    render(<AccountChip lang="es" wallet="0x71be63f3384f5fb98995898a86b02fb2426c5788" />);
    await userEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
