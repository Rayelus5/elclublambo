import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setHandleAction = vi.hoisted(() => vi.fn());
const completeWelcomeAction = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
vi.mock("@/lib/profile/actions", () => ({ setHandleAction }));
vi.mock("@/lib/onboarding/actions", () => ({ completeWelcomeAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: replace, refresh: vi.fn() }) }));

import { WelcomeSteps } from "@/components/onboarding/welcome-steps";

const base = { initialHandle: null as string | null, next: "/c/abc", chainId: 84532 as const };

describe("WelcomeSteps", () => {
  beforeEach(() => {
    setHandleAction.mockReset();
    completeWelcomeAction.mockReset();
    replace.mockReset();
  });

  it("step 1 has no 'Saltar' and 'Siguiente' stays disabled until the handle is valid", async () => {
    const user = userEvent.setup();
    render(<WelcomeSteps {...base} />);
    expect(screen.queryByRole("button", { name: "Saltar" })).toBeNull();
    const next = screen.getByRole("button", { name: "Siguiente" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    await user.type(screen.getByLabelText("@handle"), "ab");
    expect(next.disabled).toBe(true);
    await user.clear(screen.getByLabelText("@handle"));
    await user.type(screen.getByLabelText("@handle"), "admin");
    expect(next.disabled).toBe(true);
    expect(screen.getByText("Ese nombre está reservado")).toBeTruthy();
    await user.clear(screen.getByLabelText("@handle"));
    await user.type(screen.getByLabelText("@handle"), "Ray_L");
    expect(next.disabled).toBe(false);
  });

  it("shows the server error when the handle is taken and stays on step 1", async () => {
    const user = userEvent.setup();
    setHandleAction.mockResolvedValue({ ok: false, error: "Ese nombre ya está en uso" });
    render(<WelcomeSteps {...base} />);
    await user.type(screen.getByLabelText("@handle"), "ray_l");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Ese nombre ya está en uso");
    expect(screen.queryByRole("button", { name: "Saltar" })).toBeNull();
  });

  it("advances to step 2 after saving the handle", async () => {
    const user = userEvent.setup();
    setHandleAction.mockResolvedValue({ ok: true, handle: "ray_l" });
    render(<WelcomeSteps {...base} />);
    await user.type(screen.getByLabelText("@handle"), "ray_l");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(await screen.findByRole("heading", { name: "Propinas y bounties" })).toBeTruthy();
    expect(setHandleAction).toHaveBeenCalledWith("ray_l");
  });

  it("marks step 1 done when the member already has a handle", async () => {
    const user = userEvent.setup();
    render(<WelcomeSteps {...base} initialHandle="ana" />);
    expect(screen.getByText("@ana")).toBeTruthy();
    expect(screen.getByText("Hecho")).toBeTruthy();
    const next = screen.getByRole("button", { name: "Siguiente" }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    await user.click(next);
    expect(setHandleAction).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Propinas y bounties" })).toBeTruthy();
  });

  it("'Saltar' on step 2 completes the welcome and goes to next", async () => {
    const user = userEvent.setup();
    completeWelcomeAction.mockResolvedValue({ ok: true });
    render(<WelcomeSteps {...base} initialHandle="ana" />);
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(screen.getByRole("button", { name: "Saltar" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/c/abc"));
    expect(completeWelcomeAction).toHaveBeenCalledTimes(1);
  });

  it("'Empezar' on step 4 shows the network badge, completes and navigates; a failure stays put", async () => {
    const user = userEvent.setup();
    completeWelcomeAction.mockResolvedValueOnce({ ok: false, error: "Elige tu @handle para continuar." });
    render(<WelcomeSteps {...base} initialHandle="ana" />);
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByText("MODO PRUEBA · Base Sepolia")).toBeTruthy();
    expect(screen.getByRole("link", { name: /guía/i }).getAttribute("href")).toBe("/guia/redes");
    await user.click(screen.getByRole("button", { name: "Empezar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Elige tu @handle");
    expect(replace).not.toHaveBeenCalled();
    completeWelcomeAction.mockResolvedValueOnce({ ok: true });
    await user.click(screen.getByRole("button", { name: "Empezar" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/c/abc"));
  });

  it("re-sanitizes a hostile next before navigating", async () => {
    const user = userEvent.setup();
    completeWelcomeAction.mockResolvedValue({ ok: true });
    render(<WelcomeSteps {...base} initialHandle="ana" next="//evil.com" />);
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(screen.getByRole("button", { name: "Saltar" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
});
