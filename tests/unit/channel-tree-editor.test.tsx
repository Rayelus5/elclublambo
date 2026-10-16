import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const moveChannelAction = vi.hoisted(() => vi.fn());
const createChannelAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/channels/actions", () => ({
  moveChannelAction,
  createChannelAction,
  updateChannelAction: vi.fn(),
  deleteChannelAction: vi.fn(),
  setOverwriteAction: vi.fn(),
  searchMembersAction: vi.fn(),
}));

import { ChannelTreeEditor } from "@/components/settings/channel-tree-editor";
import { buildTree, validParents, type ChannelDetailRow } from "@/lib/channels/tree";

const d = (
  id: string,
  parentId: string | null,
  kind: ChannelDetailRow["kind"],
  name: string,
  position: number,
): ChannelDetailRow => ({
  id,
  parentId,
  kind,
  name,
  topic: null,
  position,
  slowmodeSeconds: 0,
  ticketsEnabled: false,
  alphaEnabled: false,
});

const ROWS: ChannelDetailRow[] = [
  d("cat1", null, "category", "Comunidad", 1),
  d("gen", "cat1", "text", "General", 1),
  d("rul", "cat1", "text", "Reglas", 2),
  d("ann", "cat1", "text", "Anuncios", 3),
  d("cat2", null, "category", "Mercado", 2),
  d("air", "cat2", "forum", "Airdrops", 1),
  d("sub", "air", "forum", "Subforo", 1),
  d("l1", "sub", "text", "L1", 1),
  d("tr", "cat2", "text", "Trading", 2),
];

beforeEach(() => {
  refresh.mockReset();
  moveChannelAction.mockReset();
  createChannelAction.mockReset();
});

describe("validParents", () => {
  const tree = buildTree(ROWS);
  const node = (id: string) => ROWS.find((r) => r.id === id)!;

  it("a category can only go to the root", () => {
    expect(validParents(tree, node("cat1"))).toEqual([{ id: null, label: "Raíz" }]);
  });

  it("a forum excludes its own subtree, text nodes and the root", () => {
    const ids = validParents(tree, node("air")).map((o) => o.id);
    expect(ids).toEqual(["cat1", "cat2"]);
    expect(ids).not.toContain("air");
    expect(ids).not.toContain("sub");
    expect(ids).not.toContain(null);
  });

  it("a text channel can go under any category or forum, never text or root", () => {
    const ids = validParents(tree, node("l1")).map((o) => o.id);
    expect(ids).toEqual(["cat1", "cat2", "air", "sub"]);
  });

  it("labels options with the path", () => {
    const labels = validParents(tree, node("l1")).map((o) => o.label);
    expect(labels).toContain("Mercado / Airdrops / Subforo");
  });

  it("respects the 6-level depth limit", () => {
    const deep = [
      d("c", null, "category", "C", 1),
      d("f2", "c", "forum", "F2", 1),
      d("f3", "f2", "forum", "F3", 1),
      d("f4", "f3", "forum", "F4", 1),
      d("f5", "f4", "forum", "F5", 1),
      d("f6", "f5", "forum", "F6", 1),
      d("t", "c", "text", "T", 2),
      d("x", "c", "forum", "X", 3),
      d("xt", "x", "text", "XT", 1),
    ];
    const t = buildTree(deep);
    const byId = (id: string) => deep.find((r) => r.id === id)!;
    // F6 está a profundidad 6: un texto no puede colgar de él... sí puede? Quedaría a 7 -> no.
    expect(validParents(t, byId("t")).map((o) => o.id)).not.toContain("f6");
    expect(validParents(t, byId("t")).map((o) => o.id)).toContain("f5");
    // X (con un hijo, altura 2) bajo F5 (prof. 5) llegaría a 7 -> no; bajo F4 llegaría a 6 -> sí.
    const ids = validParents(t, byId("x")).map((o) => o.id);
    expect(ids).not.toContain("f5");
    expect(ids).toContain("f4");
  });
});

