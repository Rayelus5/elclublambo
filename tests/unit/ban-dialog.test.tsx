import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberSummary } from "@/components/members/sponsor-tree";

const banMemberAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/moderation/actions", () => ({ banMemberAction, toggleSponsorRoleAction: vi.fn() }));

import { BanDialog } from "@/components/members/ban-dialog";

const member: MemberSummary = {
  id: "m1",
  walletAddress: "0x1111111111111111111111111111111111111111",
  displayName: "Ana",
  status: "active",
};
const sponsor: MemberSummary = {
  id: "s1",
  walletAddress: "0x2222222222222222222222222222222222222222",
  displayName: "Bruno",
  status: "active",
};

const SPONSOR_LABEL = "Penalizar también a Bruno: pierde el permiso de invitar y se anulan sus invitaciones activas";

describe("BanDialog", () => {
  beforeEach(() => banMemberAction.mockReset());

  it("hides the sponsor checkbox when there is no sponsor", async () => {
    const user = userEvent.setup();
    render(<BanDialog member={member} sponsor={null} />);
    await user.click(screen.getByRole("button", { name: "Banear" }));
    expect(screen.getByRole("alertdialog", { name: "Banear a Ana" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("blocks submit without a reason and shows a message", async () => {
    const user = userEvent.setup();
    render(<BanDialog member={member} sponsor={sponsor} />);
    await user.click(screen.getByRole("button", { name: "Banear" }));
    await user.click(document.querySelector("[data-slot=alert-dialog-action]")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("motivo");
    expect(banMemberAction).not.toHaveBeenCalled();
  });

  it("calls the action with penalizeSponsor=true when checked", async () => {
    banMemberAction.mockResolvedValue({});
    const user = userEvent.setup();
    render(<BanDialog member={member} sponsor={sponsor} />);
    await user.click(screen.getByRole("button", { name: "Banear" }));
    await user.type(screen.getByLabelText("Motivo"), "  Spam repetido  ");
    await user.click(screen.getByRole("checkbox", { name: SPONSOR_LABEL }));
    await user.click(document.querySelector("[data-slot=alert-dialog-action]")!);
    await waitFor(() => expect(banMemberAction).toHaveBeenCalledTimes(1));
    expect(banMemberAction).toHaveBeenCalledWith({
      memberId: "m1",
      reason: "Spam repetido",
      penalizeSponsor: true,
    });
  });

  it("defaults penalizeSponsor to false", async () => {
    banMemberAction.mockResolvedValue({});
    const user = userEvent.setup();
    render(<BanDialog member={member} sponsor={sponsor} />);
    await user.click(screen.getByRole("button", { name: "Banear" }));
    await user.type(screen.getByLabelText("Motivo"), "Spam");
    await user.click(document.querySelector("[data-slot=alert-dialog-action]")!);
    await waitFor(() => expect(banMemberAction).toHaveBeenCalled());
    expect(banMemberAction.mock.calls[0]?.[0].penalizeSponsor).toBe(false);
  });

  it("shows the rpc error copy with role=alert and stays open", async () => {
    banMemberAction.mockResolvedValue({ error: "hierarchy" });
    const user = userEvent.setup();
    render(<BanDialog member={member} sponsor={null} />);
    await user.click(screen.getByRole("button", { name: "Banear" }));
    await user.type(screen.getByLabelText("Motivo"), "Spam");
    await user.click(document.querySelector("[data-slot=alert-dialog-action]")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("rango igual o superior");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("returns focus to the trigger on cancel", async () => {
    const user = userEvent.setup();
    render(<BanDialog member={member} sponsor={sponsor} />);
    const trigger = screen.getByRole("button", { name: "Banear" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
