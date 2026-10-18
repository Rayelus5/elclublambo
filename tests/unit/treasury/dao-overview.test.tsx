import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DaoOverview } from "@/components/treasury/dao-overview";
import type { DaoOverview as Data } from "@/lib/treasury/queries";

const HASH = `0x${"ab".repeat(32)}`;
const base: Data = {
  chainId: 59141,
  totalShares: 100_000_000n * 10n ** 12n,
  valueUsdc: 1_234_500_000n,
  donors: 7,
  myShares: 20_000_000n * 10n ** 12n,
  myShareBps: 20,
  myNet: 20_000_000n,
  myPending: [],
};

describe("DaoOverview", () => {
  it("shows the network, the formatted balance, the donors and the donate slot", () => {
    render(<DaoOverview data={base} donate={<button>Donar a la DAO</button>} />);
    expect(screen.getByText(/MODO PRUEBA · Linea Sepolia/)).toBeInTheDocument();
    expect(screen.getByTestId("dao-balance")).toHaveTextContent("1.234,5 USDC");
    expect(screen.getByTestId("dao-donors")).toHaveTextContent("7");
    expect(screen.getByRole("button", { name: "Donar a la DAO" })).toBeInTheDocument();
  });

  it("shows my participation: percentage, compact shares and net contributed", () => {
    render(<DaoOverview data={base} donate={null} />);
    const mine = screen.getByRole("region", { name: "Tu participación" });
    expect(within(mine).getByTestId("my-share")).toHaveTextContent("0,2 %");
    expect(within(mine).getByTestId("my-shares")).toHaveTextContent("2,0·10¹⁹");
    expect(within(mine).getByTestId("my-net")).toHaveTextContent("20 USDC");
    expect(within(mine).queryByText("Pendiente de finalización")).toBeNull();
  });

  it("estimates when a pending donation will be credited, from the network's finality lag", () => {
    const createdAt = "2026-10-18T10:00:00Z";
    const now = Date.parse(createdAt) / 1000 + 3600; // mined an hour ago
    render(
      <DaoOverview
        data={{ ...base, myPending: [{ ledgerId: "l1", amount: 5_500_000n, txHash: HASH, createdAt }] }}
        donate={null}
        finality={{ lagSeconds: 6 * 3600, nowSeconds: now }}
      />,
    );
    expect(screen.getByText(/Tus participaciones se acreditan en ~5 h/)).toBeInTheDocument();
    expect(screen.getByText("+5,5 USDC tuyos en camino")).toBeInTheDocument();
  });

  it("lists pending donations with their state and an explorer link", () => {
    render(
      <DaoOverview
        data={{ ...base, myPending: [{ ledgerId: "l1", amount: 5_500_000n, txHash: HASH, createdAt: "2026-10-18T10:00:00Z" }] }}
        donate={null}
      />,
    );
    expect(screen.getByText("Confirmada en la red")).toBeInTheDocument();
    expect(screen.getByText(/se acreditan cuando Linea finalice el bloque/)).toBeInTheDocument();
    expect(screen.getAllByText("5,5 USDC").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Ver en el explorador/ })).toHaveAttribute("href", `https://sepolia.lineascan.build/tx/${HASH}`);
  });
});
