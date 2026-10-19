import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createRaffleAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/treasury/raffle-actions", () => ({ createRaffleAction }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CreateRaffleDialog } from "@/components/treasury/treasurer/create-raffle-dialog";

const COMMIT = `0x${"ef".repeat(32)}`;
// 1000 USD fund; ETH at 2000 USD.
const NAV = 1_000_000_000n;
const PRICE = 2000_00000000n;

beforeEach(() => {
  createRaffleAction.mockReset();
  refresh.mockReset();
});

async function openDialog(props: Partial<React.ComponentProps<typeof CreateRaffleDialog>> = {}) {
  render(<CreateRaffleDialog weightedEnabled navUsd6={NAV} ethPriceE8={PRICE} {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Crear sorteo" }));
  return screen.getByRole("dialog", { name: "Crear sorteo" });
}

async function fill(d: HTMLElement, { title = "Sorteo de otoño", prize = "50", closes = "2026-10-25T18:30" } = {}) {
  await userEvent.type(within(d).getByLabelText("Título"), title);
  await userEvent.type(within(d).getByLabelText("Premio"), prize);
  // userEvent.type does not drive datetime-local reliably in jsdom.
  const input = within(d).getByLabelText("Cierre") as HTMLInputElement;
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.change(input, { target: { value: closes } });
}

describe("CreateRaffleDialog", () => {
  it("has the fields, the datetime help and a USDC/equal default", async () => {
    const d = await openDialog();
    expect(within(d).getByLabelText("Título")).toBeInTheDocument();
    expect(within(d).getByRole("radio", { name: "USDC" })).toBeChecked();
    expect(within(d).getByRole("radio", { name: "WETH" })).not.toBeChecked();
    expect(within(d).getByLabelText("Cierre")).toHaveAttribute("type", "datetime-local");
    expect(within(d).getByText("Entre 1 hora y 30 días desde ahora.")).toBeInTheDocument();
    expect(within(d).getByRole("radio", { name: "Igualitario" })).toBeChecked();
    expect(within(d).getByRole("radio", { name: "Ponderado por participación" })).toBeEnabled();
  });

  it("disables the weighted mode, with the reason, when the network has it off", async () => {
    const d = await openDialog({ weightedEnabled: false });
    expect(within(d).getByRole("radio", { name: "Ponderado por participación" })).toBeDisabled();
    expect(within(d).getByText("Los sorteos ponderados no están activados en esta red.")).toBeInTheDocument();
  });

  it("explains WETH when chosen", async () => {
    const d = await openDialog();
    expect(within(d).queryByText(/un envío de ETH nativo/)).toBeNull();
    await userEvent.click(within(d).getByRole("radio", { name: "WETH" }));
    expect(within(d).getByText(/un envío de ETH nativo/)).toBeInTheDocument();
  });

  it("estimates the drop of the share value from the prize (USDC: 50 of 1000 = 5 %)", async () => {
    const d = await openDialog();
    await userEvent.type(within(d).getByLabelText("Premio"), "50");
    expect(
      within(d).getByText("El premio se reserva del fondo desde ahora: el valor de cada participación baja ≈ 5 %. No cambia el % de nadie."),
    ).toBeInTheDocument();
  });

  it("estimates a WETH prize at the latest price (0,1 WETH = 200 USD = 20 %)", async () => {
    const d = await openDialog();
    await userEvent.click(within(d).getByRole("radio", { name: "WETH" }));
    await userEvent.type(within(d).getByLabelText("Premio"), "0,1");
    expect(within(d).getByText(/baja ≈ 20 %\./)).toBeInTheDocument();
  });

  it("does not guess the drop for WETH without a price", async () => {
    const d = await openDialog({ ethPriceE8: null });
    await userEvent.click(within(d).getByRole("radio", { name: "WETH" }));
    await userEvent.type(within(d).getByLabelText("Premio"), "0,1");
    expect(within(d).queryByText(/baja ≈/)).toBeNull();
    expect(within(d).getByText(/El premio se reserva del fondo desde ahora/)).toBeInTheDocument();
  });

  it("sends the close as ISO and shows the public commit on success", async () => {
    createRaffleAction.mockResolvedValue({ ok: true, id: "r1", commit: COMMIT });
    const d = await openDialog();
    await fill(d);
    await userEvent.click(within(d).getByRole("button", { name: "Crear sorteo" }));
    expect(createRaffleAction).toHaveBeenCalledTimes(1);
    const arg = createRaffleAction.mock.calls[0]![0] as { title: string; prizeToken: string; prize: string; closesAt: string; mode: string };
    expect(arg).toMatchObject({ title: "Sorteo de otoño", prizeToken: "USDC", prize: "50", mode: "equal" });
    expect(arg.closesAt).toBe(new Date("2026-10-25T18:30").toISOString());
    expect(arg.closesAt).toMatch(/Z$/);
    expect(await screen.findByText(`Sorteo creado. Su compromiso ya es público: ${COMMIT}`)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it.each([
    ["prize_too_large", "El premio vale más que el fondo."],
    ["closes_at_invalid", "El cierre debe estar entre 1 hora y 30 días desde ahora."],
  ])("shows %s", async (code, error) => {
    createRaffleAction.mockResolvedValue({ ok: false, code, error });
    const d = await openDialog();
    await fill(d);
    await userEvent.click(within(d).getByRole("button", { name: "Crear sorteo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(error);
  });

  it("blocks an empty title, an empty prize and a missing close without calling the action", async () => {
    const d = await openDialog();
    expect(within(d).getByRole("button", { name: "Crear sorteo" })).toBeDisabled();
    await fill(d, { title: "x", prize: "50", closes: "2026-10-25T18:30" });
    expect(within(d).getByRole("button", { name: "Crear sorteo" })).toBeEnabled();
    expect(createRaffleAction).not.toHaveBeenCalled();
  });
});
