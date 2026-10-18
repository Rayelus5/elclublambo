import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SponsorTree, type MemberSummary } from "@/components/members/sponsor-tree";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";

const m = (over: Partial<MemberSummary> & { walletAddress: string }): MemberSummary => ({
  id: over.walletAddress,
  displayName: null,
  handle: null,
  avatarPath: null,
  status: "active",
  ...over,
});

describe("SponsorTree", () => {
  it("shows founder copy when there is no sponsor", () => {
    render(<SponsorTree sponsor={null} invitees={[]} />);
    expect(screen.getByText("Miembro fundador")).toBeInTheDocument();
  });

  it("links the sponsor to their profile", () => {
    render(<SponsorTree sponsor={m({ walletAddress: A, displayName: "Ana" })} invitees={[]} />);
    expect(screen.getByRole("link", { name: /Ana/ })).toHaveAttribute("href", `/u/${A}`);
  });

  it("lists invitees linked to /u/<address>", () => {
    render(
      <SponsorTree
        sponsor={null}
        invitees={[m({ walletAddress: B, displayName: "Beto" }), m({ walletAddress: C })]}
      />,
    );
    expect(screen.getByRole("link", { name: /Beto/ })).toHaveAttribute("href", `/u/${B}`);
    const short = screen.getByRole("link", { name: "0x3333…3333" });
    expect(short).toHaveAttribute("href", `/u/${C}`);
  });

  it("shows Baneado badge for banned invitees", () => {
    render(<SponsorTree sponsor={null} invitees={[m({ walletAddress: B, status: "banned" })]} />);
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Baneado")).toBeInTheDocument();
  });

  it("shows Se fue badge for invitees who left", () => {
    render(<SponsorTree sponsor={null} invitees={[m({ walletAddress: B, status: "left" })]} />);
    expect(screen.getByText("Se fue")).toBeInTheDocument();
  });

  it("shows empty copy without invitees", () => {
    render(<SponsorTree sponsor={null} invitees={[]} />);
    expect(screen.getByText("Aún no ha invitado a nadie")).toBeInTheDocument();
  });
});
