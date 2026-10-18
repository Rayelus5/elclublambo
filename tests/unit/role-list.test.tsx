import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const moveRoleAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/roles/actions", () => ({ moveRoleAction, deleteRoleAction: vi.fn() }));
vi.mock("@/components/settings/role-form", () => ({ RoleForm: () => null }));

import { RoleList } from "@/components/settings/role-list";
import type { RoleItem } from "@/lib/roles/rules";

const role = (id: string, name: string, position: number, extra: Partial<RoleItem> = {}): RoleItem => ({
  id,
  name,
  color: "#61dfff",
  position,
  permissions: "0",
  isEveryone: false,
  isSystem: false,
  systemKey: null,
  ...extra,
});
const ROLES = [
  role("sa", "SuperAdmin", 1000, { isSystem: true }),
  role("mod", "Moderador", 500),
  role("sop", "Soporte", 100),
  role("ver", "Verificado", 20, { systemKey: "verified" }),
  role("ev", "@everyone", 0, { isEveryone: true }),
];
const admin = { isAdmin: true, top: 1000 };

beforeEach(() => {
  refresh.mockReset();
  moveRoleAction.mockReset().mockResolvedValue({});
});

describe("RoleList drag & drop", () => {
  it("offers a drag handle on every role but SuperAdmin and @everyone, and no up/down buttons", () => {
    render(<RoleList roles={ROLES} actor={admin} />);
    expect(screen.getByRole("button", { name: "Reordenar Moderador" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reordenar Verificado" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reordenar SuperAdmin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reordenar @everyone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Subir / })).not.toBeInTheDocument();
    expect(screen.getByText(/Arrastra para ordenar/)).toBeInTheDocument();
  });

  it("a delegate gets no handle on roles they cannot move", () => {
    render(<RoleList roles={ROLES} actor={{ isAdmin: false, top: 500 }} />);
    expect(screen.queryByRole("button", { name: "Reordenar Moderador" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reordenar Verificado" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reordenar Soporte" })).toBeInTheDocument();
  });

  it("moving Moderador below Soporte with the keyboard sends move_role just above the role beneath it", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const i = this.tagName === "LI" ? [...document.querySelectorAll("li")].indexOf(this as HTMLLIElement) : 0;
      const top = Math.max(i, 0) * 48;
      return { x: 0, y: top, top, left: 0, right: 400, bottom: top + 48, width: 400, height: 48, toJSON: () => ({}) };
    });
    render(<RoleList roles={ROLES} actor={admin} />);
    const handle = screen.getByRole("button", { name: "Reordenar Moderador" });
    handle.focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
    await waitFor(() => expect(moveRoleAction).toHaveBeenCalledTimes(1));
    // new order: SuperAdmin, Soporte, Moderador, Verificado(20), @everyone -> just above Verificado
    expect(moveRoleAction).toHaveBeenCalledWith("mod", 21);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    spy.mockRestore();
  });

  it("reverts and explains when the server refuses the move", async () => {
    const user = userEvent.setup();
    moveRoleAction.mockResolvedValue({ error: "hierarchy" });
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const i = this.tagName === "LI" ? [...document.querySelectorAll("li")].indexOf(this as HTMLLIElement) : 0;
      const top = Math.max(i, 0) * 48;
      return { x: 0, y: top, top, left: 0, right: 400, bottom: top + 48, width: 400, height: 48, toJSON: () => ({}) };
    });
    render(<RoleList roles={ROLES} actor={admin} />);
    screen.getByRole("button", { name: "Reordenar Moderador" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const names = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(names.findIndex((n) => n.includes("Moderador"))).toBeLessThan(names.findIndex((n) => n.includes("Soporte")));
    spy.mockRestore();
  });
});
