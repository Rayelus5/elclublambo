import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
const addAccessWalletAction = vi.hoisted(() => vi.fn());
const removeAccessWalletAction = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/admin/actions", () => ({ addAccessWalletAction, removeAccessWalletAction }));

import { AccessList } from "@/components/admin/access-list";

const A = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const B = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";

beforeEach(() => {
  refresh.mockReset();
  addAccessWalletAction.mockReset().mockResolvedValue({ ok: true });
  removeAccessWalletAction.mockReset().mockResolvedValue({ ok: true });
});

describe("AccessList", () => {
  it("an invalid wallet shows the wallet_invalid error without calling the action", async () => {
    const user = userEvent.setup();
    render(<AccessList items={[]} />);
    await user.type(screen.getByLabelText("Wallet"), "0x12");
    await user.click(screen.getByRole("button", { name: "Añadir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La wallet no es válida");
    expect(screen.getByLabelText("Wallet")).toHaveAttribute("aria-invalid", "true");
    expect(addAccessWalletAction).not.toHaveBeenCalled();
  });

  it("adds a wallet with its note, clears the form and refreshes", async () => {
    const user = userEvent.setup();
    render(<AccessList items={[]} />);
    await user.type(screen.getByLabelText("Wallet"), A);
    await user.type(screen.getByLabelText("Nota (opcional)"), "Ana — moderadora");
    await user.click(screen.getByRole("button", { name: "Añadir" }));
    await waitFor(() => expect(addAccessWalletAction).toHaveBeenCalledWith(A, "Ana — moderadora"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByLabelText("Wallet")).toHaveValue("");
  });

  it("lists each wallet shortened with its note and an outline «Quitar» that calls the action without asking", async () => {
    const user = userEvent.setup();
    render(
      <AccessList
        items={[
          { wallet: A, note: "Ana — moderadora", createdAt: "2026-10-26T10:00:00+00:00" },
          { wallet: B, note: null, createdAt: "2026-10-26T11:00:00+00:00" },
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("0x7099…79c8")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Ana — moderadora")).toBeInTheDocument();
    const remove = within(rows[1]!).getByRole("button", { name: /Quitar/ });
    expect(remove).toHaveAttribute("data-variant", "outline");
    await user.click(remove);
    await waitFor(() => expect(removeAccessWalletAction).toHaveBeenCalledWith(B));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("an empty list says so", () => {
    render(<AccessList items={[]} />);
    expect(screen.getByText(/Nadie en la lista/)).toBeInTheDocument();
  });

  it("an RPC error shows as an alert", async () => {
    addAccessWalletAction.mockResolvedValue({ ok: false, error: "forbidden" });
    const user = userEvent.setup();
    render(<AccessList items={[]} />);
    await user.type(screen.getByLabelText("Wallet"), A);
    await user.click(screen.getByRole("button", { name: "Añadir" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso para hacer esto.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
