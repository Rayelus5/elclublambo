import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const topic = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/browser", () => ({ createBrowserClient: () => ({ rpc }) }));
vi.mock("@/lib/realtime/private-topic", () => ({ usePrivateTopic: topic }));

import { MemberCardTrigger } from "@/components/members/member-card";

const ID = "22222222-2222-4222-8222-222222222222";
const CARD = {
  id: ID,
  handle: "ana",
  displayName: "Ana Pérez",
  walletAddress: "0x1111111111111111111111111111111111111111",
  avatarPath: null,
  bio: "Trader de Linea",
  status: "active",
  joinedAt: "2026-10-01T10:00:00Z",
  online: true,
  roles: [{ name: "Moderador", color: "#61DFFF" }],
};

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: CARD, error: null });
});

describe("MemberCardTrigger", () => {
  it("opens a card with the member's info and a link to the full profile", async () => {
    render(<MemberCardTrigger memberId={ID} label="Ana Pérez">Ana Pérez</MemberCardTrigger>);
    expect(rpc).not.toHaveBeenCalled(); // nothing is fetched until it is opened
    await userEvent.click(screen.getByRole("button", { name: "Ver tarjeta de Ana Pérez" }));
    const card = await screen.findByRole("dialog", { name: "Ana Pérez" });
    expect(rpc).toHaveBeenCalledWith("member_card", { p_member: ID });
    expect(card).toHaveTextContent("@ana");
    expect(card).toHaveTextContent("En línea");
    expect(card).toHaveTextContent("Moderador");
    expect(card).toHaveTextContent("Trader de Linea");
    expect(card).toHaveTextContent(/Miembro desde/);
    expect(screen.getByRole("link", { name: "Ver perfil completo" })).toHaveAttribute("href", `/foro/u/${CARD.walletAddress}`);
  });

  it("shows an offline member and a banned badge", async () => {
    rpc.mockResolvedValue({ data: { ...CARD, online: false, status: "banned" }, error: null });
    render(<MemberCardTrigger memberId={ID} label="Ana Pérez">Ana</MemberCardTrigger>);
    await userEvent.click(screen.getByRole("button", { name: "Ver tarjeta de Ana Pérez" }));
    const card = await screen.findByRole("dialog", { name: "Ana Pérez" });
    expect(card).toHaveTextContent("Desconectado");
    expect(card).toHaveTextContent("Baneado");
  });

  it("explains a failed read instead of showing a blank card", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_found" } });
    render(<MemberCardTrigger memberId={ID} label="Ana Pérez">Ana</MemberCardTrigger>);
    await userEvent.click(screen.getByRole("button", { name: "Ver tarjeta de Ana Pérez" }));
    expect(await screen.findByText("No se pudo cargar este miembro.")).toBeInTheDocument();
  });

  it("a duplicate trigger (the avatar beside the name) is not a second keyboard stop", () => {
    render(
      <>
        <MemberCardTrigger memberId={ID} label="Ana" tabbable={false}>A</MemberCardTrigger>
        <MemberCardTrigger memberId={ID} label="Ana">Ana</MemberCardTrigger>
      </>,
    );
    const [avatar, name] = screen.getAllByRole("button", { name: "Ver tarjeta de Ana" });
    expect(avatar).toHaveAttribute("tabindex", "-1");
    expect(name).not.toHaveAttribute("tabindex");
  });

  it("the open card follows the member going offline live", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MemberCardTrigger memberId={ID} label="Ana Pérez">Ana</MemberCardTrigger>);
    await userEvent.click(screen.getByRole("button", { name: "Ver tarjeta de Ana Pérez" }));
    const card = await screen.findByRole("dialog", { name: "Ana Pérez" });
    expect(card).toHaveTextContent("En línea");
    const handlers = topic.mock.calls.findLast((c) => c[0] === "presence")![2] as { onEvent: (p: unknown) => void };
    act(() => handlers.onEvent({ member_id: ID, online: false }));
    act(() => vi.advanceTimersByTime(5_000));
    expect(card).toHaveTextContent("Desconectado");
    vi.useRealTimers();
  });
});
