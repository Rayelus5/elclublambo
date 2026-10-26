import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Review Focus 2: the browser's own zone. Madrid is UTC+1 on 2026-11-01 (summer time ended on 2026-10-25).
const PREVIOUS_TZ = process.env.TZ;
process.env.TZ = "Europe/Madrid";

const refresh = vi.hoisted(() => vi.fn());
const actions = vi.hoisted(() => ({
  setMaintenanceAction: vi.fn(),
  setMaintenancePasswordAction: vi.fn(),
  setSwitchAction: vi.fn(),
  addAccessWalletAction: vi.fn(),
  removeAccessWalletAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/admin/actions", () => actions);

import { AccessList } from "@/components/admin/access-list";
import { AdminHistory } from "@/components/admin/admin-history";
import { MaintenanceForm } from "@/components/admin/maintenance-form";
import { ToolSwitches } from "@/components/admin/tool-switches";
import { OPEN_STATE, type MaintenanceConfig } from "@/lib/admin/state";

const OFF: MaintenanceConfig = OPEN_STATE.maintenance;
const CONFIRM_TEXT = "La web se cerrará al público. Tú seguirás entrando.";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-26T12:00:00.000Z") });
  refresh.mockReset();
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => vi.useRealTimers());
afterAll(() => {
  process.env.TZ = PREVIOUS_TZ;
});

async function chooseCustom(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("radio", { name: "Personalizado" }));
  await user.type(screen.getByLabelText("Mensaje en español"), "Volvemos pronto");
  await user.type(screen.getByLabelText("Mensaje en inglés"), "Back soon");
}

describe("MaintenanceForm", () => {
  it("Review Focus 2: «Empieza» 2026-11-01T10:00 in Madrid reaches the action as 09:00 UTC", async () => {
    const user = userEvent.setup();
    render(<MaintenanceForm maintenance={OFF} passwordSet />);
    await chooseCustom(user);
    fireEvent.change(screen.getByLabelText("Empieza"), { target: { value: "2026-11-01T10:00" } });
    await user.click(screen.getByRole("button", { name: "Guardar mantenimiento" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(CONFIRM_TEXT);
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(actions.setMaintenanceAction).toHaveBeenCalledWith({
        enabled: false,
        mode: "custom",
        messageEs: "Volvemos pronto",
        messageEn: "Back soon",
        returnAt: null,
        startsAt: "2026-11-01T09:00:00.000Z",
        endsAt: null,
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("prefills the dates in the browser's local time and shows «Programado»", () => {
    render(
      <MaintenanceForm
        maintenance={{ ...OFF, mode: "custom", messageEs: "a", messageEn: "b", startsAt: "2026-11-01T09:00:00.000Z", endsAt: "2026-11-01T11:30:00.000Z" }}
        passwordSet
      />,
    );
    expect(screen.getByLabelText("Empieza")).toHaveValue("2026-11-01T10:00");
    expect(screen.getByLabelText("Termina")).toHaveValue("2026-11-01T12:30");
    expect(screen.getByLabelText("Mensaje en español")).toHaveValue("a");
    expect(screen.getByText("Programado")).toBeInTheDocument();
  });

  it.each([
    [{ ...OFF, enabled: true }, "Activo ahora"],
    [OFF, "Apagado"],
    [{ ...OFF, mode: "custom" as const, messageEs: "a", messageEn: "b", startsAt: "2026-10-26T11:00:00.000Z" }, "Activo ahora"],
    [{ ...OFF, enabled: true, mode: "custom" as const, messageEs: "a", messageEn: "b", endsAt: "2026-10-26T11:00:00.000Z" }, "Apagado"],
  ])("state %#: %s", (maintenance, label) => {
    render(<MaintenanceForm maintenance={maintenance} passwordSet />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("«Por defecto» hides the messages and the dates", async () => {
    const user = userEvent.setup();
    render(<MaintenanceForm maintenance={OFF} passwordSet />);
    expect(screen.getByRole("radio", { name: "Por defecto" })).toBeChecked();
    for (const label of ["Mensaje en español", "Mensaje en inglés", "Vuelta estimada", "Empieza", "Termina"]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    await user.click(screen.getByRole("radio", { name: "Personalizado" }));
    expect(screen.getByLabelText("Mensaje en español")).toHaveAttribute("maxLength", "500");
    expect(screen.getByLabelText("Vuelta estimada")).toHaveAttribute("type", "datetime-local");
    await user.click(screen.getByRole("radio", { name: "Por defecto" }));
    expect(screen.queryByLabelText("Empieza")).toBeNull();
  });

  it("activating asks first; «Cancelar» saves nothing, «Confirmar» saves the default mode", async () => {
    const user = userEvent.setup();
    render(<MaintenanceForm maintenance={OFF} passwordSet />);
    await user.click(screen.getByRole("checkbox", { name: "Activar ahora" }));
    await user.click(screen.getByRole("button", { name: "Guardar mantenimiento" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(CONFIRM_TEXT);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(actions.setMaintenanceAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Guardar mantenimiento" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(actions.setMaintenanceAction).toHaveBeenCalledWith({
        enabled: true,
        mode: "default",
        messageEs: null,
        messageEn: null,
        returnAt: null,
        startsAt: null,
        endsAt: null,
      }),
    );
  });

  it("saving a setup that neither starts now nor is scheduled does not ask, and the form explains it", async () => {
    const user = userEvent.setup();
    render(<MaintenanceForm maintenance={OFF} passwordSet />);
    await chooseCustom(user);
    expect(screen.getByText(/se guarda sin cerrar la web/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar mantenimiento" }));
    await waitFor(() => expect(actions.setMaintenanceAction).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, mode: "custom", startsAt: null })));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("«Desactivar mantenimiento» is outline, does not ask and keeps the custom texts", async () => {
    const user = userEvent.setup();
    render(
      <MaintenanceForm
        maintenance={{ ...OFF, enabled: true, mode: "custom", messageEs: "a", messageEn: "b", returnAt: "2026-10-26T15:00:00.000Z" }}
        passwordSet
      />,
    );
    const off = screen.getByRole("button", { name: "Desactivar mantenimiento" });
    expect(off).toHaveAttribute("data-variant", "outline");
    await user.click(off);
    await waitFor(() =>
      expect(actions.setMaintenanceAction).toHaveBeenCalledWith({
        enabled: false,
        mode: "custom",
        messageEs: "a",
        messageEn: "b",
        returnAt: null,
        startsAt: null,
        endsAt: null,
      }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("an RPC error shows as an alert", async () => {
    actions.setMaintenanceAction.mockResolvedValue({ ok: false, error: "maintenance_invalid" });
    const user = userEvent.setup();
    render(<MaintenanceForm maintenance={OFF} passwordSet />);
    await chooseCustom(user);
    await user.click(screen.getByRole("button", { name: "Guardar mantenimiento" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  // Stored dates that have already passed (now = 2026-10-26T12:00Z): meaningless once past, and the RPC rejects a past
  // «Vuelta estimada» or «Termina», so they are dropped from the draft instead of blocking every edit.
  const ACTIVE_PAST_RETURN: MaintenanceConfig = {
    ...OFF,
    enabled: true,
    mode: "custom",
    messageEs: "a",
    messageEn: "b",
    returnAt: "2026-10-26T11:00:00.000Z",
    startsAt: "2026-10-26T08:00:00.000Z",
  };

  it("a stored «Vuelta estimada» that has passed is left out: the input is empty and the save sends null", async () => {
    const user = userEvent.setup();
    render(<MaintenanceForm maintenance={ACTIVE_PAST_RETURN} passwordSet />);
    expect(screen.getByLabelText("Vuelta estimada")).toHaveValue("");
    // A past «Empieza» is still the schedule that keeps it on: it stays.
    expect(screen.getByLabelText("Empieza")).toHaveValue("2026-10-26T09:00");
    await user.type(screen.getByLabelText("Mensaje en español"), "!");
    await user.click(screen.getByRole("button", { name: "Guardar mantenimiento" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(actions.setMaintenanceAction).toHaveBeenCalledWith({
        enabled: true,
        mode: "custom",
        messageEs: "a!",
        messageEn: "b",
        returnAt: null,
        startsAt: "2026-10-26T08:00:00.000Z",
        endsAt: null,
      }),
    );
  });

  it("a stored «Termina» that has passed is left out too", async () => {
    const user = userEvent.setup();
    render(<MaintenanceForm maintenance={{ ...OFF, mode: "custom", messageEs: "a", messageEn: "b", endsAt: "2026-10-26T11:59:00.000Z" }} passwordSet />);
    expect(screen.getByLabelText("Termina")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Guardar mantenimiento" }));
    await waitFor(() => expect(actions.setMaintenanceAction).toHaveBeenCalledWith(expect.objectContaining({ endsAt: null, returnAt: null })));
  });

  it("a window that has already ended starts with «Activar ahora» unticked, so re-saving does not reopen it", async () => {
    const user = userEvent.setup();
    render(
      <MaintenanceForm
        maintenance={{ ...OFF, enabled: true, mode: "custom", messageEs: "a", messageEn: "b", endsAt: "2026-10-26T11:00:00.000Z" }}
        passwordSet
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Activar ahora" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Guardar mantenimiento" }));
    expect(screen.queryByText(CONFIRM_TEXT)).not.toBeInTheDocument();
    await waitFor(() => expect(actions.setMaintenanceAction).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, endsAt: null })));
  });

  it("a future stored date is kept", async () => {
    const user = userEvent.setup();
    render(<MaintenanceForm maintenance={{ ...ACTIVE_PAST_RETURN, returnAt: "2026-10-26T13:00:00.000Z" }} passwordSet />);
    expect(screen.getByLabelText("Vuelta estimada")).toHaveValue("2026-10-26T14:00");
    await user.click(screen.getByRole("button", { name: "Guardar mantenimiento" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(actions.setMaintenanceAction).toHaveBeenCalledWith(expect.objectContaining({ returnAt: "2026-10-26T13:00:00.000Z" })));
  });

  it("if the RPC still rejects a past date, the error names it", async () => {
    actions.setMaintenanceAction.mockResolvedValue({ ok: false, error: "maintenance_invalid" });
    const user = userEvent.setup();
    render(<MaintenanceForm maintenance={OFF} passwordSet />);
    await chooseCustom(user);
    fireEvent.change(screen.getByLabelText("Vuelta estimada"), { target: { value: "2026-10-26T10:00" } });
    await user.click(screen.getByRole("button", { name: "Guardar mantenimiento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^La vuelta estimada ya ha pasado \(26 oct.*10:00\)/);
  });

  it("names «Termina» when it has passed, or when it is not after «Empieza»", async () => {
    actions.setMaintenanceAction.mockResolvedValue({ ok: false, error: "maintenance_invalid" });
    const user = userEvent.setup();
    render(<MaintenanceForm maintenance={OFF} passwordSet />);
    await chooseCustom(user);
    fireEvent.change(screen.getByLabelText("Termina"), { target: { value: "2026-10-26T12:30" } });
    await user.click(screen.getByRole("button", { name: "Guardar mantenimiento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^El fin ya ha pasado \(26 oct.*12:30\)/);
    fireEvent.change(screen.getByLabelText("Empieza"), { target: { value: "2026-11-02T10:00" } });
    fireEvent.change(screen.getByLabelText("Termina"), { target: { value: "2026-11-02T09:00" } });
    await user.click(screen.getByRole("button", { name: "Guardar mantenimiento" }));
    await user.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("«Termina» tiene que ir después de «Empieza»."));
  });

  it("Review Focus 4: without a password it warns that only the SuperAdmin can get in", () => {
    render(<MaintenanceForm maintenance={OFF} passwordSet={false} />);
    expect(screen.getByText("Sin contraseña, solo tú podrás entrar.")).toBeInTheDocument();
    expect(screen.getByText("Sin fijar")).toBeInTheDocument();
  });

  it("with a password it shows when it was set and no warning", () => {
    render(<MaintenanceForm maintenance={OFF} passwordSet passwordUpdatedAt="2026-10-20T08:00:00.123+00:00" />);
    expect(screen.queryByText("Sin contraseña, solo tú podrás entrar.")).toBeNull();
    expect(screen.getByText(/^Fijada el/)).toBeInTheDocument();
  });

  it("the password is a password field; a short one is rejected locally, a good one is sent and cleared", async () => {
    const user = userEvent.setup();
    render(<MaintenanceForm maintenance={OFF} passwordSet={false} />);
    const field = screen.getByLabelText("Contraseña de mantenimiento");
    expect(field).toHaveAttribute("type", "password");
    await user.type(field, "corta");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("entre 12 y 128 caracteres");
    expect(actions.setMaintenancePasswordAction).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));
    await waitFor(() => expect(actions.setMaintenancePasswordAction).toHaveBeenCalledWith("correct horse battery"));
    await waitFor(() => expect(field).toHaveValue(""));
    expect(screen.getByRole("button", { name: "Guardar contraseña" })).toHaveAttribute("data-variant", "outline");
  });
});

describe("the mounted tab", () => {
  it("has exactly one brand fill: «Guardar mantenimiento»", () => {
    const { container } = render(
      <div>
        <ToolSwitches switches={OPEN_STATE.switches} />
        <MaintenanceForm maintenance={{ ...OFF, enabled: true }} passwordSet={false} />
        <AccessList items={[{ wallet: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", note: null, createdAt: "2026-10-26T10:00:00+00:00" }]} />
        <AdminHistory history={[{ at: "2026-10-26T10:00:00+00:00", actor: "@ray", action: "admin.switch", payload: { key: "gas", enabled: false } }]} />
      </div>,
    );
    const fills = [...container.querySelectorAll("*")].filter((el) =>
      String(el.getAttribute("class") ?? "").split(/\s+/).includes("bg-accent-fill"),
    );
    expect(fills).toHaveLength(1);
    expect(fills[0]).toHaveTextContent("Guardar mantenimiento");
  });
});

describe("AdminHistory", () => {
  it("lists each change with its time, actor and description", () => {
    render(
      <AdminHistory
        history={[
          { at: "2026-10-26T10:00:00.5+00:00", actor: "@ray", action: "admin.switch", payload: { key: "gas", enabled: false } },
          { at: "2026-10-26T09:00:00+00:00", actor: "0x7099…79c8", action: "admin.maintenance_password", payload: {} },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("@ray");
    expect(items[0]).toHaveTextContent("Desactivó «Gas»");
    expect(items[0]!.querySelector("time")).toHaveAttribute("dateTime", "2026-10-26T10:00:00.5+00:00");
    expect(items[1]).toHaveTextContent("Cambió la contraseña de mantenimiento");
  });

  it("says so when there is no history", () => {
    render(<AdminHistory history={[]} />);
    expect(screen.getByText("Todavía no hay cambios.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
