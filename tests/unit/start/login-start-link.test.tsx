import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/login-panel-lazy", () => ({ LoginPanelLazy: () => <div /> }));

import LoginPage from "@/app/foro/(gate)/login/page";

describe("/login", () => {
  it("links to /start for whoever arrives without an invitation", () => {
    render(<LoginPage params={Promise.resolve({})} searchParams={Promise.resolve({})} />);
    const link = screen.getByRole("link", { name: "¿Qué es ElClub.?" });
    expect(link).toHaveAttribute("href", "/start");
  });
});
