import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/donations/donate-button", () => ({ DonateButton: () => <button>Donar a ElClub.</button> }));

import { LockPage } from "@/components/channels/lock-page";
import type { LockState } from "@/lib/channels/lock";

const state: LockState = {
  scope: "view",
  minDonatedUsd6: 10_000_000n,
  myDonatedUsd6: 9_990_000n,
  name: "Alpha",
  kind: "text",
  parentId: null,
  requirements: [{ channelId: "c1", scope: "view", minDonatedUsd6: 10_000_000n }],
};

describe("LockPage", () => {
  it("shows the name, the donation requirement with what the member has, the donate button and the guide link, and no messages", () => {
    render(<LockPage state={state} />);
    expect(screen.getByRole("heading", { level: 1, name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByText("Canal para quien ha donado al menos 10 USD. Llevas 9,99 USD.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Donar a ElClub." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/foro/guia/candados");
    expect(screen.queryByRole("log")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("lists every requirement of nested gates and what the member has donated once", () => {
    const nested: LockState = {
      ...state,
      minDonatedUsd6: 5_000_000n,
      requirements: [
        { channelId: "c0", scope: "view", minDonatedUsd6: 5_000_000n },
        { channelId: "c1", scope: "view", minDonatedUsd6: 50_000_000n },
      ],
    };
    render(<LockPage state={nested} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Canal para quien ha donado al menos 5 USD.")).toBeInTheDocument();
    expect(screen.getByText("Canal para quien ha donado al menos 50 USD.")).toBeInTheDocument();
    expect(screen.getAllByText("Llevas 9,99 USD.")).toHaveLength(1);
    expect(screen.getByText(/todos los requisitos/i)).toBeInTheDocument();
  });
});
