import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import * as sections from "@/components/home/home-sections";
import { ActiveChannelsList, HomeSection, PinnedList } from "@/components/home/home-sections";

describe("home sections", () => {
  it("the DAO summary and the unread banner are gone (P1: no DAO card on Inicio)", () => {
    expect("DaoSummary" in sections).toBe(false);
    expect("UnreadBanner" in sections).toBe(false);
    expect("HomeCard" in sections).toBe(false);
  });

  it("pins and active channels link where they belong; empty states are explicit", () => {
    render(
      <>
        <PinnedList pins={[{ messageId: "p1", channelId: "c1", channelName: "Anuncios", authorLabel: "@ana", excerpt: "Reunión el viernes", pinnedAt: "" }]} />
        <ActiveChannelsList channels={[{ channelId: "c2", channelName: "trading", lastAt: "", recentCount: 12 }]} />
      </>,
    );
    expect(screen.getByRole("link", { name: /Reunión el viernes/ })).toHaveAttribute("href", "/foro/c/c1?m=p1");
    expect(screen.getByRole("link", { name: /trading/ })).toHaveAttribute("href", "/foro/c/c2");
  });

  it("a failed section says so instead of rendering its content", () => {
    render(
      <HomeSection id="x" title="Bounties" failed>
        <p>contenido</p>
      </HomeSection>,
    );
    expect(screen.getByRole("heading", { name: "Bounties" })).toBeInTheDocument();
    expect(screen.getByText(/No se pudo cargar/)).toBeInTheDocument();
    expect(screen.queryByText("contenido")).not.toBeInTheDocument();
  });
});
