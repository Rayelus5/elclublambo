import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SplitCalculator } from "@/components/split/split-calculator";
import { getDictionary } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import { decodeLines } from "@/lib/multisend/fragment";
import { buildPayUrl } from "@/lib/pay/link";
import { decodeSplit, encodeSplit, type SplitState } from "@/lib/split/state";

const es = getDictionary("es");
const t = es.multisend.split;
const A = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const C = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";

async function open(state: SplitState, lang: "es" | "en" = "es") {
  window.location.hash = `#gastos=${await encodeSplit(state)}`;
  const user = userEvent.setup();
  const view = render(<SplitCalculator lang={lang} />);
  await screen.findByDisplayValue(state.people[0]!.n);
  return { user, ...view };
}
const results = () => screen.getByRole("list", { name: t.result });
const sentences = () => within(results()).getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent);

beforeEach(() => {
  window.location.hash = "";
});
afterEach(() => {
  window.location.hash = "";
});

describe("SplitCalculator", () => {
  it("opening with #gastos= restores the rows", async () => {
    await open({ v: 1, people: [{ n: "Ana", p: "30", t: "ana" }, { n: "Bea", p: "0" }, { n: "Cris", p: "12,5", t: C }] });
    const rows = screen.getAllByRole("group", { name: /^Persona \d+$/ });
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByLabelText(t.name)).toHaveValue("Ana");
    expect(within(rows[0]!).getByLabelText(t.target)).toHaveValue("ana");
    expect(within(rows[2]!).getByLabelText(t.paid)).toHaveValue("12,5");
    expect(within(rows[2]!).getByLabelText(t.target)).toHaveValue(C);
  });

  it("the alias creditor's ElClub Pay link carries amount=10 and asset=USDC:84532", async () => {
    await open({ v: 1, people: [{ n: "Ana", p: "30", t: "ana" }, { n: "Bea", p: "0" }, { n: "Cris", p: "0" }] });
    expect(sentences()).toEqual([
      fill(t.pays, { from: "Cris", amount: "10", to: "Ana" }),
      fill(t.pays, { from: "Bea", amount: "10", to: "Ana" }),
    ]);
    const item = within(results()).getAllByRole("listitem")[0]!;
    const link = within(item).getByRole("link", { name: fill(t.payLinkLabel, { amount: "10", to: "Ana" }) });
    const href = new URL(link.getAttribute("href")!, "http://x");
    expect(href.searchParams.get("amount")).toBe("10");
    expect(href.searchParams.get("asset")).toBe("USDC:84532");
    expect(link.getAttribute("href")).toBe(buildPayUrl(window.location.origin, "es", "ana", { amount: "10", asset: "USDC:84532" }));
  });

  it("a creditor without a target has no Pay link", async () => {
    await open({ v: 1, people: [{ n: "Ana", p: "30" }, { n: "Bea", p: "0" }, { n: "Cris", p: "0" }] });
    expect(within(results()).getAllByRole("listitem")).toHaveLength(2);
    expect(within(results()).queryAllByRole("link")).toHaveLength(0);
  });

  it("«Soy Bea» + «Enviar con envío múltiple» writes #envio= with 0x…,10 (only creditors with an address)", async () => {
    const { user } = await open({
      v: 1,
      people: [{ n: "Ana", p: "40", t: A }, { n: "Bea", p: "0" }, { n: "Cris", p: "20", t: "cris" }, { n: "Dani", p: "0" }],
    });
    // Shares 15 each: Ana +25, Cris +5, Bea -15, Dani -15 -> Dani pays Ana 15, Bea pays Ana 10, Bea pays Cris 5.
    expect(sentences()).toEqual([
      fill(t.pays, { from: "Dani", amount: "15", to: "Ana" }),
      fill(t.pays, { from: "Bea", amount: "10", to: "Ana" }),
      fill(t.pays, { from: "Bea", amount: "5", to: "Cris" }),
    ]);
    await user.selectOptions(screen.getByLabelText(t.me), "Bea");
    expect(screen.getByText(fill(t.meOwes, { total: "15" }))).toBeInTheDocument();
    expect(screen.getByText(fill(t.noAddress, { names: "Cris" }))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t.sendMulti }));
    expect(decodeLines(window.location.hash)).toBe(`${A},10`);
  });

  it("a creditor picked in «Soy…» has nothing to send", async () => {
    const { user } = await open({ v: 1, people: [{ n: "Ana", p: "30", t: A }, { n: "Bea", p: "0" }] });
    await user.selectOptions(screen.getByLabelText(t.me), "Ana");
    expect(screen.getByText(t.meNothing)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.sendMulti })).not.toBeInTheDocument();
  });

  it("a debtor whose creditors have only aliases cannot send with multisend", async () => {
    const { user } = await open({ v: 1, people: [{ n: "Ana", p: "30", t: "ana" }, { n: "Bea", p: "0" }] });
    await user.selectOptions(screen.getByLabelText(t.me), "Bea");
    expect(screen.getByText(t.noLines)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.sendMulti })).toBeDisabled();
  });

  it("has no Base Blue fill in the section; every button is outline and at least 44 px", async () => {
    const { container } = await open({ v: 1, people: [{ n: "Ana", p: "30", t: "ana" }, { n: "Bea", p: "0" }] });
    expect(container.querySelectorAll(".bg-accent-fill")).toHaveLength(0);
    for (const b of screen.getAllByRole("button")) {
      expect(b.getAttribute("data-variant")).toMatch(/outline|secondary/);
      expect(b.className).toMatch(/min-h-11|size-11/);
    }
    expect(screen.getByText(es.common.noCustody)).toBeInTheDocument();
  });

  it("a damaged #gastos= shows the error and an empty split, without crashing", async () => {
    window.location.hash = "#gastos=v1.@@@";
    render(<SplitCalculator lang="es" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(t.badLink);
    expect(screen.getAllByRole("group", { name: /^Persona \d+$/ })).toHaveLength(2);
  });

  it("typing builds the split, flags a bad amount or target next to its field, and adds/removes people up to 20", async () => {
    const user = userEvent.setup();
    render(<SplitCalculator lang="es" />);
    expect(screen.getByText(t.needTwo)).toBeInTheDocument();
    const rows = () => screen.getAllByRole("group", { name: /^Persona \d+$/ });
    await user.type(within(rows()[0]!).getByLabelText(t.name), "Ana");
    await user.type(within(rows()[0]!).getByLabelText(t.paid), "1,1234567");
    expect(within(rows()[0]!).getByText(t.issues.amount)).toBeInTheDocument();
    expect(screen.getByText(t.fixErrors)).toBeInTheDocument();
    await user.clear(within(rows()[0]!).getByLabelText(t.paid));
    await user.type(within(rows()[0]!).getByLabelText(t.paid), "9");
    await user.type(within(rows()[1]!).getByLabelText(t.target), "0x123");
    expect(within(rows()[1]!).getByText(t.issues.target)).toBeInTheDocument();
    await user.clear(within(rows()[1]!).getByLabelText(t.target));
    await user.click(screen.getByRole("button", { name: t.add }));
    expect(rows()).toHaveLength(3);
    expect(sentences()).toEqual([
      fill(t.pays, { from: "Persona 3", amount: "3", to: "Ana" }),
      fill(t.pays, { from: "Persona 2", amount: "3", to: "Ana" }),
    ]);
    await user.click(screen.getByRole("button", { name: fill(t.removeLabel, { name: "Persona 3" }) }));
    expect(rows()).toHaveLength(2);
    for (let i = 2; i < 20; i++) await user.click(screen.getByRole("button", { name: t.add }));
    expect(rows()).toHaveLength(20);
    expect(screen.getByRole("button", { name: t.add })).toBeDisabled();
    expect(screen.getByText(t.max)).toBeInTheDocument();
  });

  it("keeps the split in #gastos= as it changes, and «Copiar enlace» copies that link", async () => {
    const user = userEvent.setup();
    render(<SplitCalculator lang="en" />);
    const en = getDictionary("en").multisend.split;
    const rows = screen.getAllByRole("group", { name: /^Person \d+$/ });
    await user.type(within(rows[0]!).getByLabelText(en.name), "Ana");
    await user.type(within(rows[0]!).getByLabelText(en.paid), "8");
    await waitFor(async () => expect((await decodeSplit(window.location.hash))?.people[0]).toEqual({ n: "Ana", p: "8" }));
    await user.click(screen.getByRole("button", { name: en.copy }));
    expect(await navigator.clipboard.readText()).toBe(window.location.href);
    expect(await screen.findByText(en.copied)).toBeInTheDocument();
  });
});
