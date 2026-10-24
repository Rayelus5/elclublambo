import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { newPrizeRow, PrizeEditor, prizeInputs, type PrizeRow } from "@/components/giveaways/prize-editor";

const ROLE = "22222222-2222-4222-8222-222222222222";
const roles = [{ id: ROLE, name: "Veterano", color: "#22d3ee" }];

function Harness({ initial = [newPrizeRow(84532)], onRows }: { initial?: PrizeRow[]; onRows?: (r: PrizeRow[]) => void }) {
  const [rows, setRows] = useState(initial);
  return (
    <PrizeEditor
      rows={rows}
      onChange={(next) => {
        setRows(next);
        onRows?.(next);
      }}
      chains={[84532, 421614]}
      roles={roles}
    />
  );
}

describe("PrizeEditor", () => {
  it("stops at 10 prizes: the add button turns off and says why", async () => {
    let last: PrizeRow[] = [];
    render(<Harness onRows={(r) => (last = r)} />);
    const add = screen.getByRole("button", { name: "Añadir premio" });
    for (let i = 0; i < 9; i++) await userEvent.click(add);
    expect(screen.getAllByRole("group", { name: /^Premio \d+$/ })).toHaveLength(10);
    expect(add).toBeDisabled();
    expect(screen.getByText("Máximo 10 premios.")).toBeInTheDocument();
    await userEvent.click(add);
    expect(screen.getAllByRole("group", { name: /^Premio \d+$/ })).toHaveLength(10);
    expect(last).toHaveLength(10);
  });

  it("each row picks its kind with a segmented control: USDC, Rol, Otro", async () => {
    render(<Harness />);
    const row = screen.getByRole("group", { name: "Premio 1" });
    const kind = within(row).getByRole("radiogroup", { name: "Tipo del premio 1" });
    expect(within(kind).getAllByRole("radio").map((r) => r.textContent)).toEqual(["USDC", "Rol", "Otro"]);
    expect(within(row).getByRole("radiogroup", { name: "Red" })).toBeInTheDocument();
    expect(within(row).getByLabelText("Importe en USDC")).toBeInTheDocument();

    await userEvent.click(within(kind).getByRole("radio", { name: "Rol" }));
    expect(within(row).getByRole("combobox", { name: "Rol" })).toBeInTheDocument();
    expect(within(row).getByRole("option", { name: "Veterano" })).toBeInTheDocument();

    await userEvent.click(within(kind).getByRole("radio", { name: "Otro" }));
    expect(within(row).getByLabelText("Premio")).toBeInTheDocument();
  });

  it("without roles to offer (no MANAGE_ROLES, or none allowed) the «Rol» kind is not shown", () => {
    render(<PrizeEditor rows={[newPrizeRow(84532)]} onChange={() => {}} chains={[84532]} roles={[]} />);
    const kind = screen.getByRole("radiogroup", { name: "Tipo del premio 1" });
    expect(within(kind).getAllByRole("radio").map((r) => r.textContent)).toEqual(["USDC", "Otro"]);
  });

  it("removes a row, never the last one", async () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /Quitar premio/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Añadir premio" }));
    await userEvent.click(screen.getByRole("button", { name: "Quitar premio 2" }));
    expect(screen.getAllByRole("group", { name: /^Premio \d+$/ })).toHaveLength(1);
  });
});

describe("prizeInputs", () => {
  it("turns the rows into the action's prizes with their kind", () => {
    const rows: PrizeRow[] = [
      { ...newPrizeRow(84532), kind: "crypto", chainId: 421614, amount: "12,5" },
      { ...newPrizeRow(84532), kind: "role", roleId: ROLE },
      { ...newPrizeRow(84532), kind: "custom", label: "  Camiseta " },
    ];
    expect(prizeInputs(rows)).toEqual({
      ok: true,
      prizes: [
        { kind: "crypto", chainId: 421614, amount: "12,5" },
        { kind: "role", roleId: ROLE },
        { kind: "custom", label: "Camiseta" },
      ],
    });
  });

  it("reports the first row that is not ready", () => {
    expect(prizeInputs([{ ...newPrizeRow(84532), amount: "0" }])).toEqual({ ok: false, error: "Premio 1: escribe un importe mayor que 0." });
    expect(prizeInputs([{ ...newPrizeRow(84532), kind: "role" }])).toEqual({ ok: false, error: "Premio 1: elige un rol." });
    expect(prizeInputs([{ ...newPrizeRow(84532), kind: "custom", label: " " }])).toEqual({ ok: false, error: "Premio 1: describe el premio (1 a 120 caracteres)." });
  });
});
