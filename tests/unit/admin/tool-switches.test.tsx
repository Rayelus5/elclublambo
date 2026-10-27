import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const setSwitchAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/admin/actions", () => ({ setSwitchAction }));

import { ToolSwitches } from "@/components/admin/tool-switches";
import { OPEN_STATE } from "@/lib/admin/state";

const allOn = OPEN_STATE.switches;

beforeEach(() => {
  refresh.mockReset();
  setSwitchAction.mockReset().mockResolvedValue({ ok: true });
});

describe("ToolSwitches", () => {
  it("renders one named switch per key, with its state in text too, each at least 44px tall", () => {
    render(<ToolSwitches switches={{ ...allOn, gas: false }} />);
    expect(screen.getAllByRole("switch")).toHaveLength(10);
    const gas = screen.getByRole("switch", { name: "Gas" });
    expect(gas).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "ElClub Pay" })).toHaveAttribute("aria-checked", "true");
    expect(gas.className).toContain("min-h-11");
    expect(screen.getAllByText("Activo")).toHaveLength(9);
    expect(screen.getAllByText("Desactivado")).toHaveLength(1);
  });

  it("turning «Gas» off asks first and does nothing without «Confirmar»", async () => {
    const user = userEvent.setup();
    render(<ToolSwitches switches={allOn} />);
    await user.click(screen.getByRole("switch", { name: "Gas" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("¿Desactivar «Gas»?");
    expect(dialog).toHaveTextContent("Los visitantes verán «No disponible» hasta que lo actives.");
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(setSwitchAction).not.toHaveBeenCalled();
  });

  it("«Confirmar» turns it off and refreshes", async () => {
    const user = userEvent.setup();
    render(<ToolSwitches switches={allOn} />);
    await user.click(screen.getByRole("switch", { name: "Gas" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(setSwitchAction).toHaveBeenCalledWith("gas", false));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("turning one on does not ask", async () => {
    const user = userEvent.setup();
    render(<ToolSwitches switches={{ ...allOn, gas: false }} />);
    await user.click(screen.getByRole("switch", { name: "Gas" }));
    await waitFor(() => expect(setSwitchAction).toHaveBeenCalledWith("gas", true));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("an RPC error shows as an alert and keeps the state", async () => {
    setSwitchAction.mockResolvedValue({ ok: false, error: "forbidden" });
    const user = userEvent.setup();
    render(<ToolSwitches switches={{ ...allOn, gas: false }} />);
    await user.click(screen.getByRole("switch", { name: "Gas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso para hacer esto.");
    expect(screen.getByRole("switch", { name: "Gas" })).toHaveAttribute("aria-checked", "false");
    expect(refresh).not.toHaveBeenCalled();
  });
});
