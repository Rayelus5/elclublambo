import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const createRoleAction = vi.hoisted(() => vi.fn());
const updateRoleAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/roles/actions", () => ({
  createRoleAction,
  updateRoleAction,
  deleteRoleAction: vi.fn(),
  moveRoleAction: vi.fn(),
}));

import { RoleForm } from "@/components/settings/role-form";

const actor = (over = {}) => ({ isAdmin: false, perms: "16", top: 600, ...over });
const role = (over = {}) => ({
  id: "6f1c1c5e-0000-4000-8000-0000000000a1",
  name: "VIP",
  color: "#3DDC84",
  position: 10,
  permissions: "16",
  isEveryone: false,
  isSystem: false,
  systemKey: null,
  ...over,
});

beforeEach(() => {
  refresh.mockReset();
  createRoleAction.mockReset().mockResolvedValue({ id: "x" });
  updateRoleAction.mockReset().mockResolvedValue({});
});

describe("RoleForm", () => {
  it("disables bits the actor lacks and never offers Administrador", () => {
    render(<RoleForm role={null} actor={actor()} />);
    expect(screen.getByLabelText("Crear invitaciones")).toBeEnabled();
    expect(screen.getByLabelText("Banear miembros")).toBeDisabled();
    expect(screen.queryByLabelText(/Administrador/i)).toBeNull();
  });

  it("admin can toggle every offered bit", () => {
    render(<RoleForm role={null} actor={actor({ isAdmin: true, perms: "65535" })} />);
    expect(screen.getByLabelText("Banear miembros")).toBeEnabled();
    expect(screen.getAllByRole("checkbox")).toHaveLength(15);
  });

  it("rejects an invalid custom color without calling the action", async () => {
    const user = userEvent.setup();
    render(<RoleForm role={null} actor={actor()} />);
    await user.type(screen.getByLabelText("Nombre"), "VIP");
    await user.type(screen.getByLabelText("Color personalizado"), "#12");
    await user.click(screen.getByRole("button", { name: "Crear rol" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/hex/i);
    expect(createRoleAction).not.toHaveBeenCalled();
  });

  it("creates with palette color and selected bits", async () => {
    const user = userEvent.setup();
    render(<RoleForm role={null} actor={actor()} />);
    await user.type(screen.getByLabelText("Nombre"), "VIP");
    await user.click(screen.getByRole("radio", { name: "#FFB020" }));
    await user.click(screen.getByLabelText("Crear invitaciones"));
    await user.click(screen.getByRole("button", { name: "Crear rol" }));
    await waitFor(() =>
      expect(createRoleAction).toHaveBeenCalledWith({ name: "VIP", color: "#FFB020", permissions: "16" }),
    );
  });

  it("uppercases a valid custom hex", async () => {
    const user = userEvent.setup();
    render(<RoleForm role={role()} actor={actor()} />);
    await user.type(screen.getByLabelText("Color personalizado"), "#aabbcc");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(updateRoleAction).toHaveBeenCalledWith({
        id: role().id,
        name: "VIP",
        color: "#AABBCC",
        permissions: "16",
      }),
    );
  });

  it("locks the name of system_key roles and restricts global bits for non-admins", () => {
    render(
      <RoleForm role={role({ systemKey: "verified", permissions: "3072" })} actor={actor({ perms: "65023" })} />,
    );
    expect(screen.getByLabelText("Nombre")).toBeDisabled();
    expect(screen.getByText("Nombre fijo del sistema")).toBeInTheDocument();
    expect(screen.getByLabelText("Banear miembros")).toBeDisabled();
    expect(screen.getByLabelText("Crear invitaciones")).toBeEnabled();
    expect(screen.getByLabelText("Adjuntar imágenes")).toBeEnabled();
  });

  it("@everyone: only permissions are editable", () => {
    render(
      <RoleForm
        role={role({ isEveryone: true, name: "@everyone", position: 0 })}
        actor={actor({ perms: "65023" })}
      />,
    );
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(screen.queryByLabelText("Color personalizado")).toBeNull();
  });
});
