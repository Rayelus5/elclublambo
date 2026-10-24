import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setDonorVisibleAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/donations/actions", () => ({ setDonorVisibleAction, createDonationIntentAction: vi.fn() }));

import { DonorVisibilityToggle } from "@/components/donations/donor-visibility-toggle";

beforeEach(() => {
  setDonorVisibleAction.mockReset().mockResolvedValue({ ok: true });
});

describe("DonorVisibilityToggle", () => {
  it("unchecking calls setDonorVisibleAction(false)", async () => {
    render(<DonorVisibilityToggle initial />);
    const box = screen.getByRole("checkbox", { name: "Aparecer en la lista de donantes" });
    expect(box).toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(setDonorVisibleAction).toHaveBeenCalledWith(false));
    expect(box).not.toBeChecked();
  });

  it("a refusal puts the box back and shows the error", async () => {
    setDonorVisibleAction.mockResolvedValue({ ok: false, code: "rate_limited", error: "Demasiados cambios." });
    render(<DonorVisibilityToggle initial={false} />);
    const box = screen.getByRole("checkbox", { name: "Aparecer en la lista de donantes" });
    await userEvent.click(box);
    expect(await screen.findByRole("alert")).toHaveTextContent("Demasiados cambios.");
    expect(box).not.toBeChecked();
  });
});
