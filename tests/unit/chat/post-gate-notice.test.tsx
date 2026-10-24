import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/donations/donate-button", () => ({ DonateButton: () => <button>Donar a ElClub.</button> }));

import { PostGateNotice } from "@/components/chat/post-gate-notice";
import type { LockState } from "@/lib/channels/lock";

const state: LockState = {
  scope: "post",
  minDonatedUsd6: 1_000_000n,
  myDonatedUsd6: 0n,
  name: "Alpha",
  kind: "text",
  parentId: null,
  requirements: [{ channelId: "c1", scope: "post", minDonatedUsd6: 1_000_000n }],
};

describe("PostGateNotice", () => {
  it("replaces the composer with the donation requirement, what the member has, the donate button and the guide link", () => {
    render(<PostGateNotice state={state} />);
    expect(screen.getByText("Canal para quien ha donado al menos 1 USD. Llevas 0 USD.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Donar a ElClub." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /¿Cómo funciona\?/ })).toHaveAttribute("href", "/guia/candados");
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
