import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const setOverwriteAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/channels/actions", () => ({ setOverwriteAction, searchMembersAction: vi.fn().mockResolvedValue([]) }));

import { PermissionMatrix } from "@/components/settings/permission-matrix";

const CH = "6f1c1c5e-0000-4000-8000-0000000000c1";
const EV = "6f1c1c5e-0000-4000-8000-0000000000e1";
const MOD = "6f1c1c5e-0000-4000-8000-0000000000e2";
const roles = [
  { id: EV, name: "@everyone", color: "#A3A3A3", position: 0, isEveryone: true, isAdminRole: false },
  { id: MOD, name: "Moderador", color: "#FF5A5A", position: 500, isEveryone: false, isAdminRole: false },
];

function setup(over: Partial<React.ComponentProps<typeof PermissionMatrix>> = {}) {
  return render(
    <PermissionMatrix
      channelId={CH}
      overwrites={[{ targetType: "role", targetId: EV, allow: "0", deny: "0" }]}
      roles={roles}
      members={[]}
      actorChannelPerms="31759"
      isAdmin={false}
      actorTop={600}
      {...over}
    />,
  );
}

beforeEach(() => {
  refresh.mockReset();
  setOverwriteAction.mockReset().mockResolvedValue({});
});

describe("PermissionMatrix", () => {
  it("cycles allow -> deny -> inherit and saves the right payload", async () => {
    const user = userEvent.setup();
    setup();
    const cell = () => screen.getByRole("button", { name: /@everyone · Ver canal/ });
    expect(cell()).toHaveAccessibleName(/heredar/);
    await user.click(cell());
    expect(cell()).toHaveAccessibleName(/permitido/);
    await user.click(screen.getByRole("button", { name: "Guardar @everyone" }));
    await waitFor(() => expect(setOverwriteAction).toHaveBeenLastCalledWith(CH, "role", EV, "1", "0"));
    await user.click(cell());
    expect(cell()).toHaveAccessibleName(/denegado/);
    await user.click(screen.getByRole("button", { name: "Guardar @everyone" }));
    await waitFor(() => expect(setOverwriteAction).toHaveBeenLastCalledWith(CH, "role", EV, "0", "1"));
    await user.click(cell());
    expect(cell()).toHaveAccessibleName(/heredar/);
  });

  it("disables cells for bits the actor lacks", () => {
    setup({ actorChannelPerms: "1" });
    expect(screen.getByRole("button", { name: /@everyone · Ver canal/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /@everyone · Enviar mensajes/ })).toBeDisabled();
  });

  it("disables rows for roles at or above the actor", () => {
    setup({
      overwrites: [{ targetType: "role", targetId: MOD, allow: "0", deny: "0" }],
      actorTop: 500,
    });
    expect(screen.getByRole("button", { name: /Moderador · Ver canal/ })).toBeDisabled();
  });

  it("removing an existing row sends 0/0", async () => {
    const user = userEvent.setup();
    setup({ overwrites: [{ targetType: "role", targetId: MOD, allow: "1", deny: "0" }] });
    await user.click(screen.getByRole("button", { name: "Quitar Moderador" }));
    await waitFor(() => expect(setOverwriteAction).toHaveBeenCalledWith(CH, "role", MOD, "0", "0"));
  });

  it("adds a role row from the selector", async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByLabelText("Añadir rol"), MOD);
    expect(screen.getByRole("button", { name: /Moderador · Ver canal/ })).toBeInTheDocument();
  });

  it("shows the server error", async () => {
    const user = userEvent.setup();
    setOverwriteAction.mockResolvedValue({ error: "hierarchy" });
    setup();
    await user.click(screen.getByRole("button", { name: /@everyone · Ver canal/ }));
    await user.click(screen.getByRole("button", { name: "Guardar @everyone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/rango/);
  });
});