describe("ChannelTreeEditor", () => {
  it("renders the nested tree and selecting a node opens its form", async () => {
    const user = userEvent.setup();
    render(<ChannelTreeEditor channels={ROWS} />);
    expect(screen.getByRole("button", { name: "Editar Reglas" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editar Reglas" }));
    expect(screen.getByLabelText("Nombre")).toHaveValue("Reglas");
  });

  it("offers 'Nuevo' only on container nodes", () => {
    render(<ChannelTreeEditor channels={ROWS} />);
    expect(screen.getByRole("button", { name: "Nuevo en Comunidad" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo en Airdrops" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo en General" })).toBeNull();
  });

  it("'Mover a…' excludes the own subtree and text nodes", async () => {
    const user = userEvent.setup();
    render(<ChannelTreeEditor channels={ROWS} />);
    await user.click(screen.getByRole("button", { name: "Mover Airdrops a…" }));
    const dialog = await screen.findByRole("dialog");
    const options = within(dialog)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Comunidad", "Mercado"]);
  });

  it("disables 'Mover' while the selected parent is the current one", async () => {
    const user = userEvent.setup();
    render(<ChannelTreeEditor channels={ROWS} />);
    await user.click(screen.getByRole("button", { name: "Mover Trading a…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Mover" })).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText("Nuevo padre"), "cat1");
    expect(within(dialog).getByRole("button", { name: "Mover" })).toBeEnabled();
    await user.selectOptions(within(dialog).getByLabelText("Nuevo padre"), "cat2");
    expect(within(dialog).getByRole("button", { name: "Mover" })).toBeDisabled();
  });

  it("shows the permission matrix for the selected channel when matrix data is provided", async () => {
    const user = userEvent.setup();
    render(
      <ChannelTreeEditor
        channels={ROWS}
        matrix={{
          overwritesByChannel: { rul: [{ targetType: "role", targetId: "ev", allow: "0", deny: "1" }] },
          channelPerms: { rul: "31759" },
          roles: [{ id: "ev", name: "@everyone", color: "#A3A3A3", position: 0, isEveryone: true, isAdminRole: false }],
          members: [],
          isAdmin: false,
          actorTop: 10,
        }}
      />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Editar Reglas" }));
    expect(screen.getByRole("button", { name: /@everyone · Ver canal: denegado/ })).toBeInTheDocument();
  });

  it("moving to another parent calls moveChannelAction with append", async () => {
    const user = userEvent.setup();
    moveChannelAction.mockResolvedValue({});
    render(<ChannelTreeEditor channels={ROWS} />);
    await user.click(screen.getByRole("button", { name: "Mover Trading a…" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Nuevo padre"), "cat1");
    await user.click(within(dialog).getByRole("button", { name: "Mover" }));
    await waitFor(() =>
      expect(moveChannelAction).toHaveBeenCalledWith({ id: "tr", parentId: "cat1", index: null }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("reordering with the keyboard calls moveChannelAction with the new index", async () => {
    const user = userEvent.setup();
    moveChannelAction.mockResolvedValue({});
    // jsdom no hace layout: damos a cada <li> una caja de 40px apilada según el orden del DOM.
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const i = this.tagName === "LI" ? [...document.querySelectorAll("li")].indexOf(this as HTMLLIElement) : 0;
      const top = Math.max(i, 0) * 40;
      return { x: 0, y: top, top, left: 0, right: 300, bottom: top + 40, width: 300, height: 40, toJSON: () => ({}) };
    });
    render(<ChannelTreeEditor channels={ROWS} />);
    const handle = screen.getByRole("button", { name: "Reordenar General" });
    handle.focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
    await waitFor(() => expect(moveChannelAction).toHaveBeenCalledTimes(1));
    expect(moveChannelAction).toHaveBeenCalledWith({ id: "gen", parentId: "cat1", index: 1 });
    spy.mockRestore();
  });

  it("shows an error from a failed move", async () => {
    const user = userEvent.setup();
    moveChannelAction.mockResolvedValue({ error: "invalid_tree" });
    render(<ChannelTreeEditor channels={ROWS} />);
    await user.click(screen.getByRole("button", { name: "Mover Trading a…" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Nuevo padre"), "cat1");
    await user.click(within(dialog).getByRole("button", { name: "Mover" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Ese movimiento rompería");
  });

  it("creates a child through the 'Nuevo' dialog", async () => {
    const user = userEvent.setup();
    createChannelAction.mockResolvedValue({ id: "new" });
    render(<ChannelTreeEditor channels={ROWS} />);
    await user.click(screen.getByRole("button", { name: "Nuevo en Comunidad" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Nombre"), "Off-topic");
    await user.click(within(dialog).getByRole("button", { name: "Crear" }));
    await waitFor(() =>
      expect(createChannelAction).toHaveBeenCalledWith({
        parentId: "cat1",
        kind: "text",
        name: "Off-topic",
        topic: "",
      }),
    );
  });

  it("shows an empty state with a create-category button", () => {
    render(<ChannelTreeEditor channels={[]} />);
    expect(screen.getByText(/Aún no hay canales/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nueva categoría" })).toBeInTheDocument();
  });
});
