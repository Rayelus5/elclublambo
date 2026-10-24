import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const createPublicGiveawayAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public-giveaways/actions", () => ({ createPublicGiveawayAction }));

import { CreateForm } from "@/components/public-giveaways/create-form";
import { getDictionary } from "@/lib/i18n";

const NEW_ID = "33333333-3333-4333-8333-333333333333";
const en = getDictionary("en").giveaways;
const es = getDictionary("es").giveaways;

/** A datetime-local value (local time, minutes) `ms` from now. */
function localIn(ms: number): string {
  const d = new Date(Date.now() + ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setup(lang: "en" | "es" = "en") {
  const d = lang === "en" ? en : es;
  return render(<CreateForm lang={lang} t={d.create} errors={d.errors} chains={[84532, 421614]} />);
}

beforeEach(() => {
  push.mockReset();
  createPublicGiveawayAction.mockReset().mockResolvedValue({ ok: true, id: NEW_ID });
});

describe("CreateForm", () => {
  it("shows every label in English with lang=en", () => {
    setup("en");
    for (const label of [en.create.title, en.create.description, en.create.closes, en.create.host, en.create.amount]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(en.create.payNotice)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create giveaway" })).toBeInTheDocument();
    expect(screen.queryByText("Título")).not.toBeInTheDocument();
  });

  it("keeps the requirements folded until opened", async () => {
    setup();
    const summary = screen.getByText(en.create.requirements);
    expect(summary.closest("details")).not.toHaveAttribute("open");
    await userEvent.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(screen.getByLabelText(en.create.minTx)).toBeVisible();
  });

  it("rejects a close in the past next to the field and does not send", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(en.create.title), "Autumn draw");
    await userEvent.type(screen.getByLabelText(en.create.amount), "5");
    fireEvent.change(screen.getByLabelText(en.create.closes), { target: { value: localIn(-3600_000) } });
    await userEvent.click(screen.getByRole("button", { name: "Create giveaway" }));
    const field = screen.getByLabelText(en.create.closes);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(en.create.errClose)).toBeInTheDocument();
    expect(createPublicGiveawayAction).not.toHaveBeenCalled();
  });

  it("does not allow an 11th prize", async () => {
    setup();
    const add = screen.getByRole("button", { name: en.create.addPrize });
    for (let i = 0; i < 12; i++) if (!(add as HTMLButtonElement).disabled) await userEvent.click(add);
    expect(screen.getAllByRole("group", { name: /^Prize \d+$/ })).toHaveLength(10);
    expect(add).toBeDisabled();
    expect(screen.getByText(en.create.maxPrizes)).toBeInTheDocument();
  });

  async function fillValid() {
    await userEvent.type(screen.getByLabelText(en.create.title), "Autumn draw");
    fireEvent.change(screen.getByLabelText(en.create.closes), { target: { value: localIn(2 * 3600_000) } });
    await userEvent.type(screen.getByLabelText(en.create.amount), "5.5");
  }

  it("shows the dictionary text for a rate_limited error", async () => {
    createPublicGiveawayAction.mockResolvedValue({ ok: false, error: "rate_limited" });
    setup();
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: "Create giveaway" }));
    expect(await screen.findByText(en.errors.rate_limited)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("sends the prizes and the close as ISO, then goes to the giveaway", async () => {
    setup();
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: en.create.addPrize }));
    const second = screen.getByRole("group", { name: "Prize 2" });
    await userEvent.click(within(second).getByRole("radio", { name: en.create.kindCustom }));
    await userEvent.type(within(second).getByLabelText(en.create.customLabel), "T-shirt");
    await userEvent.click(screen.getByText(en.create.requirements));
    await userEvent.type(screen.getByLabelText(en.create.minTx), "3");
    await userEvent.click(screen.getByRole("button", { name: "Create giveaway" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/en/tools/giveaways/${NEW_ID}`));
    const input = createPublicGiveawayAction.mock.calls[0]![0];
    expect(input).toMatchObject({
      title: "Autumn draw",
      minTxCount: 3,
      prizes: [
        { kind: "crypto", chainId: 84532, amount: "5.5" },
        { kind: "custom", label: "T-shirt" },
      ],
    });
    expect(input.closesAt).toMatch(/Z$/);
  });

  it("navigates to the Spanish URL without prefix for lang=es", async () => {
    setup("es");
    await userEvent.type(screen.getByLabelText(es.create.title), "Sorteo");
    fireEvent.change(screen.getByLabelText(es.create.closes), { target: { value: localIn(2 * 3600_000) } });
    await userEvent.type(screen.getByLabelText(es.create.amount), "5");
    await userEvent.click(screen.getByRole("button", { name: es.create.submit }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/herramientas/sorteos/${NEW_ID}`));
  });
});
