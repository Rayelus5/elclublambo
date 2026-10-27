import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const createGiveawayAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giveaways/actions", () => ({ createGiveawayAction }));

import { CreateGiveawayTrigger } from "@/components/giveaways/create-giveaway-dialog";

const ROLE = "22222222-2222-4222-8222-222222222222";
const NEW_ID = "33333333-3333-4333-8333-333333333333";

/** A datetime-local value (local time, minutes) `ms` from now. */
function localIn(ms: number): string {
  const d = new Date(Date.now() + ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

beforeEach(() => {
  push.mockReset();
  createGiveawayAction.mockReset().mockResolvedValue({ ok: true, id: NEW_ID, commit: `0x${"ab".repeat(32)}`, targetRound: 1 });
});

async function open() {
  render(<CreateGiveawayTrigger chains={[84532, 421614]} roles={[{ id: ROLE, name: "Veterano", color: "#22d3ee" }]} />);
  await userEvent.click(screen.getByRole("button", { name: "Crear sorteo" }));
  return screen.getByRole("dialog", { name: "Crear sorteo" });
}

describe("CreateGiveawayDialog", () => {
  it("says it is free and equal for everyone", async () => {
    const dialog = await open();
    expect(within(dialog).getByText("Gratis: nunca se paga por participar. Todos tienen la misma probabilidad.")).toBeInTheDocument();
  });

  it("sends the prizes with their kind, and the close as an ISO instant", async () => {
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText("Título"), "Sorteo de otoño");
    const close = localIn(2 * 3600_000);
    fireEvent.change(within(dialog).getByLabelText("Cierre"), { target: { value: close } });

    const add = within(dialog).getByRole("button", { name: "Añadir premio" });
    await userEvent.type(within(dialog).getByLabelText("Importe en USDC"), "5");
    await userEvent.click(add);
    const second = within(dialog).getByRole("group", { name: "Premio 2" });
    await userEvent.click(within(second).getByRole("radio", { name: "Rol" }));
    await userEvent.selectOptions(within(second).getByRole("combobox", { name: "Rol" }), ROLE);
    await userEvent.click(add);
    const third = within(dialog).getByRole("group", { name: "Premio 3" });
    await userEvent.click(within(third).getByRole("radio", { name: "Otro" }));
    await userEvent.type(within(third).getByLabelText("Premio"), "Camiseta");

    await userEvent.click(within(dialog).getByRole("button", { name: "Crear sorteo" }));
    expect(createGiveawayAction).toHaveBeenCalledTimes(1);
    const input = createGiveawayAction.mock.calls[0]![0];
    expect(input).toMatchObject({
      title: "Sorteo de otoño",
      description: null,
      prizes: [
        { kind: "crypto", chainId: 84532, amount: "5" },
        { kind: "role", roleId: ROLE },
        { kind: "custom", label: "Camiseta" },
      ],
    });
    expect(input.closesAt).toBe(new Date(close).toISOString());
    expect(push).toHaveBeenCalledWith(`/foro/sorteos/${NEW_ID}`);
  });

  it("refuses a close sooner than 10 minutes without calling the server", async () => {
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText("Título"), "Rápido");
    fireEvent.change(within(dialog).getByLabelText("Cierre"), { target: { value: localIn(2 * 60_000) } });
    await userEvent.type(within(dialog).getByLabelText("Importe en USDC"), "5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Crear sorteo" }));
    expect(createGiveawayAction).not.toHaveBeenCalled();
    expect(within(dialog).getByText("El cierre debe estar entre 10 minutos y 30 días desde ahora.")).toBeInTheDocument();
  });

  it("shows the server's refusal", async () => {
    createGiveawayAction.mockResolvedValue({ ok: false, code: "role_not_allowed", error: "Ese rol no se puede sortear." });
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText("Título"), "X");
    fireEvent.change(within(dialog).getByLabelText("Cierre"), { target: { value: localIn(3600_000) } });
    await userEvent.type(within(dialog).getByLabelText("Importe en USDC"), "1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Crear sorteo" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Ese rol no se puede sortear.");
    expect(push).not.toHaveBeenCalled();
  });
});
