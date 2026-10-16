import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/sign-out-button", () => ({ SignOutButton: () => <button type="button">Salir</button> }));

import { NoAccessView } from "@/components/auth/no-access-view";

describe("NoAccessView", () => {
  it("renders no alert without an error code", () => {
    render(<NoAccessView errorCode={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the mapped message in a role=alert block for a known code", () => {
    render(<NoAccessView errorCode="invite_revoked" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Esta invitación fue anulada.");
  });
});
