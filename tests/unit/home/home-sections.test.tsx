import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/treasury/donate-button", () => ({ DonateButton: () => <button>Donar a la DAO</button> }));

import { ActiveChannelsList, DaoSummary, HomeCard, OpenBountiesList, PinnedList, UnreadBanner } from "@/components/home/home-sections";

describe("home sections", () => {
  it("unread banner: counts and a link, or 'al día'", () => {
    const { rerender } = render(<UnreadBanner unread={{ mentions: 2, replies: 1, total: 4 }} />);
    expect(screen.getByText("4 sin leer")).toBeInTheDocument();
    expect(screen.getByText("2 menciones")).toBeInTheDocument();
    expect(screen.getByText("1 respuesta")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver notificaciones" })).toHaveAttribute("href", "/notifications");
    rerender(<UnreadBanner unread={{ mentions: 0, replies: 0, total: 0 }} />);
    expect(screen.getByText(/Estás al día/)).toBeInTheDocument();
  });

  it("open bounties link to their message and show the reward", () => {
    render(
      <OpenBountiesList
        bounties={[{ messageId: "m1", channelId: "c1", channelName: "General", token: "USDC", amount: 50_000_000n, status: "solution_marked", excerpt: "Falla el login", createdAt: "" }]}
      />,
    );
    const link = screen.getByRole("link", { name: /Falla el login/ });
    expect(link).toHaveAttribute("href", "/c/c1?m=m1");
    expect(link).toHaveTextContent("50 USDC");
    expect(link).toHaveTextContent("solución elegida");
  });

  it("DAO summary: balance, own share and donate", () => {
    render(
      <DaoSummary
        overview={{ chainId: 59141, totalShares: 1n, valueUsdc: 1n, donors: 3, myShares: 0n, myShareBps: 320, myNet: 0n, myPending: [],
          navUsd6: 1_240_000_000n, navAt: null, sharePriceUsd6: 0n, myValueUsd6: 0n, clubShares: 0n, composition: null }}
      />,
    );
    expect(screen.getByText("Valor del fondo")).toBeInTheDocument();
    expect(screen.getByText("1.240 USD")).toBeInTheDocument();
    expect(screen.getByText("3,2 %")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Donar a la DAO" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver la DAO" })).toHaveAttribute("href", "/dao");
  });

  it("pins and active channels link where they belong; empty states are explicit", () => {
    render(
      <>
        <PinnedList pins={[{ messageId: "p1", channelId: "c1", channelName: "Anuncios", authorLabel: "@ana", excerpt: "Reunión el viernes", pinnedAt: "" }]} />
        <ActiveChannelsList channels={[{ channelId: "c2", channelName: "trading", lastAt: "", recentCount: 12 }]} />
        <OpenBountiesList bounties={[]} />
      </>,
    );
    expect(screen.getByRole("link", { name: /Reunión el viernes/ })).toHaveAttribute("href", "/c/c1?m=p1");
    expect(screen.getByRole("link", { name: /trading/ })).toHaveAttribute("href", "/c/c2");
    expect(screen.getByText("No hay bounties abiertos ahora mismo.")).toBeInTheDocument();
  });

  it("a failed section says so instead of rendering its content", () => {
    render(
      <HomeCard id="x" title="DAO" failed>
        <p>contenido</p>
      </HomeCard>,
    );
    expect(screen.getByRole("heading", { name: "DAO" })).toBeInTheDocument();
    expect(screen.getByText(/No se pudo cargar/)).toBeInTheDocument();
    expect(screen.queryByText("contenido")).not.toBeInTheDocument();
  });
});
