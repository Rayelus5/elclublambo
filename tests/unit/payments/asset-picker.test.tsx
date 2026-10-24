import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AssetPicker } from "@/components/payments/asset-picker";
import { assetsFor, type AssetBalances, type AssetId } from "@/lib/economy/assets";

const TESTNET = assetsFor([84532, 421614]);
const ETH = 10n ** 18n;

function Controlled({ balances = {}, initial = null }: { balances?: AssetBalances; initial?: AssetId | null }) {
  const [value, setValue] = useState<AssetId | null>(initial);
  return <AssetPicker assets={TESTNET} balances={balances} amount={null} value={value} onChange={setValue} />;
}

describe("AssetPicker", () => {
  it("lists the payable asset first", () => {
    const balances: AssetBalances = { "ETH:421614": ETH, "ETH:84532": 0n, "USDC:84532": 0n, "USDC:421614": 0n };
    render(<AssetPicker assets={TESTNET} balances={balances} amount={10n ** 15n} value={null} onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(radios[0]).toHaveAccessibleName(/ETH.*Arbitrum Sepolia/);
    expect(screen.getByRole("radiogroup", { name: "Moneda" })).toBeInTheDocument();
  });

  it("shows the balance or a dash when unknown", () => {
    render(<AssetPicker assets={TESTNET} balances={{ "USDC:84532": 12_500_000n }} amount={null} value={null} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /USDC.*Base Sepolia/ })).toHaveTextContent("Saldo: 12,5");
    expect(screen.getByRole("radio", { name: /ETH.*Base Sepolia/ })).toHaveTextContent("—");
  });

  it("calls onChange with the clicked asset; zero-balance rows stay selectable", async () => {
    const onChange = vi.fn();
    render(<AssetPicker assets={TESTNET} balances={{ "USDC:84532": 0n }} amount={null} value={null} onChange={onChange} />);
    const row = screen.getByRole("radio", { name: /USDC.*Base Sepolia/ });
    expect(row).toBeEnabled();
    await userEvent.click(row);
    expect(onChange).toHaveBeenCalledWith("USDC:84532");
  });

  it("moves the selection and focus with the arrow keys (roving tabindex)", async () => {
    render(<Controlled initial="USDC:84532" />);
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);
    radios[0]!.focus();
    await userEvent.keyboard("{ArrowDown}");
    const after = screen.getAllByRole("radio");
    expect(after[1]).toHaveAttribute("aria-checked", "true");
    expect(after[1]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getAllByRole("radio")[3]).toHaveAttribute("aria-checked", "true");
  });

  it.each(["{Alt>}{ArrowDown}{/Alt}", "{Control>}{ArrowDown}{/Control}", "{Meta>}{End}{/Meta}"])(
    "leaves modified keys (%s) to the browser and assistive tech",
    async (keys) => {
      const onChange = vi.fn();
      render(<AssetPicker assets={TESTNET} balances={{}} amount={null} value="USDC:84532" onChange={onChange} />);
      screen.getAllByRole("radio")[0]!.focus();
      await userEvent.keyboard(keys);
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getAllByRole("radio")[0]).toHaveFocus();
    },
  );

  it("is reachable by Tab on the first row when nothing is chosen", () => {
    render(<Controlled />);
    expect(screen.getAllByRole("radio").map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it("shows the USDC.e note only with Arbitrum USDC", () => {
    const note = "En Arbitrum solo vale USDC nativo (no USDC.e).";
    const { rerender } = render(<AssetPicker assets={TESTNET} balances={{}} amount={null} value={null} onChange={() => {}} />);
    expect(screen.getByText(note)).toBeInTheDocument();
    rerender(<AssetPicker assets={assetsFor([8453, 42161])} balances={{}} amount={null} value={null} onChange={() => {}} />);
    expect(screen.getByText(note)).toBeInTheDocument();
    rerender(<AssetPicker assets={assetsFor([84532, 421614], ["base"])} balances={{}} amount={null} value={null} onChange={() => {}} />);
    expect(screen.queryByText(note)).not.toBeInTheDocument();
    const ethOnly = TESTNET.filter((a) => a.token === "ETH");
    rerender(<AssetPicker assets={ethOnly} balances={{}} amount={null} value={null} onChange={() => {}} />);
    expect(screen.queryByText(note)).not.toBeInTheDocument();
  });

  it("uses a custom label", () => {
    render(<AssetPicker assets={TESTNET} balances={{}} amount={null} value={null} onChange={() => {}} label="Paga con" />);
    expect(screen.getByRole("radiogroup", { name: "Paga con" })).toBeInTheDocument();
  });

  it("caps long ETH balances at 6 decimals", () => {
    render(<AssetPicker assets={TESTNET} balances={{ "ETH:84532": 123_456_789_012_345_678n, "ETH:421614": 1n }} amount={null} value={null} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /ETH.*Base Sepolia/ })).toHaveTextContent("Saldo: 0,123456");
    expect(screen.getByRole("radio", { name: /ETH.*Arbitrum Sepolia/ })).toHaveTextContent("Saldo: < 0,000001");
  });
});
