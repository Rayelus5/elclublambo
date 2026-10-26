import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitState } from "@/lib/split/state";

// decodeSplit is async (v1 inflates through a stream): here each call returns a promise the test resolves by hand, so
// the order in which decodes finish is under the test's control.
type Pending = { hash: string; resolve: (s: SplitState | null) => void };
const pending = vi.hoisted(() => [] as Array<{ hash: string; resolve: (s: unknown) => void }>);
vi.mock("@/lib/split/state", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/split/state")>();
  return {
    ...real,
    decodeSplit: (hash: string) => new Promise((resolve) => pending.push({ hash, resolve })),
  };
});

import { SplitCalculator } from "@/components/split/split-calculator";
import { getDictionary } from "@/lib/i18n";

const t = getDictionary("es").multisend.split;
const people = (...names: string[]): SplitState => ({ v: 1, people: names.map((n) => ({ n, p: "1" })) });
const names = () => screen.getAllByRole("group", { name: /^Persona \d+$/ }).map((g) => (within(g).getByLabelText(t.name) as HTMLInputElement).value);

function openLink(hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

async function settle(p: Pending | undefined, state: SplitState | null) {
  await act(async () => {
    p!.resolve(state);
  });
}

beforeEach(() => {
  pending.length = 0;
  window.location.hash = "";
});
afterEach(() => {
  window.location.hash = "";
});

describe("SplitCalculator: decodes that finish out of order", () => {
  it("two links opened back to back: the older decode landing last is ignored", async () => {
    render(<SplitCalculator lang="es" />);
    act(() => openLink("#gastos=v1.first"));
    act(() => openLink("#gastos=v1.second"));
    const [first, second] = pending as Pending[];
    expect(pending).toHaveLength(2);
    await settle(second, people("Nuevo", "Link"));
    expect(names()).toEqual(["Nuevo", "Link"]);
    await settle(first, people("Viejo", "Link", "Tres"));
    expect(names()).toEqual(["Nuevo", "Link"]);
  });

  it("a decode that resolves after the user started typing does not overwrite the edits", async () => {
    window.location.hash = "#gastos=v1.slow";
    const user = userEvent.setup();
    render(<SplitCalculator lang="es" />);
    expect(pending).toHaveLength(1);
    await user.type(screen.getAllByLabelText(t.name)[0]!, "Mío");
    await settle(pending[0] as Pending, people("Del", "Enlace"));
    expect(names()).toEqual(["Mío", ""]);
  });

  it("a link opened after typing still loads (the edit came before that decode began)", async () => {
    const user = userEvent.setup();
    render(<SplitCalculator lang="es" />);
    await user.type(screen.getAllByLabelText(t.name)[0]!, "Mío");
    act(() => openLink("#gastos=v1.later"));
    await settle(pending.at(-1) as Pending, people("Del", "Enlace"));
    expect(names()).toEqual(["Del", "Enlace"]);
  });
});
