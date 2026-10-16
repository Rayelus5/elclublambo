import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/moderation/actions", () => ({ banMemberAction: vi.fn(), toggleSponsorRoleAction: vi.fn() }));

import { MemberTable, type AdminMemberRow } from "@/components/members/member-table";
import { Perm } from "@/lib/permissions/bits";

const row = (over: Partial<AdminMemberRow> & { id: string; walletAddress: string }): AdminMemberRow => ({
  displayName: null,
  status: "active",
  sponsor: null,
  isPadrino: false,
  needsReview: false,
  createdAt: "2026-10-01T00:00:00Z",
  ...over,
});

const me = row({ id: "me", walletAddress: "0x1111111111111111111111111111111111111111", displayName: "Yo" });
const ana = row({ id: "a", walletAddress: "0x2222222222222222222222222222222222222222", displayName: "Ana" });
const gone = row({
  id: "g",
  walletAddress: "0x3333333333333333333333333333333333333333",
  displayName: "Gus",
  status: "banned",
});

const ALL = Perm.BAN_MEMBERS | Perm.MANAGE_ROLES;

describe("MemberTable", () => {
  it("hides actions on the own row and on banned rows", () => {
    render(<MemberTable members={[me, ana, gone]} meId="me" perms={ALL} />);
    expect(screen.queryByRole("button", { name: "Banear a Yo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Banear a Gus" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Banear a Ana" })).toBeInTheDocument();
  });

  it("gives each row's actions a unique accessible name and keeps aria-pressed", () => {
    render(<MemberTable members={[ana, { ...me, id: "b", displayName: "Bea", isPadrino: true }]} meId="x" perms={ALL} />);
    expect(screen.getByRole("button", { name: "Padrino: Ana" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Padrino: Bea" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Banear a Bea" })).toBeInTheDocument();
  });

  it("shows an Activo badge for active members only, and keeps the Padrino tag out of Estado", () => {
    render(
      <MemberTable members={[{ ...ana, isPadrino: true }, gone]} meId="x" perms={ALL} />,
    );
    const anaRow = screen.getByRole("row", { name: /Ana/ });
    const goneRow = screen.getByRole("row", { name: /Gus/ });
    const [memberCell, , , statusCell] = within(anaRow).getAllByRole("cell");
    expect(within(statusCell!).getByText("Activo")).toBeInTheDocument();
    expect(within(statusCell!).queryByText("Padrino")).not.toBeInTheDocument();
    expect(within(memberCell!).getByText("Padrino")).toBeInTheDocument();
    expect(within(goneRow).queryByText("Activo")).not.toBeInTheDocument();
    expect(within(goneRow).getByText("Baneado")).toBeInTheDocument();
  });

  it("shows the Revisar badge when the member needs review", () => {
    render(<MemberTable members={[{ ...ana, needsReview: true }]} meId="x" perms={ALL} />);
    const r = screen.getByRole("row", { name: /Ana/ });
    expect(within(r).getByText("Revisar")).toBeInTheDocument();
  });

  it("hides the Padrino toggle without MANAGE_ROLES but keeps Ban", () => {
    render(<MemberTable members={[ana]} meId="x" perms={Perm.BAN_MEMBERS} />);
    expect(screen.queryByRole("button", { name: "Padrino: Ana" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Banear a Ana" })).toBeInTheDocument();
  });

  it("shows the Padrino toggle to ADMINISTRATOR", () => {
    render(<MemberTable members={[ana]} meId="x" perms={Perm.ADMINISTRATOR} />);
    expect(screen.getByRole("button", { name: "Padrino: Ana" })).toBeInTheDocument();
  });
});
