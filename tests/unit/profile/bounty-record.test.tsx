import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BountyRecordSection } from "@/components/profile/bounty-record";

const CH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const M1 = "11111111-1111-4111-8111-111111111111";

describe("BountyRecordSection", () => {
  it("shows the counts in the agreed copy", () => {
    render(<BountyRecordSection record={{ paid: 3, paidLate: 1, unpaid: 2, open: 4 }} unpaid={[]} activeChainId={84532} />);
    expect(screen.getByRole("heading", { name: "Bounties" })).toBeInTheDocument();
    expect(screen.getByText("Bounties: 3 pagados · 1 pagado tarde · 2 impagados")).toBeInTheDocument();
  });

  it("uses the singular for exactly one", () => {
    render(<BountyRecordSection record={{ paid: 1, paidLate: 1, unpaid: 1, open: 0 }} unpaid={[]} activeChainId={84532} />);
    expect(screen.getByText("Bounties: 1 pagado · 1 pagado tarde · 1 impagado")).toBeInTheDocument();
  });

  it("keeps the plural for zero and for several", () => {
    render(<BountyRecordSection record={{ paid: 0, paidLate: 2, unpaid: 1, open: 0 }} unpaid={[]} activeChainId={84532} />);
    expect(screen.getByText("Bounties: 0 pagados · 2 pagados tarde · 1 impagado")).toBeInTheDocument();
  });

  it("lists the unpaid bounties, linking to the bounty message", () => {
    render(
      <BountyRecordSection
        record={{ paid: 0, paidLate: 0, unpaid: 1, open: 0 }}
        unpaid={[{ messageId: M1, channelId: CH, token: "USDC", amount: 25_000_000n, solutionMarkedAt: "2026-10-01T10:00:00Z", chainId: 84532 }]}
        activeChainId={84532}
      />,
    );
    const list = screen.getByRole("list", { name: "Bounties impagados" });
    const link = within(list).getByRole("link");
    expect(link).toHaveAttribute("href", `/c/${CH}?m=${M1}`);
    expect(link).toHaveTextContent("25 USDC");
    expect(within(link).getByAltText("Base Sepolia")).toBeInTheDocument();
  });

  it("labels the network the record counts (F3-R2)", () => {
    render(<BountyRecordSection record={{ paid: 1, paidLate: 0, unpaid: 0, open: 0 }} unpaid={[]} activeChainId={8453} />);
    const section = screen.getByRole("region", { name: "Bounties" });
    expect(within(section).getByText("Base")).toBeInTheDocument();
  });

  it("renders nothing when there is nothing to report", () => {
    const { container } = render(<BountyRecordSection record={{ paid: 0, paidLate: 0, unpaid: 0, open: 2 }} unpaid={[]} activeChainId={84532} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("has no unpaid list when there are none", () => {
    render(<BountyRecordSection record={{ paid: 1, paidLate: 0, unpaid: 0, open: 0 }} unpaid={[]} activeChainId={84532} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
