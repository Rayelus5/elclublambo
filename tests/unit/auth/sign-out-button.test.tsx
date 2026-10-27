import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const replace = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ auth: { signOut } }) }));
vi.mock("@/lib/members/card", () => ({ leavePresence: async () => undefined }));
vi.mock("@/lib/members/presence", () => ({ presenceDeviceId: () => "d1" }));

import { SignOutButton } from "@/components/auth/sign-out-button";

describe("SignOutButton", () => {
  it("signs out and goes to the club login at /foro/login (R1)", async () => {
    render(<SignOutButton label="Salir" />);
    await userEvent.click(screen.getByRole("button", { name: "Salir" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/foro/login"));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
